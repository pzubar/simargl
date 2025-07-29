import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { Channel } from '../schemas/channel.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';

export interface CombinationJobData {
  contentId: string;
  forceModel?: string;
  retryCount?: number;
}

@Processor('combination')
export class CombinationProcessor extends WorkerHost {
  private readonly logger = new Logger(CombinationProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    private videoAnalysisService: VideoAnalysisService,
    private quotaManager: QuotaManagerService,
    @InjectQueue('combination') private combinationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<CombinationJobData, any, string>): Promise<any> {
    const { contentId, forceModel, retryCount = 0 } = job.data;

    try {
      this.logger.log(
        `🔄 Starting combination job for content: ${contentId} (attempt ${retryCount + 1})`,
      );

      // Get content and channel info
      const content = await this.contentModel.findById(contentId).exec();
      if (!content) {
        throw new Error(`Content ${contentId} not found`);
      }

      const channel = await this.channelModel.findById(content.channelId).exec();

      const videoInfo = {
        title: content.title || 'Video',
        description: content.description || '',
        duration: content.metadata?.duration || 0,
        channel: content.metadata?.channel || 'Unknown',
        view_count: content.metadata?.viewCount || 0,
        upload_date: content.publishedAt,
        authorContext: channel?.authorContext || 'Unknown',
      };

      // Check quota before attempting combination
      await this.checkQuotaAndWait(contentId, forceModel);

      // Perform the combination
      const combinedResult = await this.videoAnalysisService.combineChunkAnalysesUsingAI(
        contentId,
        videoInfo,
        forceModel,
      );

      // Update the content with the final analysis
      await this.contentModel.updateOne(
        { _id: contentId },
        {
          analysis: {
            result: combinedResult,
            combinedAt: new Date(),
          },
          status: 'ANALYZED',
        },
      );

      this.logger.log(
        `✅ Successfully combined and saved analysis for content ${contentId}`,
      );

      return {
        success: true,
        contentId,
        combinedAt: new Date(),
        modelUsed: forceModel || 'auto-selected',
      };
    } catch (error) {
      this.logger.error(
        `❌ Combination job failed for content ${contentId}: ${error.message}`,
      );

             // Check if this is a quota-related error that should trigger a retry with delay
       if (this.isQuotaError(error)) {
         const parsedError = this.quotaManager.parseQuotaError(error);
         
         if (parsedError?.retryDelaySeconds && parsedError.retryDelaySeconds > 0) {
           this.logger.warn(
             `⏳ Quota exceeded, scheduling retry in ${parsedError.retryDelaySeconds}s`,
           );
           
           // Create a delayed retry job instead of relying on BullMQ's built-in retry
           const retryJob = await this.combinationQueue.add(
             'combination-retry',
             {
               ...job.data,
               retryCount: (job.data.retryCount || 0) + 1,
             },
             {
               delay: parsedError.retryDelaySeconds * 1000, // Convert to milliseconds
               attempts: 1, // Single attempt for the delayed job
               removeOnComplete: 5,
               removeOnFail: 10,
             }
           );
           
           this.logger.log(
             `✅ Delayed retry job scheduled for content ${contentId} (Job ID: ${retryJob.id})`,
           );
           
           // Don't throw error to prevent BullMQ's built-in retry
           return {
             success: false,
             contentId,
             delayed: true,
             retryJobId: retryJob.id,
             retryDelaySeconds: parsedError.retryDelaySeconds,
           };
         }
        
        if (parsedError?.isRpdViolation) {
          // Don't retry for daily quota - mark as failed
          await this.contentModel.updateOne(
            { _id: contentId },
            {
              status: 'FAILED',
              lastError: `Daily quota exhausted: ${error.message}`,
            },
          );
          
          this.logger.error(
            `🛑 Daily quota exhausted for content ${contentId}, marking as failed`,
          );
          throw new Error(`Daily quota exhausted, job will not be retried`);
        }
      }

      // For other errors, mark content as failed if this is the final attempt
      if (retryCount >= 4) { // 5 total attempts (0-4)
        await this.contentModel.updateOne(
          { _id: contentId },
          {
            status: 'FAILED',
            lastError: `Combination failed after ${retryCount + 1} attempts: ${error.message}`,
          },
        );
      }

      throw error;
    }
  }

  private async checkQuotaAndWait(contentId: string, forceModel?: string): Promise<void> {
    // Estimate tokens for combination (text-only, no video)
    const estimatedTokens = 50000; // Conservative estimate for combination task

    let selectedModel: string;
    
    if (forceModel) {
      selectedModel = forceModel;
      this.logger.log(`🎯 Using forced model for combination: ${selectedModel}`);
    } else {
      const modelSelection = await this.quotaManager.findBestAvailableModel(estimatedTokens);
      
      if (!modelSelection.model) {
        throw new Error(`No available models for combination: ${modelSelection.reason}`);
      }
      
      selectedModel = modelSelection.model;
    }

    // Check if we can make the request
    const quotaCheck = await this.quotaManager.canMakeRequest(selectedModel, estimatedTokens);
    
    if (!quotaCheck.allowed) {
      if (quotaCheck.waitTime && quotaCheck.waitTime > 0) {
        this.logger.warn(
          `⏳ Quota limit reached for ${selectedModel}. Waiting ${quotaCheck.waitTime}s before retry. Reason: ${quotaCheck.reason}`,
        );
        
        // Create a delay error that BullMQ can handle
        const delayError = new Error(`Quota limit reached: ${quotaCheck.reason}`);
        (delayError as any).retryDelaySeconds = quotaCheck.waitTime;
        throw delayError;
      }
      
      throw new Error(`Quota check failed: ${quotaCheck.reason}`);
    }

    this.logger.log(`✅ Quota check passed for ${selectedModel} with ${estimatedTokens} tokens`);
  }

  private isQuotaError(error: any): boolean {
    if (error.status === 429 || error.code === 429) {
      return true;
    }

    const errorMessage = error?.message || error?.error?.message || '';
    const quotaKeywords = ['quota', 'RESOURCE_EXHAUSTED', 'Too Many Requests'];

    return quotaKeywords.some((keyword) =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase()),
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CombinationJobData>) {
    this.logger.log(`✅ Combination job completed for content: ${job.data.contentId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CombinationJobData>, err: Error) {
    this.logger.error(`❌ Combination job failed for content: ${job.data.contentId} - ${err.message}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(job: Job<CombinationJobData>) {
    this.logger.warn(`⚠️ Combination job stalled for content: ${job.data.contentId}`);
  }
} 