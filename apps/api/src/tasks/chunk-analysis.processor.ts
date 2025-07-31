import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue, Worker } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VideoChunk } from '../schemas/video-chunk.schema';
import { Content } from '../schemas/content.schema';
import { Prompt } from '../schemas/prompt.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { VideoCombinationService } from '../services/video-combination.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { Logger } from '@nestjs/common';

@Processor('chunk-analysis', {
  limiter: {
    max: 10, // Base rate limit
    duration: 60000, // 1 minute
  },
})
export class ChunkAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(ChunkAnalysisProcessor.name);

  constructor(
    @InjectModel(VideoChunk.name) private videoChunkModel: Model<VideoChunk>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    private videoAnalysisService: VideoAnalysisService,
    private videoCombinationService: VideoCombinationService,
    private enhancedQuotaManager: QuotaManagerService,
    private rateLimitService: BullMQRateLimitService,
    @InjectQueue('combination') private combinationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const {
      contentId,
      chunkData,
      youtubeUrl,
      videoInfo,
      promptId,
      forceModel,
    } = job.data;
    const attemptNumber = job.attemptsMade;
    const maxAttempts = job.opts.attempts || 1;

    this.logger.log(
      `🔍 Analyzing chunk ${chunkData.chunkIndex + 1}/${chunkData.totalChunks} for content ${contentId} (attempt ${attemptNumber + 1}/${maxAttempts})`,
    );

    try {
      // Pre-check quota and apply rate limiting if needed
      const estimatedTokens = this.estimateTokensForChunk(chunkData, videoInfo);
      const selectedModel =
        forceModel || (await this.selectBestModel(estimatedTokens));

      if (selectedModel) {
        const rateLimitResult = await this.rateLimitService.applyQuotaRateLimit(
          this.worker,
          selectedModel,
          estimatedTokens,
        );

        if (rateLimitResult.applied) {
          // Throw RateLimitError to signal BullMQ that this is a rate limit issue
          this.logger.warn(
            `⏳ Pre-emptive rate limit applied for chunk ${chunkData.chunkIndex + 1}: ${rateLimitResult.reason}`,
          );
          throw Worker.RateLimitError();
        }
      }

      // Get the prompt
      const prompt = await this.promptModel.findById(promptId).exec();
      if (!prompt) {
        throw new Error(`Prompt with ID ${promptId} not found`);
      }

      this.logger.log(
        `📋 Using prompt: "${prompt.promptName}" (v${prompt.version || 'unknown'})`,
      );

      // Call the original chunk analysis method from VideoAnalysisService
      const result = await this.videoAnalysisService.analyzeVideoChunkDirect(
        youtubeUrl,
        videoInfo,
        chunkData,
        prompt,
        forceModel,
      );

      // Check if the analysis was successful
      if (!result.success) {
        this.logger.error(
          `❌ Chunk analysis failed for chunk ${chunkData.chunkIndex + 1}: ${result.error}`,
        );

        // Save failed chunk to database
        await this.saveFailedChunkToDatabase(
          contentId,
          chunkData,
          result.error,
          attemptNumber + 1,
        );

        // Create an error object to determine retry strategy
        const error = {
          message: result.error,
          status: result.isModelOverloaded ? 503 : 429, // Assume quota exhaustion if not overloaded
        };

        // Enhanced error handling with BullMQ rate limiting
        if (this.isQuotaExhaustedError(error)) {
          const modelUsed = result.modelUsed || forceModel || 'unknown';

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
        } else if (this.isModelOverloadedError(error)) {
          this.logger.warn(`📊 Model overloaded - applying rate limit`);

          // Apply a shorter rate limit for model overload
          await this.worker.rateLimit(30000); // 30 seconds
          throw Worker.RateLimitError();
        }

        // For other errors, throw normally to trigger standard retry
        throw new Error(result.error);
      }

      // Success case - record the request and save chunk
      if (result.modelUsed) {
        await this.enhancedQuotaManager.recordRequest(
          result.modelUsed,
          result.tokensUsed || estimatedTokens,
        );
      }

      const chunkDocument = await this.saveChunkToDatabase(
        contentId,
        result,
        prompt,
      );

      this.logger.log(
        `✅ Successfully analyzed chunk ${chunkData.chunkIndex + 1}/${chunkData.totalChunks} for content ${contentId}`,
      );

      // Check if this was the last chunk
      if (chunkData.chunkIndex + 1 === chunkData.totalChunks) {
        this.logger.log(
          `🎯 Last chunk completed for content ${contentId}. Triggering combination job.`,
        );

        await this.combinationQueue.add(
          'combination',
          { contentId, forceModel },
          {
            delay: 2000, // Small delay to ensure all chunks are saved
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 30000,
            },
            removeOnComplete: 10,
            removeOnFail: 20,
          },
        );
      }

      return { success: true, chunkId: chunkDocument._id };
    } catch (error) {
      // If this is a RateLimitError, don't log as an exception
      if (error instanceof Error && error.name === 'RateLimitError') {
        throw error; // Re-throw to let BullMQ handle it
      }

      this.logger.error(
        `❌ Exception during chunk analysis ${chunkData.chunkIndex + 1} for content ${contentId}: ${error.message}`,
      );

      // For exceptions, save failed chunk to database if not already saved and this is the final attempt
      if (
        !error.message.includes('Quota exhausted') &&
        !error.message.includes('Model overloaded') &&
        attemptNumber + 1 >= maxAttempts
      ) {
        await this.saveFailedChunkToDatabase(
          contentId,
          chunkData,
          error.message,
          attemptNumber + 1,
        );
        this.logger.error(
          `❌ Analysis failed permanently for content ${contentId}. Reason: ${error.message}`,
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
    // Base estimation for video chunk processing
    const baseTokens = 5000; // Base tokens for system prompts and structure

    // Add tokens based on chunk duration (longer chunks = more content)
    const durationTokens = Math.ceil(chunkData.duration * 50); // ~50 tokens per second

    // Add tokens based on video metadata if available
    const metadataTokens = videoInfo?.description
      ? this.enhancedQuotaManager.estimateTokenCount(videoInfo.description)
      : 500;

    return baseTokens + durationTokens + Math.min(metadataTokens, 2000); // Cap metadata tokens
  }

  /**
   * Select the best available model for processing
   */
  private async selectBestModel(
    estimatedTokens: number,
  ): Promise<string | null> {
    const modelResult =
      await this.enhancedQuotaManager.findBestAvailableModel(estimatedTokens);
    return modelResult.model;
  }

  private async saveChunkToDatabase(
    contentId: string | Types.ObjectId,
    chunkResult: any,
    prompt: any,
  ): Promise<any> {
    const chunkData = {
      contentId: new Types.ObjectId(contentId),
      chunkIndex: chunkResult.chunk.chunkIndex,
      startTime: chunkResult.chunk.startTime,
      endTime: chunkResult.chunk.endTime,
      duration: chunkResult.chunk.duration,
      status: chunkResult.success
        ? 'ANALYZED'
        : chunkResult.isModelOverloaded
          ? 'OVERLOADED'
          : 'FAILED',
      analysisResult: chunkResult.success ? chunkResult.analysis : undefined,
      modelUsed: chunkResult.modelUsed,
      processingTime: chunkResult.processingTime,
      error: chunkResult.error,
      promptIdUsed: prompt?._id,
      promptVersionUsed: prompt?.version || 'unknown',
    };

    return await this.videoChunkModel.create(chunkData);
  }

  private async saveFailedChunkToDatabase(
    contentId: string | Types.ObjectId,
    chunkData: any,
    errorMessage: string,
    retryCount: number,
  ): Promise<void> {
    const failedChunkData = {
      contentId: new Types.ObjectId(contentId),
      chunkIndex: chunkData.chunkIndex,
      startTime: chunkData.startTime,
      endTime: chunkData.endTime,
      duration: chunkData.duration,
      status: 'FAILED',
      error: errorMessage,
      retryCount: retryCount,
    };

    await this.videoChunkModel.findOneAndUpdate(
      {
        contentId: new Types.ObjectId(contentId),
        chunkIndex: chunkData.chunkIndex,
      },
      failedChunkData,
      { upsert: true },
    );
  }

  private isQuotaExhaustedError(error: any): boolean {
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

    // Also check if the error message contains JSON with quota information
    try {
      if (errorMessage.includes('{') && errorMessage.includes('quota')) {
        const jsonMatch = errorMessage.match(/\{.*\}/s);
        if (jsonMatch) {
          const parsedError = JSON.parse(jsonMatch[0]);
          if (parsedError.error && parsedError.error.code === 429) {
            return true;
          }
        }
      }
    } catch (parseError) {
      // Ignore JSON parsing errors
    }

    return quotaKeywords.some((keyword) =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase()),
    );
  }

  private isModelOverloadedError(error: any): boolean {
    if (error.status === 503 || error.code === 503) {
      return true;
    }

    const errorMessage = error?.message || error?.error?.message || '';
    const overloadKeywords = [
      'overloaded',
      'UNAVAILABLE',
      'Service Unavailable',
      'try again later',
      'capacity',
    ];

    // Also check if the error message contains JSON with overload information
    try {
      if (errorMessage.includes('{') && errorMessage.includes('UNAVAILABLE')) {
        const jsonMatch = errorMessage.match(/\{.*\}/s);
        if (jsonMatch) {
          const parsedError = JSON.parse(jsonMatch[0]);
          if (parsedError.error && parsedError.error.code === 503) {
            return true;
          }
        }
      }
    } catch (parseError) {
      // Ignore JSON parsing errors
    }

    return overloadKeywords.some((keyword) =>
      errorMessage.toLowerCase().includes(keyword.toLowerCase()),
    );
  }

  /**
   * Check if all chunks are complete and auto-trigger combination if ready
   * This separates automatic combination (after chunk completion) from manual combination
   */
  private async checkAndAutoTriggerCombination(
    contentId: string,
  ): Promise<void> {
    try {
      // Check combination status
      const status =
        await this.videoCombinationService.getCombinationStatus(contentId);

      this.logger.log(
        `📊 Combination status for content ${contentId}: ${status.status} - ${status.completedChunks}/${status.expectedChunks} completed, ${status.failedChunks} failed`,
      );

      // Only auto-trigger if all chunks are completed successfully (not partial)
      if (status.canCombine && status.status === 'READY') {
        this.logger.log(
          `🚀 All chunks ready for content ${contentId}, queuing combination job...`,
        );

        // Queue the combination job with quota-aware processing
        const combinationJob = await this.combinationQueue.add(
          'combine-chunks',
          {
            contentId: contentId,
            retryCount: 0,
          },
          {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 5 * 60 * 1000, // 5 minutes base delay
            },
            removeOnComplete: 5,
            removeOnFail: 10,
            // Custom delay handling for quota limits will be done in the processor
          },
        );

        this.logger.log(
          `✅ Combination job queued for content ${contentId} (Job ID: ${combinationJob.id})`,
        );
      } else if (status.status === 'PARTIAL') {
        this.logger.warn(
          `⚠️ Content ${contentId} has partial completion (${status.completedChunks}/${status.expectedChunks} successful, ${status.failedChunks} failed). Manual combination required.`,
        );
      } else if (!status.canCombine) {
        this.logger.debug(
          `⏳ Content ${contentId} not ready for combination: ${status.reason}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error checking combination status for content ${contentId}: ${error.message}`,
      );
    }
  }
}
