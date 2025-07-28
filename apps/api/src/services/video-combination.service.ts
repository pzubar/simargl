import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VideoAnalysisService } from './video-analysis.service';
import { Content } from '../schemas/content.schema';
import { VideoChunk } from '../schemas/video-chunk.schema';
import { Channel } from '../schemas/channel.schema';

@Injectable()
export class VideoCombinationService {
  private readonly logger = new Logger(VideoCombinationService.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectModel(VideoChunk.name) private videoChunkModel: Model<VideoChunk>,
    private videoAnalysisService: VideoAnalysisService,
  ) {}

  /**
   * Check if all chunks for content are complete and get combination status
   */
  async getCombinationStatus(contentId: string | Types.ObjectId): Promise<{
    canCombine: boolean;
    expectedChunks: number;
    completedChunks: number;
    failedChunks: number;
    status: string;
    reason?: string;
  }> {
    const content = await this.contentModel.findById(contentId).exec();
    if (!content) {
      return {
        canCombine: false,
        expectedChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        status: 'ERROR',
        reason: 'Content not found',
      };
    }

    const expectedChunks = content.metadata?.expectedChunks;
    if (!expectedChunks || expectedChunks <= 0) {
      return {
        canCombine: false,
        expectedChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        status: 'NOT_CHUNKED',
        reason:
          'No expected chunk count found - content may not have been chunked yet',
      };
    }

    const completedChunks = await this.videoChunkModel.countDocuments({
      contentId: new Types.ObjectId(contentId),
      status: 'ANALYZED',
    });

    const failedChunks = await this.videoChunkModel.countDocuments({
      contentId: new Types.ObjectId(contentId),
      status: { $in: ['FAILED', 'OVERLOADED'] },
    });

    const totalProcessedChunks = completedChunks + failedChunks;

    if (completedChunks === expectedChunks) {
      return {
        canCombine: true,
        expectedChunks,
        completedChunks,
        failedChunks,
        status: 'READY',
        reason: 'All chunks completed successfully',
      };
    }

    if (totalProcessedChunks === expectedChunks && completedChunks > 0) {
      return {
        canCombine: true,
        expectedChunks,
        completedChunks,
        failedChunks,
        status: 'PARTIAL',
        reason: `Some chunks failed (${failedChunks}/${expectedChunks}) but can attempt combination with ${completedChunks} successful chunks`,
      };
    }

    return {
      canCombine: false,
      expectedChunks,
      completedChunks,
      failedChunks,
      status: 'PROCESSING',
      reason: `Still processing chunks: ${completedChunks}/${expectedChunks} completed, ${failedChunks} failed`,
    };
  }

  /**
   * Manually trigger combination of chunks for a content item
   */
  async triggerCombination(
    contentId: string | Types.ObjectId,
    forceModel?: string,
  ): Promise<{
    success: boolean;
    message: string;
    combinationResult?: any;
    error?: string;
  }> {
    this.logger.log(
      `🔄 Manual combination triggered for content: ${contentId}`,
    );

    try {
      // Check combination status first
      const status = await this.getCombinationStatus(contentId);

      if (!status.canCombine) {
        return {
          success: false,
          message: `Cannot combine chunks: ${status.reason}`,
          error: `Status: ${status.status}, Completed: ${status.completedChunks}/${status.expectedChunks}`,
        };
      }

      if (status.failedChunks > 0 && status.status === 'PARTIAL') {
        this.logger.warn(
          `⚠️ Attempting partial combination with ${status.completedChunks}/${status.expectedChunks} chunks for content ${contentId}`,
        );
      }

      // Get content details for combination
      const content = await this.contentModel.findById(contentId).exec();
      if (!content) {
        throw new Error('Content not found');
      }

      const channel = await this.channelModel
        .findById(content.channelId)
        .exec();

      const videoInfo = {
        title: content.title || 'Video',
        description: content.description || '',
        duration: content.metadata?.duration || 0,
        channel: content.metadata?.channel || 'Unknown',
        view_count: content.metadata?.viewCount || 0,
        upload_date: content.publishedAt,
        thumbnail: content.metadata?.thumbnailUrl,
        authorContext: channel?.authorContext || '',
      };

      this.logger.log(
        `🚀 Starting combination for content ${contentId} with ${status.completedChunks} chunks`,
      );

      // Use the existing combination method from VideoAnalysisService
      const combinedResult =
        await this.videoAnalysisService.combineChunkAnalysesUsingAI(
          contentId,
          videoInfo,
          forceModel,
        );

      // Update the content with the final analysis
      await this.contentModel.updateOne(
        { _id: contentId },
        {
          'analysis.result': combinedResult,
          'analysis.combinedAt': new Date(),
          'analysis.manuallyTriggered': true,
          'analysis.combinedChunks': status.completedChunks,
          'analysis.failedChunks': status.failedChunks,
          status: 'ANALYZED',
        },
      );

      this.logger.log(
        `✅ Successfully combined and saved analysis for content ${contentId}`,
      );

      return {
        success: true,
        message:
          status.status === 'PARTIAL'
            ? `Successfully combined ${status.completedChunks}/${status.expectedChunks} chunks (${status.failedChunks} failed chunks were skipped)`
            : `Successfully combined all ${status.completedChunks} chunks`,
        combinationResult: combinedResult,
      };
    } catch (error) {
      this.logger.error(
        `❌ Failed to combine analysis for content ${contentId}: ${error.message}`,
      );

      // Mark content as failed
      await this.contentModel.updateOne(
        { _id: contentId },
        {
          status: 'FAILED',
          lastError: `Manual combination failed: ${error.message}`,
        },
      );

      return {
        success: false,
        message: 'Combination failed',
        error: error.message,
      };
    }
  }

  /**
   * Reset chunks for a content item (mark them for re-analysis)
   */
  async resetChunks(contentId: string | Types.ObjectId): Promise<{
    success: boolean;
    message: string;
    resetCount?: number;
    error?: string;
  }> {
    this.logger.log(`🔄 Resetting chunks for content: ${contentId}`);

    try {
      // Update all chunks to PENDING status and clear analysis results
      const updateResult = await this.videoChunkModel.updateMany(
        { contentId: new Types.ObjectId(contentId) },
        {
          $set: {
            status: 'PENDING',
            error: undefined,
            processingTime: undefined,
            modelUsed: undefined,
          },
          $unset: {
            analysisResult: 1,
          },
        },
      );

      // Update content status back to PROCESSING
      await this.contentModel.updateOne(
        { _id: contentId },
        {
          $set: {
            status: 'PROCESSING',
          },
          $unset: {
            'analysis.result': 1,
            'analysis.combinedAt': 1,
            'analysis.manuallyTriggered': 1,
            'analysis.combinedChunks': 1,
            'analysis.failedChunks': 1,
            lastError: 1,
          },
        },
      );

      this.logger.log(
        `✅ Reset ${updateResult.modifiedCount} chunks for content ${contentId}`,
      );

      return {
        success: true,
        message: `Successfully reset ${updateResult.modifiedCount} chunks. Content is ready for re-analysis.`,
        resetCount: updateResult.modifiedCount,
      };
    } catch (error) {
      this.logger.error(
        `❌ Failed to reset chunks for content ${contentId}: ${error.message}`,
      );

      return {
        success: false,
        message: 'Failed to reset chunks',
        error: error.message,
      };
    }
  }
}
