import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VideoChunk } from '../schemas/video-chunk.schema';
import { Content } from '../schemas/content.schema';
import { Prompt } from '../schemas/prompt.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { VideoCombinationService } from '../services/video-combination.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { Logger } from '@nestjs/common';

@Processor('chunk-analysis')
export class ChunkAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(ChunkAnalysisProcessor.name);

  constructor(
    @InjectModel(VideoChunk.name) private videoChunkModel: Model<VideoChunk>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    private videoAnalysisService: VideoAnalysisService,
    private videoCombinationService: VideoCombinationService,
    private enhancedQuotaManager: QuotaManagerService,
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

        // Enhanced error handling with quota parsing
        if (this.isQuotaExhaustedError(error)) {
          // Use enhanced quota manager to parse error details
          const parsedError = this.enhancedQuotaManager.parseQuotaError(error);
          const modelUsed = result.modelUsed || forceModel || 'unknown';
          
          if (parsedError?.isRpdViolation) {
            // RPD violation - don't retry today
            this.logger.error(
              `🛑 Daily quota exceeded for chunk ${chunkData.chunkIndex + 1} using model ${modelUsed}. Marking as permanently failed for today.`,
            );
            await this.enhancedQuotaManager.recordQuotaViolation(modelUsed, error);
            throw new Error(`Daily quota exhausted: ${result.error}`);
          } else if (parsedError?.isRpmViolation && parsedError.retryDelaySeconds > 0) {
            // RPM violation with retry delay
            this.logger.warn(
              `📊 RPM quota exhausted for chunk ${chunkData.chunkIndex + 1} using model ${modelUsed}. Will retry after ${parsedError.retryDelaySeconds}s`,
            );
            await this.enhancedQuotaManager.recordQuotaViolation(modelUsed, error);
            throw new Error(`RPM quota exhausted, retry in ${parsedError.retryDelaySeconds}s: ${result.error}`);
          } else {
            // Generic quota exhaustion
            this.logger.warn(`📊 Quota exhausted for model ${modelUsed} - will retry chunk later`);
            await this.enhancedQuotaManager.recordQuotaViolation(modelUsed, error);
            throw new Error(`Quota exhausted: ${result.error}`);
          }
        } else if (this.isModelOverloadedError(error)) {
          this.logger.warn(`📊 Model overloaded - will retry chunk later`);
          throw new Error(`Model overloaded: ${result.error}`);
        } else if (attemptNumber + 1 >= maxAttempts) {
          // Only mark as non-retryable if we've exhausted all attempts
          this.logger.error(
            `❌ Analysis failed permanently for chunk ${chunkData.chunkIndex + 1} after ${maxAttempts} attempts: ${result.error}`,
          );
          throw new Error(`Non-retryable error: ${result.error}`);
        } else {
          // Retry for other errors (parsing failures, network issues, etc.)
          this.logger.warn(
            `⚠️ Chunk analysis failed (attempt ${attemptNumber + 1}/${maxAttempts}), will retry: ${result.error}`,
          );
          throw new Error(`Retryable error: ${result.error}`);
        }
      }

      // Save the successful result to database
      const chunkDocument = await this.saveChunkToDatabase(
        contentId,
        result,
        prompt,
      );

      this.logger.log(
        `✅ Successfully analyzed chunk ${chunkData.chunkIndex + 1} for content ${contentId}`,
      );

      // Check if all chunks are complete and auto-trigger combination if needed
      await this.checkAndAutoTriggerCombination(contentId);

      return { success: true, chunkId: chunkDocument._id };
    } catch (error) {
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
  private async checkAndAutoTriggerCombination(contentId: string): Promise<void> {
    try {
      // Check combination status
      const status = await this.videoCombinationService.getCombinationStatus(contentId);
      
      this.logger.log(
        `📊 Combination status for content ${contentId}: ${status.status} - ${status.completedChunks}/${status.expectedChunks} completed, ${status.failedChunks} failed`,
      );

      // Only auto-trigger if all chunks are completed successfully (not partial)
      if (status.canCombine && status.status === 'READY') {
        this.logger.log(
          `🚀 All chunks ready for content ${contentId}, auto-triggering combination...`,
        );
        
        const result = await this.videoCombinationService.triggerCombination(contentId);
        
        if (result.success) {
          this.logger.log(
            `✅ Auto-combination successful for content ${contentId}: ${result.message}`,
          );
        } else {
          this.logger.error(
            `❌ Auto-combination failed for content ${contentId}: ${result.error}`,
          );
        }
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
