import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Worker } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { VideoInsight } from '../schemas/video-insight.schema';
import { ResearchResult } from '../schemas/research-result.schema';
import { Prompt } from '../schemas/prompt.schema';
import { ResearchService } from '../services/research.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { Logger } from '@nestjs/common';

interface ResearchJobData {
  contentId: string;
  promptId: string;
  forceModel?: string;
  retryCount?: number;
  // Remove videoInfo since we'll load it from database using contentId
  // All data will be loaded from database using the IDs
}

@Processor('research-processing', {
  limiter: {
    max: 8, // Moderate rate limit for research tasks
    duration: 60000, // 1 minute
  },
})
export class ResearchPromptProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchPromptProcessingProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(VideoInsight.name)
    private videoInsightModel: Model<VideoInsight>,
    @InjectModel(ResearchResult.name)
    private researchResultModel: Model<ResearchResult>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    private researchService: ResearchService,
    private quotaManager: QuotaManagerService,
    private rateLimitService: BullMQRateLimitService,
  ) {
    super();
  }

  async process(job: Job<ResearchJobData, any, string>): Promise<any> {
    const { contentId, promptId, forceModel, retryCount = 0 } = job.data;
    let selectedModel = forceModel; // Declare here for broader scope

    this.logger.log(
      `🔬 Processing research prompt ${promptId} for content ${contentId} (retry ${retryCount})`,
    );

    try {
      // Pre-check quota and apply rate limiting if needed
      // TODO: Use a more accurate estimate based on prompt type and content size
      // ai.models.countTokens(..._
      const estimatedTokens = 30000; // Conservative estimate for single prompt processing

      if (!selectedModel) {
        const modelResult =
          await this.quotaManager.findBestAvailableModel(estimatedTokens);
        if (!modelResult.model) {
          throw new Error(
            `No models available for research processing: ${modelResult.reason}`,
          );
        }
        selectedModel = modelResult.model;
      }

      if (selectedModel) {
        const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
          this.worker,
          selectedModel,
          estimatedTokens,
        );

        if (rateLimitResult.applied) {
          this.logger.warn(
            `⏳ Pre-emptive rate limit applied for research processing ${contentId}+${promptId}: ${rateLimitResult.reason}`,
          );
          throw Worker.RateLimitError();
        }
      }

      // Verify content and prompt exist before processing
      const [content, prompt] = await Promise.all([
        this.contentModel.findById(contentId).exec(),
        this.promptModel.findById(promptId).exec(),
      ]);

      if (!content) throw new Error(`Content ${contentId} not found`);
      if (!prompt) throw new Error(`Prompt ${promptId} not found`);

      this.logger.log(
        `📊 Processing prompt "${prompt.promptName}" for content "${content.title}"`,
      );

      // Update research result status to processing
      await this.researchResultModel.updateOne(
        {
          contentId: new Types.ObjectId(contentId),
          promptId: new Types.ObjectId(promptId),
        },
        { status: 'PROCESSING' },
        { upsert: true },
      );

      // Process research prompt using database IDs (service will load all data)
      const researchResult = await this.researchService.processPrompt(
        contentId,
        promptId,
        selectedModel,
      );

      if (!researchResult) {
        throw new Error(
          'Research prompt processing failed - no result returned',
        );
      }

      // Record quota usage for the model used
      if (selectedModel) {
        await this.quotaManager.recordRequest(selectedModel, 3000); // Estimated tokens for single prompt
      }

      // Save research result
      await this.researchResultModel.updateOne(
        {
          contentId: new Types.ObjectId(contentId),
          promptId: new Types.ObjectId(promptId),
        },
        {
          status: 'COMPLETED',
          result: researchResult,
          modelUsed: selectedModel,
          processedAt: new Date(),
          tokensUsed: 3000, // Estimate or actual if available
        },
        { upsert: true },
      );

      this.logger.log(
        `✅ Research prompt processing completed for content ${contentId} + prompt ${promptId} using model ${selectedModel}`,
      );

      return {
        success: true,
        contentId,
        promptId,
        processedAt: new Date(),
        modelUsed: selectedModel || 'auto-selected',
      };
    } catch (error) {
      // If this is a RateLimitError, don't log as an exception
      if (error instanceof Error && error.name === 'RateLimitError') {
        throw error; // Re-throw to let BullMQ handle it
      }

      this.logger.error(
        `❌ Research prompt processing failed for content ${contentId} + prompt ${promptId}: ${error.message}`,
      );

      // Check if this is a quota-related error that should trigger rate limiting
      if (this.isQuotaError(error)) {
        const modelUsed = selectedModel || 'unknown';

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

          // Throw RateLimitError to signal BullMQ about rate limiting
          throw Worker.RateLimitError();
        }

        // If RPD violation, mark as failed
        const parsedError = this.quotaManager.parseQuotaError(error);
        if (parsedError?.isRpdViolation) {
          await this.researchResultModel.updateOne(
            {
              contentId: new Types.ObjectId(contentId),
              promptId: new Types.ObjectId(promptId),
            },
            {
              status: 'FAILED',
              error: `Daily quota exhausted: ${error.message}`,
              failedAt: new Date(),
            },
            { upsert: true },
          );

          this.logger.error(
            `🛑 Daily quota exhausted for research processing ${contentId}+${promptId}, marking as failed`,
          );
          throw new Error(`Daily quota exhausted, job will not be retried`);
        }
      }

      // For other errors, mark research as failed if this is the final attempt
      if (retryCount >= 2) {
        // 3 total attempts (0-2)
        await this.researchResultModel.updateOne(
          {
            contentId: new Types.ObjectId(contentId),
            promptId: new Types.ObjectId(promptId),
          },
          {
            status: 'FAILED',
            error: `Research processing failed after ${retryCount + 1} attempts: ${error.message}`,
            failedAt: new Date(),
          },
          { upsert: true },
        );
      }

      throw error;
    }
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
  onCompleted(job: Job<ResearchJobData>) {
    this.logger.log(
      `✅ Research prompt processing completed for content: ${job.data.contentId} + prompt: ${job.data.promptId}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ResearchJobData>, err: Error) {
    this.logger.error(
      `❌ Research prompt processing failed for content: ${job.data.contentId} + prompt: ${job.data.promptId} - ${err.message}`,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(job: Job<ResearchJobData>) {
    this.logger.warn(
      `⚠️ Research prompt processing stalled for content: ${job.data.contentId} + prompt: ${job.data.promptId}`,
    );
  }
}
