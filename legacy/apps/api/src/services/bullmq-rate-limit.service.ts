import { Injectable, Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { EnhancedQuotaManagerService } from './enhanced-quota-manager.service';

export interface RateLimitConfig {
  max: number;
  duration: number;
}

export interface QueueRateLimitOptions {
  // Base rate limits that apply when no quota issues are detected
  baseRateLimit: RateLimitConfig;
  // Model-specific rate overrides
  modelRateLimits?: Record<string, RateLimitConfig>;
  // Whether to enable dynamic rate limiting based on quota usage
  enableDynamicLimiting?: boolean;
}

@Injectable()
export class BullMQRateLimitService {
  private readonly logger = new Logger(BullMQRateLimitService.name);

  // Track active rate limits by queue name
  private activeRateLimits = new Map<string, RateLimitConfig>();

  constructor(private quotaManager: EnhancedQuotaManagerService) {}

  /**
   * Get rate limit configuration for a queue based on current quota status
   */
  async getQueueRateLimit(
    queueName: string,
    options: QueueRateLimitOptions,
    model?: string,
  ): Promise<RateLimitConfig> {
    try {
      // Start with base rate limit
      let rateLimit = { ...options.baseRateLimit };

      // Override with model-specific limits if available
      if (model && options.modelRateLimits?.[model]) {
        rateLimit = { ...options.modelRateLimits[model] };
      }

      // Apply dynamic limiting if enabled
      if (options.enableDynamicLimiting && model) {
        const dynamicLimit = await this.calculateDynamicRateLimit(
          model,
          rateLimit,
        );
        rateLimit = dynamicLimit;
      }

      this.activeRateLimits.set(queueName, rateLimit);

      this.logger.debug(
        `📊 Rate limit for ${queueName}: ${rateLimit.max} req/${rateLimit.duration}ms${model ? ` (model: ${model})` : ''}`,
      );

      return rateLimit;
    } catch (error) {
      this.logger.error(
        `❌ Error calculating rate limit for ${queueName}: ${error.message}`,
      );
      return options.baseRateLimit;
    }
  }

  /**
   * Apply rate limiting to a worker when quota is exceeded
   */
  async applyQuotaRateLimit(
    worker: Worker,
    model: string,
    estimatedTokens: number = 1000,
  ): Promise<{ applied: boolean; waitTime?: number; reason?: string }> {
    try {
      // Check current quota status
      const quotaCheck = await this.quotaManager.canMakeRequest(
        model,
        estimatedTokens,
      );

      if (
        !quotaCheck.allowed &&
        quotaCheck.waitTime &&
        quotaCheck.waitTime > 0
      ) {
        // Apply rate limit based on quota wait time
        const rateLimitDuration = Math.min(quotaCheck.waitTime * 1000, 300000); // Max 5 minutes

        await worker.rateLimit(rateLimitDuration);

        this.logger.warn(
          `⏳ Applied quota-based rate limit: ${rateLimitDuration}ms for ${model} (${quotaCheck.quotaType})`,
        );

        return {
          applied: true,
          waitTime: rateLimitDuration,
          reason: quotaCheck.reason,
        };
      }

      return { applied: false };
    } catch (error) {
      this.logger.error(`❌ Error applying quota rate limit: ${error.message}`);
      return { applied: false };
    }
  }

  /**
   * Handle quota violation by applying immediate rate limiting
   */
  async handleQuotaViolation(
    worker: Worker,
    model: string,
    error: any,
  ): Promise<{ rateLimited: boolean; retryDelayMs?: number }> {
    try {
      // Parse the quota error to get retry delay
      const parsedError = this.quotaManager.parseQuotaError(error);

      if (!parsedError) {
        this.logger.warn(
          '⚠️ Could not parse quota error, applying default rate limit',
        );
        await worker.rateLimit(60000); // 1 minute default
        return { rateLimited: true, retryDelayMs: 60000 };
      }

      // Record the violation
      await this.quotaManager.recordQuotaViolation(model, error);

      if (parsedError.isRpdViolation) {
        // For daily quota violations, apply very long rate limit
        const dayEndMs = this.getMillisecondsUntilDayEnd();
        await worker.rateLimit(Math.min(dayEndMs, 86400000)); // Max 24 hours

        this.logger.error(
          `🛑 Daily quota exceeded for ${model}, rate limited until day end (${Math.round(dayEndMs / 1000)}s)`,
        );

        return { rateLimited: true, retryDelayMs: dayEndMs };
      }

      if (parsedError.retryDelaySeconds > 0) {
        const retryDelayMs = parsedError.retryDelaySeconds * 1000;
        await worker.rateLimit(retryDelayMs);

        this.logger.warn(
          `📊 ${parsedError.quotaType} quota violated for ${model}, rate limited for ${parsedError.retryDelaySeconds}s`,
        );

        return { rateLimited: true, retryDelayMs };
      }

      // Fallback rate limit
      await worker.rateLimit(120000); // 2 minutes
      return { rateLimited: true, retryDelayMs: 120000 };
    } catch (error) {
      this.logger.error(`❌ Error handling quota violation: ${error.message}`);
      await worker.rateLimit(300000); // 5 minute fallback
      return { rateLimited: true, retryDelayMs: 300000 };
    }
  }

  /**
   * Get current active rate limits (for monitoring)
   */
  getActiveRateLimits(): Record<string, RateLimitConfig> {
    return Object.fromEntries(this.activeRateLimits);
  }

  /**
   * Clear rate limit for a specific queue
   */
  clearQueueRateLimit(queueName: string): void {
    this.activeRateLimits.delete(queueName);
    this.logger.log(`🧹 Cleared rate limit for queue: ${queueName}`);
  }

  /**
   * Calculate dynamic rate limit based on current quota usage
   */
  private async calculateDynamicRateLimit(
    model: string,
    baseLimit: RateLimitConfig,
  ): Promise<RateLimitConfig> {
    try {
      const usageStats = await this.quotaManager.getUsageStats(model);
      const { usage, limits } = usageStats;

      // Calculate usage percentage for RPM
      const rpmUsagePercent = usage.requestsInCurrentMinute / limits.rpm;

      // If we're close to RPM limit, reduce the rate
      if (rpmUsagePercent > 0.8) {
        const reductionFactor = Math.max(0.1, 1 - rpmUsagePercent);
        return {
          max: Math.max(1, Math.floor(baseLimit.max * reductionFactor)),
          duration: baseLimit.duration * 2, // Increase duration when throttling
        };
      }

      return baseLimit;
    } catch (error) {
      this.logger.error(
        `❌ Error calculating dynamic rate limit: ${error.message}`,
      );
      return baseLimit;
    }
  }

  /**
   * Get milliseconds until the end of the current day (Pacific Time)
   */
  private getMillisecondsUntilDayEnd(): number {
    const now = new Date();
    const pacificTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    );
    const endOfDay = new Date(pacificTime);
    endOfDay.setHours(23, 59, 59, 999);

    return Math.max(0, endOfDay.getTime() - pacificTime.getTime());
  }

  /**
   * Create rate limit configuration for AI/video processing queues
   */
  static createAIProcessingRateLimit(): QueueRateLimitOptions {
    return {
      baseRateLimit: {
        max: 10, // 10 requests
        duration: 60000, // per minute
      },
      enableDynamicLimiting: true,
      modelRateLimits: {
        'gemini-2.5-flash-lite-preview-06-17': {
          max: 15,
          duration: 60000,
        },
        'gemini-2.5-flash': {
          max: 10,
          duration: 60000,
        },
        'gemini-2.5-pro': {
          max: 5,
          duration: 60000,
        },
      },
    };
  }

  /**
   * Create rate limit configuration for non-AI queues
   */
  static createStandardRateLimit(): QueueRateLimitOptions {
    return {
      baseRateLimit: {
        max: 50, // Higher limit for non-AI tasks
        duration: 60000,
      },
      enableDynamicLimiting: false,
    };
  }

  /**
   * Configure rate limits for a specific queue type
   */
  configureQueueRateLimit(queueName: string): QueueRateLimitOptions {
    const queueConfigs: Record<string, QueueRateLimitOptions> = {
      analysis: BullMQRateLimitService.createAIProcessingRateLimit(),
      'chunk-analysis': BullMQRateLimitService.createAIProcessingRateLimit(),
      combination: BullMQRateLimitService.createAIProcessingRateLimit(),
      'channel-poll': BullMQRateLimitService.createStandardRateLimit(),
      'content-processing': BullMQRateLimitService.createStandardRateLimit(),
      'metadata-processing': BullMQRateLimitService.createStandardRateLimit(),
      stats: BullMQRateLimitService.createStandardRateLimit(),
      'quota-cleanup': BullMQRateLimitService.createStandardRateLimit(),
    };

    return (
      queueConfigs[queueName] ||
      BullMQRateLimitService.createStandardRateLimit()
    );
  }

  /**
   * Apply intelligent rate limiting based on current system state
   */
  async applyIntelligentRateLimit(
    worker: Worker,
    queueName: string,
    model?: string,
  ): Promise<{ applied: boolean; reason?: string }> {
    try {
      // Get queue-specific configuration
      const queueConfig = this.configureQueueRateLimit(queueName);

      // Get current rate limit for this queue/model combination
      const rateLimit = await this.getQueueRateLimit(
        queueName,
        queueConfig,
        model,
      );

      // Check if any models are overloaded
      const availableModels = this.quotaManager.getAvailableModels();
      let overloadedModelsCount = 0;

      for (const availableModel of availableModels) {
        if (this.quotaManager.isModelOverloaded(availableModel)) {
          overloadedModelsCount++;
        }
      }

      // If many models are overloaded, apply stricter rate limiting
      if (overloadedModelsCount > availableModels.length / 2) {
        const extendedDuration = rateLimit.duration * 2;
        await worker.rateLimit(extendedDuration);

        this.logger.warn(
          `🚨 System-wide overload detected (${overloadedModelsCount}/${availableModels.length} models overloaded), applying extended rate limit: ${extendedDuration}ms`,
        );

        return {
          applied: true,
          reason: `System overload: ${overloadedModelsCount} models unavailable`,
        };
      }

      return { applied: false };
    } catch (error) {
      this.logger.error(
        `❌ Error applying intelligent rate limit: ${error.message}`,
      );
      return { applied: false };
    }
  }
}
