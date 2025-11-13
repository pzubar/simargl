import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Worker } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VideoInsight } from '../schemas/video-insight.schema';
import { Content } from '../schemas/content.schema';
import { Prompt } from '../schemas/prompt.schema';
import { VideoInsightService } from '../services/video-insight.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { Logger } from '@nestjs/common';

@Processor('insight-gathering', {
  limiter: {
    max: 10, // Conservative rate limit for AI processing
    duration: 60000, // 1 minute
  },
})
export class VideoInsightGatheringProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoInsightGatheringProcessor.name);

  constructor(
    @InjectModel(VideoInsight.name)
    private videoInsightModel: Model<VideoInsight>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    private videoInsightService: VideoInsightService,
    private enhancedQuotaManager: QuotaManagerService,
    private rateLimitService: BullMQRateLimitService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const {
      contentId,
      chunkIndex,
      startTime,
      endTime,
      totalChunks,
      youtubeUrl,
      videoInfo,
    } = job.data;
    const attemptNumber = job.attemptsMade;
    const maxAttempts = job.opts.attempts || 1;

    this.logger.log(
      `🔍 Gathering insights from chunk ${chunkIndex + 1}/${totalChunks} for content ${contentId} (attempt ${attemptNumber + 1}/${maxAttempts})`,
    );

    try {
      // Pre-check quota and apply rate limiting if needed
      const chunkData = { chunkIndex, startTime, endTime };
      const estimatedTokens = this.estimateTokensForChunk(chunkData, videoInfo);
      const selectedModel = await this.selectBestModel(estimatedTokens);

      if (selectedModel) {
        const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
          this.worker,
          selectedModel,
          estimatedTokens,
        );

        if (rateLimitResult.applied) {
          this.logger.warn(
            `⏳ Pre-emptive rate limit applied for chunk ${chunkIndex + 1}: ${rateLimitResult.reason}`,
          );
          throw Worker.RateLimitError();
        }
      }

      // Gather insights from this video chunk using business-focused service method
      const result = await this.videoInsightService.gatherChunkInsights(
        youtubeUrl,
        videoInfo,
        chunkData,
        selectedModel,
      );

      // Check if insight gathering was successful
      if (!result.success) {
        this.logger.error(
          `❌ Insight gathering failed for chunk ${chunkIndex + 1}: ${result.error}`,
        );

        // Save failed insight attempt to database
        await this.saveFailedInsightToDatabase(
          contentId,
          chunkData,
          result.error,
          attemptNumber + 1,
        );

        // Create an error object to determine retry strategy
        const error = {
          message: result.error,
          status: result.isModelOverloaded ? 503 : 429,
        };

        // Enhanced error handling with BullMQ rate limiting
        if (this.isQuotaExhaustedError(error)) {
          const modelUsed = result.modelUsed || selectedModel || 'unknown';

          // Use the rate limiting service to handle quota violations
          const rateLimitResult =
            await this.rateLimitService.handleQuotaViolation(
              this.worker,
              modelUsed,
              error,
            );

          if (rateLimitResult.rateLimited) {
            this.logger.warn(
              `📊 Quota violation handled with rate limiting for model ${modelUsed}, retry in ${rateLimitResult.retryDelayMs}ms`,
            );
            throw Worker.RateLimitError();
          }
        } else if (this.isModelOverloadedError(error)) {
          this.logger.warn(`📊 Model overloaded - applying rate limit`);
          await this.worker.rateLimit(30000); // 30 seconds
          throw Worker.RateLimitError();
        }

        // For other errors, throw normally to trigger standard retry
        throw new Error(result.error);
      }

      // Success case - record the request and save insight
      if (result.modelUsed) {
        await this.enhancedQuotaManager.recordRequest(
          result.modelUsed,
          15000, // Estimated tokens for insight gathering
        );
      }

      const insightDocument = await this.saveInsightToDatabase(
        contentId,
        result,
      );

      this.logger.log(
        `✅ Successfully gathered insights from chunk ${chunkIndex + 1}/${totalChunks} for content ${contentId}`,
      );

      // Check if all insights have been gathered for this video
      const completedInsights = await this.videoInsightModel.countDocuments({
        contentId: new Types.ObjectId(contentId),
        status: 'INSIGHTS_GATHERED',
      });

      this.logger.log(
        `📊 Insight ${chunkIndex + 1}/${totalChunks} gathered. Total completed: ${completedInsights}`,
      );

      // If all insights are gathered, update video status
      if (completedInsights >= totalChunks) {
        this.logger.log(
          `🎯 All ${totalChunks} insights gathered for content ${contentId}. Video ready for research prompts.`,
        );

        // Update video status to INSIGHTS_GATHERED - ResearchSchedulerProcessor will handle research jobs
        await this.contentModel.updateOne(
          { _id: new Types.ObjectId(contentId) },
          {
            status: 'INSIGHTS_GATHERED',
            insightsGatheredAt: new Date(),
          },
        );

        // IMPORTANT: NO direct research job queueing here - this is decoupled
        // The ResearchSchedulerProcessor will periodically check for videos with INSIGHTS_GATHERED status
        this.logger.log(
          `🔬 Video ready for research processing (will be picked up by ResearchSchedulerProcessor)`,
        );
      }

      return { success: true, insightId: insightDocument._id };
    } catch (error) {
      // If this is a RateLimitError, don't log as an exception
      if (error instanceof Error && error.name === 'RateLimitError') {
        throw error; // Re-throw to let BullMQ handle it
      }

      this.logger.error(
        `❌ Exception during insight gathering chunk ${chunkIndex + 1} for content ${contentId}: ${error.message}`,
      );

      // For exceptions, save failed insight to database if this is the final attempt
      if (
        !error.message.includes('Quota exhausted') &&
        !error.message.includes('Model overloaded') &&
        attemptNumber + 1 >= maxAttempts
      ) {
        await this.saveFailedInsightToDatabase(
          contentId,
          { chunkIndex, startTime, endTime },
          error.message,
          attemptNumber + 1,
        );
        this.logger.error(
          `❌ Insight gathering failed permanently for content ${contentId}. Reason: ${error.message}`,
        );
      } else if (
        !error.message.includes('Quota exhausted') &&
        !error.message.includes('Model overloaded')
      ) {
        this.logger.warn(
          `⚠️ Exception occurred, will retry (attempt ${attemptNumber + 1}/${maxAttempts}): ${error.message}`,
        );
      }

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }

  /**
   * Estimate token count for a video chunk
   */
  private estimateTokensForChunk(chunkData: any, videoInfo: any): number {
    // Base estimation for video insight gathering
    const baseTokens = 5000; // Base tokens for system prompts and structure

    // Add tokens based on chunk duration (longer chunks = more content)
    const durationTokens = Math.ceil(
      (chunkData.endTime - chunkData.startTime) * 50,
    ); // ~50 tokens per second

    // Add tokens based on video metadata if available
    const metadataTokens = videoInfo?.description
      ? this.enhancedQuotaManager.estimateTokenCount(videoInfo.description)
      : 500;

    return baseTokens + durationTokens + Math.min(metadataTokens, 2000); // Cap metadata tokens
  }

  /**
   * Select the best available model for insight gathering
   */
  private async selectBestModel(
    estimatedTokens: number,
  ): Promise<string | null> {
    const modelResult =
      await this.enhancedQuotaManager.findBestAvailableModel(estimatedTokens);

    if (!modelResult.model) {
      this.logger.warn(
        `⚠️ No models available for insight gathering: ${modelResult.reason}`,
      );
      return null;
    }

    return modelResult.model;
  }

  /**
   * Save successful insight to database
   */
  private async saveInsightToDatabase(
    contentId: string | Types.ObjectId,
    result: any,
  ): Promise<any> {
    const insightData = {
      contentId: new Types.ObjectId(contentId),
      chunkIndex: result.chunk.chunkIndex,
      startTime: result.chunk.startTime,
      endTime: result.chunk.endTime,
      duration: result.chunk.endTime - result.chunk.startTime,
      status: 'INSIGHTS_GATHERED',
      insights: result.insights, // Store as unstructured markdown string
      modelUsed: result.modelUsed,
      processingTime: result.processingTime,
      gatheredAt: new Date(),
    };

    return await this.videoInsightModel.create(insightData);
  }

  /**
   * Save failed insight attempt to database
   */
  private async saveFailedInsightToDatabase(
    contentId: string | Types.ObjectId,
    chunkData: any,
    error: string,
    attemptNumber: number,
  ): Promise<void> {
    const failedInsightData = {
      contentId: new Types.ObjectId(contentId),
      chunkIndex: chunkData.chunkIndex,
      startTime: chunkData.startTime,
      endTime: chunkData.endTime,
      duration: chunkData.endTime - chunkData.startTime,
      status: 'FAILED',
      error: error,
      processingTime: 0,
      gatheredAt: new Date(),
    };

    await this.videoInsightModel.create(failedInsightData);
    this.logger.error(
      `💾 Saved failed insight for chunk ${chunkData.chunkIndex + 1} (attempt ${attemptNumber})`,
    );
  }

  /**
   * Check if error is due to quota exhaustion
   */
  private isQuotaExhaustedError(error: any): boolean {
    const errorMessage = error?.message || '';
    const quotaKeywords = [
      'quota',
      'rate limit',
      'too many requests',
      'limit exceeded',
      'rate exceeded',
    ];

    return (
      error?.status === 429 ||
      error?.code === 429 ||
      quotaKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase()),
      )
    );
  }

  /**
   * Check if error is due to model overload
   */
  private isModelOverloadedError(error: any): boolean {
    const errorMessage = error?.message || '';
    const overloadKeywords = [
      'overloaded',
      'UNAVAILABLE',
      'Service Unavailable',
      'try again later',
      'capacity',
    ];

    return (
      error?.status === 503 ||
      error?.code === 503 ||
      overloadKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase()),
      )
    );
  }
}
