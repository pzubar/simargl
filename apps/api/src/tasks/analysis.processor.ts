import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue, Worker } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { EnhancedQuotaManagerService } from '../services/enhanced-quota-manager.service';
import { Logger } from '@nestjs/common';
import { ChannelsService } from '../channels/channels.service';

export type AnalysisQueueData = Queue<
  { contentId: string; hasMetadata: boolean },
  any,
  string
>;

@Processor('analysis', {
  limiter: {
    max: 5, // Conservative rate limit for full video analysis
    duration: 60000, // 1 minute
  },
})
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  // Retry configuration for overload errors
  private readonly OVERLOAD_RETRY_DELAY_BASE = 30000; // 30 seconds base delay
  private readonly MAX_OVERLOAD_RETRIES = 3; // Maximum retries for overload errors

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('stats') private statsQueue: Queue,
    private videoAnalysisService: VideoAnalysisService,
    private rateLimitService: BullMQRateLimitService,
    private quotaManager: EnhancedQuotaManagerService,
    private channelsService: ChannelsService,
  ) {
    super();
  }

  /**
   * Check if error indicates model overload (retryable)
   */
  private isOverloadError(error: any): boolean {
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

  /**
   * Check if error is due to invalid data (non-retryable)
   */
  private isValidationError(error: any): boolean {
    const errorMessage = error?.message || '';
    const validationKeywords = [
      'not found',
      'invalid',
      'required',
      'missing',
      'malformed',
      'bad request',
      'validation',
      'content with id',
      'database query failed',
      'no default prompt',
      'video not found',
      'invalid youtube url',
    ];

    return (
      error?.status === 400 ||
      error?.status === 404 ||
      error?.code === 400 ||
      error?.code === 404 ||
      validationKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase()),
      )
    );
  }

  /**
   * Check if analysis result indicates overloaded chunks
   */
  private hasOverloadedChunks(analysisResult: any): boolean {
    return (
      analysisResult?.hasOverloadedChunks === true ||
      analysisResult?.failedChunks > 0
    );
  }

  async process(
    job: Job<{ contentId: string; hasMetadata: boolean }, any, string>,
  ): Promise<any> {
    const attemptNumber = job.attemptsMade;
    const maxAttempts = job.opts.attempts || 1;
    let selectedModel: string | null = null; // Declare here for broader scope

    this.logger.log(
      `🔍 Analyzing content: ${job.data.contentId} (attempt ${attemptNumber + 1}/${maxAttempts})`,
    );

    const content = await this.contentModel.findById(job.data.contentId).exec();

    if (!content?.channelId) {
      this.logger.error(`❌ Content with id ${job.data.contentId} not found.`);
      return;
    }

    const channel = await this.channelsService.getChannelById(
      content.channelId,
    );

    if (!channel) {
      this.logger.error(`❌ Channel with id ${content.channelId} not found.`);
      return;
    }

    try {
      const youtubeUrl = `https://www.youtube.com/watch?v=${content.sourceContentId}`;
      this.logger.log(`🚀 Starting video analysis for: ${youtubeUrl}`);

      // Check if metadata exists
      let existingMetadata = null;
      if (content.metadata) {
        this.logger.log(`📊 Using existing metadata from database`);
        existingMetadata = content.metadata;
      } else if (job.data.hasMetadata) {
        // Refetch the content to get updated metadata
        const updatedContent = await this.contentModel
          .findById(job.data.contentId)
          .exec();
        if (updatedContent?.metadata) {
          this.logger.log(`📊 Found fresh metadata in database`);
          existingMetadata = updatedContent.metadata;
        }
      }

      if (!existingMetadata) {
        this.logger.warn(
          `⚠️ No metadata found for content ${content._id}. Analysis may be less efficient.`,
        );
      }

      // Pre-check quota and apply rate limiting if needed
      const estimatedTokens = this.estimateTokensForVideo(
        content,
        existingMetadata,
      );
      selectedModel =
        job.data.forceModel || (await this.selectBestModel(estimatedTokens));

      if (selectedModel) {
        const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
          this.worker,
          selectedModel,
          estimatedTokens,
        );

        if (rateLimitResult.applied) {
          this.logger.warn(
            `⏳ Pre-emptive rate limit applied for content ${content._id}: ${rateLimitResult.reason}`,
          );
          throw Worker.RateLimitError();
        }
      }

      // Pass existing metadata to analysis service
      const analysisResult =
        await this.videoAnalysisService.analyzeYouTubeVideo(
          youtubeUrl,
          content._id.toString(), // Pass content ID for database operations
          existingMetadata,
          job.data.forceModel, // Pass through forced model if specified
        );

      if (!analysisResult) {
        throw new Error('Analysis service returned null/undefined result');
      }
      const { analysis, prompt, modelUsed, modelUsageStats } = analysisResult;

      // Check if analysis had overloaded chunks that might benefit from retry
      if (this.hasOverloadedChunks(analysisResult)) {
        this.logger.warn(
          `⚠️ Analysis completed but had overloaded chunks. Successful: ${
            analysisResult.failedChunks
              ? (analysisResult.chunkResults?.length || 0) -
                analysisResult.failedChunks
              : 'N/A'
          }`,
        );

        // If we have significant failures and haven't exceeded max retries, consider rescheduling
        const failureRate =
          analysisResult.failedChunks /
          (analysisResult.chunkResults?.length || 1);
        if (failureRate > 0.3 && attemptNumber < this.MAX_OVERLOAD_RETRIES) {
          throw new Error(
            `High failure rate due to overload (${(failureRate * 100).toFixed(1)}%) - rescheduling for retry`,
          );
        }
      }

      await this.contentModel.updateOne(
        { _id: content._id },
        {
          analysis: {
            promptVersion: prompt.version,
            promptName: prompt.promptName,
            promptId: prompt._id,
            modelUsed: modelUsed,
            result: analysis,
            retryCount: attemptNumber,
            processingNotes: analysisResult.hasOverloadedChunks
              ? 'Completed with some overload issues'
              : 'Completed successfully',
          },
          status: 'ANALYZED',
        },
      );

      this.logger.log(`✅ Analysis completed using model: ${modelUsed}`);
      if (modelUsageStats && Object.keys(modelUsageStats).length > 1) {
        this.logger.log(`📊 Model usage breakdown:`, modelUsageStats);
      }

      this.logger.log(
        `✅ Successfully analyzed video: ${content.title || 'Unknown'}`,
      );
      await this.statsQueue.add('update-stats', { contentId: content._id });
    } catch (error) {
      this.logger.error(
        `❌ Failed to analyze content ${content._id}: ${error.message}`,
      );

      // Classify error type
      const isValidation = this.isValidationError(error);
      const isOverload = this.isOverloadError(error);

      this.logger.debug(
        `📊 Error classification: validation=${isValidation}, overload=${isOverload}`,
      );

      // Don't retry validation errors
      if (isValidation) {
        this.logger.error(
          `❌ Validation error - analysis will NOT be retried for content ${content._id}: ${error.message}`,
        );

        await this.contentModel.updateOne(
          { _id: content._id },
          {
            status: 'FAILED',
            lastError: `Validation error: ${error.message}`,
            retryCount: attemptNumber + 1,
          },
        );

        // Don't re-throw validation errors to prevent retry
        return;
      }

      // Handle quota and overload errors with rate limiting
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

          // Update status to indicate retry is pending due to quota
          await this.contentModel.updateOne(
            { _id: content._id },
            {
              status: 'RETRY_PENDING',
              lastError: `Quota exceeded: ${error.message}`,
              retryCount: attemptNumber + 1,
            },
          );

          // Throw RateLimitError to signal BullMQ about rate limiting
          throw Worker.RateLimitError();
        }
      }

      // Handle overload errors with retry logic
      if (isOverload && attemptNumber < this.MAX_OVERLOAD_RETRIES) {
        this.logger.warn(
          `🔄 Overload error detected. Applying rate limit and retrying (attempt ${attemptNumber + 1}/${this.MAX_OVERLOAD_RETRIES})`,
        );

        // Apply rate limit for overload
        await this.worker.rateLimit(this.calculateRetryDelay(attemptNumber));

        // Update status to indicate retry is pending
        await this.contentModel.updateOne(
          { _id: content._id },
          {
            status: 'RETRY_PENDING',
            lastError: error.message,
            retryCount: attemptNumber + 1,
          },
        );

        // Throw RateLimitError instead of generic error
        throw Worker.RateLimitError();
      } else {
        // Mark as failed if not retryable or max retries exceeded
        const reason = isOverload
          ? `Max overload retries exceeded (${attemptNumber + 1}/${this.MAX_OVERLOAD_RETRIES})`
          : 'Non-retryable error';

        this.logger.error(
          `❌ Analysis failed permanently for content ${content._id}. Reason: ${reason}`,
        );

        await this.contentModel.updateOne(
          { _id: content._id },
          {
            status: 'FAILED',
            lastError: error.message,
            retryCount: attemptNumber + 1,
          },
        );
      }
    }

    return {};
  }

  /**
   * Calculate exponential backoff delay for retries
   */
  private calculateRetryDelay(attemptNumber: number): number {
    return this.OVERLOAD_RETRY_DELAY_BASE * Math.pow(2, attemptNumber);
  }

  /**
   * Estimate token count for full video analysis
   */
  private estimateTokensForVideo(content: any, metadata: any): number {
    const baseTokens = 10000; // Base tokens for system prompts and structure

    // Add tokens based on video duration if available
    const durationTokens = metadata?.duration
      ? Math.ceil(metadata.duration * 100)
      : 30000; // Default for ~5min video

    // Add tokens based on description and title
    const textTokens = content.title
      ? this.quotaManager.estimateTokenCount(
          content.title + ' ' + (content.description || ''),
        )
      : 1000;

    return (
      baseTokens + Math.min(durationTokens, 50000) + Math.min(textTokens, 5000)
    );
  }

  /**
   * Select the best available model for analysis
   */
  private async selectBestModel(
    estimatedTokens: number,
  ): Promise<string | null> {
    const modelResult =
      await this.quotaManager.findBestAvailableModel(estimatedTokens);
    return modelResult.model;
  }

  /**
   * Check if error is quota-related
   */
  private isQuotaError(error: any): boolean {
    if (error.status === 429 || error.code === 429) {
      return true;
    }

    const errorMessage = error?.message || error?.error?.message || '';
    const quotaKeywords = [
      'quota',
      'RESOURCE_EXHAUSTED',
      'Too Many Requests',
      'exceeded your current quota',
      'GenerateContentInputTokensPerModelPerMinute',
      'GenerateContentInputTokensPerModelPerDay',
      'QuotaFailure',
    ];

    return quotaKeywords.some((keyword) =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase()),
    );
  }
}
