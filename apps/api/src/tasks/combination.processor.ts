import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue, Worker } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { VideoCombinationService } from '../services/video-combination.service';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { Logger } from '@nestjs/common';

interface CombinationJobData {
  contentId: string;
  forceModel?: string;
  retryCount?: number;
}

@Processor('combination', {
  limiter: {
    max: 8, // Moderate rate limit for combination tasks
    duration: 60000, // 1 minute
  },
})
export class CombinationProcessor extends WorkerHost {
  private readonly logger = new Logger(CombinationProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    private videoCombinationService: VideoCombinationService,
    private videoAnalysisService: VideoAnalysisService,
    private quotaManager: QuotaManagerService,
    private rateLimitService: BullMQRateLimitService,
    @InjectQueue('combination') private combinationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<CombinationJobData, any, string>): Promise<any> {
    const { contentId, forceModel, retryCount = 0 } = job.data;
    let selectedModel = forceModel; // Declare here for broader scope

    this.logger.log(
      `🔄 Starting combination for content ${contentId} (retry ${retryCount})`,
    );

    try {
      // Pre-check quota and apply rate limiting if needed
      const estimatedTokens = 50000; // Conservative estimate for combination task
      
      if (!selectedModel) {
        const modelResult = await this.quotaManager.findBestAvailableModel(estimatedTokens);
        selectedModel = modelResult.model;
      }
      
      if (selectedModel) {
        const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
          this.worker as Worker,
          selectedModel,
          estimatedTokens
        );
        
        if (rateLimitResult.applied) {
          this.logger.warn(
            `⏳ Pre-emptive rate limit applied for combination ${contentId}: ${rateLimitResult.reason}`
          );
          throw Worker.RateLimitError();
        }
      }

      await this.checkQuotaAndWait(contentId, forceModel);

      // Get content and prepare video info for combination
      const content = await this.contentModel.findById(contentId).exec();
      if (!content) {
        throw new Error(`Content ${contentId} not found`);
      }

      const videoInfo = {
        title: content.title || 'Video',
        description: content.description || '',
        duration: content.metadata?.duration || 0,
        channel: content.metadata?.channel || 'Unknown',
        view_count: content.metadata?.viewCount || 0,
        upload_date: content.publishedAt,
      };

      // Perform the combination
      const combinedAnalysis = await this.videoAnalysisService.combineChunkAnalysesUsingAI(
        contentId,
        videoInfo,
        selectedModel,
      );

      if (!combinedAnalysis) {
        throw new Error('Combination failed - no result returned');
      }

      // Record quota usage for the model used
      if (selectedModel) {
        await this.quotaManager.recordRequest(selectedModel, 5000); // Estimated tokens for combination
      }

      // Update content status
      await this.contentModel.updateOne(
        { _id: contentId },
        {
          status: 'COMPLETED',
          completedAt: new Date(),
          'analysis.result': combinedAnalysis,
          'analysis.modelUsed': selectedModel,
          'analysis.combinedAt': new Date(),
        },
      );

      this.logger.log(
        `✅ Combination completed for content ${contentId} using model ${selectedModel}`,
      );

      return {
        success: true,
        contentId,
        combinedAt: new Date(),
        modelUsed: selectedModel || 'auto-selected',
      };
    } catch (error) {
      // If this is a RateLimitError, don't log as an exception
      if (error instanceof Error && error.name === 'RateLimitError') {
        throw error; // Re-throw to let BullMQ handle it
      }
      
      this.logger.error(
        `❌ Combination job failed for content ${contentId}: ${error.message}`,
      );

      // Check if this is a quota-related error that should trigger rate limiting
      if (this.isQuotaError(error)) {
        const modelUsed = selectedModel || 'unknown';
        
        // Use the rate limiting service to handle quota violations
        const rateLimitResult = await this.rateLimitService.handleQuotaViolation(
          this.worker as Worker,
          modelUsed,
          error
        );
        
        if (rateLimitResult.rateLimited) {
          this.logger.warn(
            `📊 Quota violation handled with rate limiting for model ${modelUsed}, retry in ${rateLimitResult.retryDelayMs}ms`
          );
          
          // Throw RateLimitError to signal BullMQ about rate limiting
          throw Worker.RateLimitError();
        }
        
        // If RPD violation, mark as failed
        const parsedError = this.quotaManager.parseQuotaError(error);
        if (parsedError?.isRpdViolation) {
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