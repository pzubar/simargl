import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QuotaUsage } from '../schemas/quota-usage.schema';
import { QuotaViolation } from '../schemas/quota-violation.schema';

// Gemini text-out models constants
export const GEMINI_MODELS = {
  GEMINI_2_5_PRO: 'gemini-2.5-pro',
  GEMINI_2_5_FLASH: 'gemini-2.5-flash',
  GEMINI_2_5_FLASH_LITE: 'gemini-2.5-flash-lite-preview-06-17',
  GEMINI_2_0_FLASH: 'gemini-2.0-flash',
  GEMINI_2_0_FLASH_LITE: 'gemini-2.0-flash-lite',
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

export interface QuotaLimits {
  rpm: number; // Requests per minute
  tpm: number; // Tokens per minute
  rpd?: number; // Requests per day
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  waitTime?: number;
  quotaType?: 'RPM' | 'TPM' | 'RPD';
}

export interface ParsedQuotaError {
  quotaType: 'RPM' | 'TPM' | 'RPD' | 'UNKNOWN';
  quotaId: string;
  tier: string;
  retryDelaySeconds: number;
  isRpdViolation: boolean;
  isRpmViolation: boolean;
  isTpmViolation: boolean;
}

@Injectable()
export class EnhancedQuotaManagerService {
  private readonly logger = new Logger(EnhancedQuotaManagerService.name);
  private currentTier: 'free' | 'tier1' | 'tier2' | 'tier3' = 'free';
  private defaultModel: string;

  // Track temporarily overloaded models
  private overloadedModels: Map<string, Date> = new Map();
  private readonly OVERLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  // Updated quota limits based on official Gemini API documentation
  private quotaLimits = {
    free: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 5,
        tpm: 250000,
        rpd: 100,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 10,
        tpm: 250000,
        rpd: 250,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 15,
        tpm: 250000,
        rpd: 1000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 15,
        tpm: 1000000,
        rpd: 200,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 30,
        tpm: 1000000,
        rpd: 200,
      },
    },
    tier1: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 150,
        tpm: 2000000,
        rpd: 10000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 1000,
        tpm: 1000000,
        rpd: 10000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 4000,
        tpm: 4000000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 2000,
        tpm: 4000000,
        rpd: 10000000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 4000,
        tpm: 4000000,
        rpd: 10000000,
      },
    },
    tier2: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 1000,
        tpm: 5000000,
        rpd: 50000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 2000,
        tpm: 3000000,
        rpd: 100000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 10000,
        tpm: 10000000,
        rpd: 100000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 10000,
        tpm: 10000000,
        rpd: 1000000000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 20000,
        tpm: 10000000,
        rpd: 1000000000,
      },
    },
    tier3: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 2000,
        tpm: 8000000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 10000,
        tpm: 8000000,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 30000,
        tpm: 30000000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 30000,
        tpm: 30000000,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 30000,
        tpm: 30000000,
      },
    },
  };

  constructor(
    private configService: ConfigService,
    @InjectModel(QuotaUsage.name) private quotaUsageModel: Model<QuotaUsage>,
    @InjectModel(QuotaViolation.name)
    private quotaViolationModel: Model<QuotaViolation>,
    @InjectQueue('quota-cleanup') private quotaCleanupQueue: Queue,
  ) {
    // Determine tier from environment variable
    const tierConfig = this.configService
      .get<string>('GEMINI_TIER', 'free')
      .toLowerCase();
    this.currentTier = tierConfig as any;

    // Get default model from environment variable
    this.defaultModel = this.configService.get<string>(
      'GEMINI_DEFAULT_MODEL',
      GEMINI_MODELS.GEMINI_2_5_FLASH,
    );

    this.logger.log(
      `🎯 Enhanced Quota Manager initialized for ${this.currentTier.toUpperCase()} tier`,
    );
    this.logger.log(`🤖 Default model: ${this.defaultModel}`);
    this.logCurrentLimits();

    // Schedule daily cleanup at midnight Pacific Time
    this.scheduleDailyCleanup();
  }

  /**
   * Get quota limits for a specific model
   */
  getQuotaLimits(model: string): QuotaLimits {
    const modelLimits = this.quotaLimits[this.currentTier]?.[model];

    if (!modelLimits) {
      this.logger.warn(
        `⚠️ No quota limits found for model: ${model} on tier: ${this.currentTier}`,
      );
      // Return conservative defaults
      return { rpm: 5, tpm: 100000 };
    }

    return modelLimits;
  }

  /**
   * Check if we can make a request without exceeding quotas (database-backed)
   */
  async canMakeRequest(
    model: string,
    estimatedTokens: number = 1000,
  ): Promise<QuotaCheckResult> {
    const limits = this.getQuotaLimits(model);
    const now = new Date();
    const timeWindow = this.getTimeWindow(now);
    const day = this.getDay(now);

    // Get or create usage record
    const usage = await this.getOrCreateUsage(model, timeWindow, day);

    // Check RPM limit
    if (usage.requestsInCurrentMinute >= limits.rpm) {
      const waitTime = 60 - now.getSeconds();
      return {
        allowed: false,
        reason: `RPM limit exceeded (${usage.requestsInCurrentMinute}/${limits.rpm})`,
        waitTime,
        quotaType: 'RPM',
      };
    }

    // Check TPM limit
    if (usage.tokensInCurrentMinute + estimatedTokens > limits.tpm) {
      const waitTime = 60 - now.getSeconds();
      return {
        allowed: false,
        reason: `TPM limit would be exceeded (${usage.tokensInCurrentMinute + estimatedTokens}/${limits.tpm})`,
        waitTime,
        quotaType: 'TPM',
      };
    }

    // Check RPD limit (if applicable)
    if (limits.rpd && usage.requestsToday >= limits.rpd) {
      const nextDay = new Date(now);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(0, 0, 0, 0);
      const waitTime = Math.ceil((nextDay.getTime() - now.getTime()) / 1000);
      return {
        allowed: false,
        reason: `RPD limit exceeded (${usage.requestsToday}/${limits.rpd})`,
        waitTime,
        quotaType: 'RPD',
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful request (database-backed)
   */
  async recordRequest(model: string, actualTokens: number): Promise<void> {
    const now = new Date();
    const timeWindow = this.getTimeWindow(now);
    const day = this.getDay(now);

    await this.quotaUsageModel.updateOne(
      { modelName: model, timeWindow, day },
      {
        $inc: {
          requestsInCurrentMinute: 1,
          tokensInCurrentMinute: actualTokens,
          requestsToday: 1,
        },
        $set: {
          expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
        },
      },
      { upsert: true },
    );

    this.logger.debug(
      `📊 Recorded request for ${model}: +1 request, +${actualTokens} tokens`,
    );

    // Schedule overload cleanup for this model 1 minute from now
    await this.scheduleOverloadCleanup(model);
  }

  /**
   * Parse Google quota error and extract detailed information
   */
  parseQuotaError(error: any): ParsedQuotaError | null {
    let quotaId = '';
    let retryDelay = '';
    let quotaMetric = '';

    try {
      let errorToProcess = error;

      // First, try to parse the error message as JSON if it's a string
      // Google API sometimes returns nested JSON in the message field
      if (error?.message && typeof error.message === 'string') {
        try {
          const parsedMessage = JSON.parse(error.message);
          if (parsedMessage.error) {
            errorToProcess = parsedMessage.error;
            this.logger.debug('📋 Parsed nested JSON from error message');

            // Check if the inner error also has a JSON string in its message
            if (
              errorToProcess.message &&
              typeof errorToProcess.message === 'string'
            ) {
              try {
                const doubleParsedMessage = JSON.parse(errorToProcess.message);
                if (doubleParsedMessage.error) {
                  errorToProcess = doubleParsedMessage.error;
                  this.logger.debug(
                    '📋 Parsed double-nested JSON from error message',
                  );
                }
              } catch (doubleJsonError) {
                // If second JSON parsing fails, continue with first parsed message
                this.logger.debug(
                  '📋 Second level error message is not JSON, using first parsed level',
                );
              }
            }
          }
        } catch (jsonError) {
          // If JSON parsing fails, continue with original error structure
          this.logger.debug(
            '📋 Error message is not JSON, using original structure',
          );
        }
      }

      // Parse error details from Google API response
      if (errorToProcess?.details) {
        for (const detail of errorToProcess.details) {
          if (
            detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
            detail.violations
          ) {
            const firstViolation = detail.violations[0];
            quotaMetric = firstViolation?.quotaMetric || '';
            quotaId = firstViolation?.quotaId || '';
            this.logger.debug(`📋 Found quota violation: ${quotaId}`);
          }

          if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
            retryDelay = detail.retryDelay || '';
            this.logger.debug(`📋 Found retry delay: ${retryDelay}`);
          }
        }
      }

      // If not found in details, try parsing from the processed error message
      if (!quotaId && errorToProcess?.message) {
        const quotaIdMatch = errorToProcess.message.match(
          /"quotaId":\s*"([^"]+)"/,
        );
        if (quotaIdMatch) {
          quotaId = quotaIdMatch[1];
          this.logger.debug(`📋 Extracted quotaId from message: ${quotaId}`);
        }

        const retryDelayMatch = errorToProcess.message.match(
          /"retryDelay":\s*"([^"]+)"/,
        );
        if (retryDelayMatch) {
          retryDelay = retryDelayMatch[1];
          this.logger.debug(
            `📋 Extracted retryDelay from message: ${retryDelay}`,
          );
        }
      }

      // Last resort: try parsing from original error message as string
      if (!quotaId && error?.message && typeof error.message === 'string') {
        const quotaIdMatch = error.message.match(/"quotaId":\s*"([^"]+)"/);
        if (quotaIdMatch) {
          quotaId = quotaIdMatch[1];
          this.logger.debug(
            `📋 Extracted quotaId from original message string: ${quotaId}`,
          );
        }

        const retryDelayMatch = error.message.match(
          /"retryDelay":\s*"([^"]+)"/,
        );
        if (retryDelayMatch) {
          retryDelay = retryDelayMatch[1];
          this.logger.debug(
            `📋 Extracted retryDelay from original message string: ${retryDelay}`,
          );
        }
      }

      if (!quotaId) {
        this.logger.warn('⚠️ Could not parse quotaId from error', {
          originalError: error,
          processedError: errorToProcess,
          errorMessage: error?.message?.substring(0, 500) + '...', // Log first 500 chars for debugging
        });
        return null;
      }

      // Parse quota type and tier from quotaId
      const quotaType = this.extractQuotaType(quotaId);
      const tier = this.extractTier(quotaId);
      const retryDelaySeconds = this.parseRetryDelay(retryDelay);

      this.logger.log(
        `✅ Successfully parsed quota error: ${quotaType} violation (${quotaId}) with ${retryDelaySeconds}s retry delay`,
      );

      return {
        quotaType,
        quotaId,
        tier,
        retryDelaySeconds,
        isRpdViolation: quotaType === 'RPD',
        isRpmViolation: quotaType === 'RPM',
        isTpmViolation: quotaType === 'TPM',
      };
    } catch (parseError) {
      this.logger.error(`❌ Error parsing quota error: ${parseError.message}`, {
        originalError: error,
        parseError: parseError.message,
      });
      return null;
    }
  }

  /**
   * Record a quota violation from Gemini API (database-backed)
   */
  async recordQuotaViolation(model: string, error: any): Promise<void> {
    const parsedError = this.parseQuotaError(error);

    const violationData = {
      modelName: model,
      error,
      quotaMetric: parsedError?.quotaId
        ? this.extractQuotaMetric(error)
        : undefined,
      quotaId: parsedError?.quotaId,
      quotaValue: this.extractQuotaValue(error),
      retryDelay: parsedError ? `${parsedError.retryDelaySeconds}s` : undefined,
      retryDelaySeconds: parsedError?.retryDelaySeconds,
      quotaType: parsedError?.quotaType,
      tier: parsedError?.tier,
      isRpmViolation: parsedError?.isRpmViolation || false,
      isRpdViolation: parsedError?.isRpdViolation || false,
      isTpmViolation: parsedError?.isTpmViolation || false,
    };

    await this.quotaViolationModel.create(violationData);

    this.logger.error(
      `❌ Quota violation recorded for ${model}: ${parsedError?.quotaType || 'Unknown'} (${parsedError?.quotaId || 'Unknown quota'})`,
    );

    if (parsedError?.retryDelaySeconds) {
      this.logger.warn(`⏳ Retry after: ${parsedError.retryDelaySeconds}s`);

      // For RPD violations, log that we should stop for the day
      if (parsedError.isRpdViolation) {
        this.logger.error(
          `🛑 Daily quota exceeded for ${model}. No more requests should be made today.`,
        );
      }
    }
  }

  /**
   * Get all models ordered by preference (default model first, then performance)
   */
  getAvailableModels(): GeminiModel[] {
    const tierModels = Object.keys(
      this.quotaLimits[this.currentTier],
    ) as GeminiModel[];

    // Start with default model, then order by preference
    const preferenceOrder: GeminiModel[] = [
      this.defaultModel as GeminiModel,
      GEMINI_MODELS.GEMINI_2_5_FLASH_LITE,
      GEMINI_MODELS.GEMINI_2_5_FLASH,
      GEMINI_MODELS.GEMINI_2_5_PRO,
      GEMINI_MODELS.GEMINI_2_0_FLASH,
      GEMINI_MODELS.GEMINI_2_0_FLASH_LITE,
    ];

    // Remove duplicates and filter by tier availability
    const uniqueModels = [...new Set(preferenceOrder)].filter((model) =>
      tierModels.includes(model),
    );

    return uniqueModels;
  }

  /**
   * Find the best available model that can handle the request
   */
  async findBestAvailableModel(
    estimatedTokens: number = 1000,
    excludeModels: string[] = [],
  ): Promise<{
    model: GeminiModel | null;
    reason?: string;
  }> {
    const availableModels = this.getAvailableModels();

    for (const model of availableModels) {
      // Skip excluded models
      if (excludeModels.includes(model)) {
        this.logger.debug(`⏭️ Skipping excluded model: ${model}`);
        continue;
      }

      // Skip temporarily overloaded models
      if (this.isModelOverloaded(model)) {
        this.logger.debug(`⏭️ Skipping overloaded model: ${model}`);
        continue;
      }

      const check = await this.canMakeRequest(model, estimatedTokens);
      if (check.allowed) {
        this.logger.log(
          `✅ Selected model: ${model} for request with ${estimatedTokens} tokens`,
        );
        return { model };
      } else {
        this.logger.debug(`⏭️ Skipping ${model}: ${check.reason}`);
      }
    }

    this.logger.warn(
      `⚠️ No available models for request with ${estimatedTokens} tokens`,
    );
    return {
      model: null,
      reason: 'All models have exceeded their quota limits or are overloaded',
    };
  }

  /**
   * Get current usage statistics for a model
   */
  async getUsageStats(model: string): Promise<{
    usage: {
      requestsInCurrentMinute: number;
      tokensInCurrentMinute: number;
      requestsToday: number;
    };
    limits: QuotaLimits;
  }> {
    const now = new Date();
    const timeWindow = this.getTimeWindow(now);
    const day = this.getDay(now);

    const usage = await this.getOrCreateUsage(model, timeWindow, day);
    const limits = this.getQuotaLimits(model);

    return {
      usage: {
        requestsInCurrentMinute: usage.requestsInCurrentMinute,
        tokensInCurrentMinute: usage.tokensInCurrentMinute,
        requestsToday: usage.requestsToday,
      },
      limits,
    };
  }

  /**
   * Estimate token count for a text (rough approximation)
   */
  estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    // Add some padding for safety
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Get violation statistics (database-backed)
   */
  async getViolationStats(): Promise<{
    totalViolations: number;
    violationsByModel: Record<string, number>;
    recentViolations: any[];
  }> {
    const recentViolations = await this.quotaViolationModel
      .find()
      .sort({ createdAt: -1 })
      .limit(10)
      .exec();

    const allViolations = await this.quotaViolationModel
      .find()
      .select('modelName')
      .exec();

    const violationsByModel: Record<string, number> = {};
    allViolations.forEach((violation) => {
      violationsByModel[violation.modelName] =
        (violationsByModel[violation.modelName] || 0) + 1;
    });

    const totalViolations = allViolations.length;

    return {
      totalViolations,
      violationsByModel,
      recentViolations,
    };
  }

  /**
   * Mark a model as temporarily overloaded
   */
  markModelAsOverloaded(model: string): void {
    this.overloadedModels.set(model, new Date());
    this.logger.warn(
      `🚫 Temporarily marking ${model} as overloaded for ${this.OVERLOAD_TIMEOUT / 60000} minutes`,
    );

    // Schedule cleanup for this model after the overload timeout
    this.scheduleOverloadCleanup(model);
  }

  /**
   * Check if a model is currently marked as overloaded
   */
  isModelOverloaded(model: string): boolean {
    const overloadTime = this.overloadedModels.get(model);
    if (!overloadTime) {
      return false;
    }

    const now = new Date();
    const timeSinceOverload = now.getTime() - overloadTime.getTime();

    if (timeSinceOverload > this.OVERLOAD_TIMEOUT) {
      // Clear the overload flag after timeout
      this.overloadedModels.delete(model);
      this.logger.log(`✅ Cleared overload flag for ${model} after timeout`);
      return false;
    }

    return true;
  }

  // Helper methods
  private getTimeWindow(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}-${minute}`;
  }

  private getDay(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async getOrCreateUsage(
    model: string,
    timeWindow: string,
    day: string,
  ): Promise<QuotaUsage> {
    let usage = await this.quotaUsageModel
      .findOne({
        modelName: model,
        timeWindow,
      })
      .exec();

    if (!usage) {
      usage = await this.quotaUsageModel.create({
        modelName: model,
        timeWindow,
        day,
        requestsInCurrentMinute: 0,
        tokensInCurrentMinute: 0,
        requestsToday: 0,
        expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
      });
    }

    return usage;
  }

  private extractQuotaType(quotaId: string): 'RPM' | 'TPM' | 'RPD' | 'UNKNOWN' {
    // Check for per-minute quotas (RPM)
    if (quotaId.includes('PerMinute') || quotaId.includes('PerModelPerMinute'))
      return 'RPM';

    // Check for per-day quotas (RPD)
    if (quotaId.includes('PerDay') || quotaId.includes('PerModelPerDay'))
      return 'RPD';

    // Check for token-related quotas (TPM) - but only if not already classified as RPM/RPD
    if (
      quotaId.includes('Token') &&
      !quotaId.includes('PerMinute') &&
      !quotaId.includes('PerDay')
    )
      return 'TPM';

    // Log for debugging unrecognized quota types
    this.logger.debug(`🤔 Unrecognized quota type pattern: ${quotaId}`);
    return 'UNKNOWN';
  }

  private extractTier(quotaId: string): string {
    if (quotaId.includes('FreeTier')) return 'FreeTier';
    if (quotaId.includes('Tier1')) return 'Tier1';
    if (quotaId.includes('Tier2')) return 'Tier2';
    if (quotaId.includes('Tier3')) return 'Tier3';
    return 'Unknown';
  }

  private parseRetryDelay(retryDelay: string): number {
    if (!retryDelay) return 0;

    // Parse "56s" format
    const match = retryDelay.match(/(\d+)s/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractQuotaMetric(error: any): string | undefined {
    if (error?.details) {
      for (const detail of error.details) {
        if (
          detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
          detail.violations
        ) {
          return detail.violations[0]?.quotaMetric;
        }
      }
    }
    return undefined;
  }

  private extractQuotaValue(error: any): string | undefined {
    if (error?.details) {
      for (const detail of error.details) {
        if (
          detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
          detail.violations
        ) {
          return detail.violations[0]?.quotaValue;
        }
      }
    }
    return undefined;
  }

  /**
   * Clean up overloaded models (called by cleanup jobs)
   */
  cleanupOverloadedModel(model: string): void {
    const overloadTime = this.overloadedModels.get(model);
    if (!overloadTime) {
      return; // Already cleaned up
    }

    const now = new Date();
    const timeSinceOverload = now.getTime() - overloadTime.getTime();

    if (timeSinceOverload >= this.OVERLOAD_TIMEOUT) {
      this.overloadedModels.delete(model);
      this.logger.log(
        `🧹 Cleaned up overload flag for ${model} after ${timeSinceOverload}ms`,
      );
    }
  }

  private logCurrentLimits(): void {
    const models = Object.keys(this.quotaLimits[this.currentTier]);
    this.logger.log(
      `📋 Available models for ${this.currentTier.toUpperCase()} tier:`,
    );

    models.forEach((model) => {
      const limits = this.quotaLimits[this.currentTier][model];
      const isDefault = model === this.defaultModel ? ' [DEFAULT]' : '';
      this.logger.log(
        `   🤖 ${model}${isDefault}: ${limits.rpm} RPM, ${(limits.tpm / 1000).toFixed(0)}K TPM${limits.rpd ? `, ${limits.rpd} RPD` : ''}`,
      );
    });
  }

  /**
   * Schedule daily cleanup at midnight Pacific Time
   */
  private async scheduleDailyCleanup(): Promise<void> {
    try {
      // Calculate next midnight Pacific Time
      const now = new Date();
      const pacificTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
      );
      const nextMidnight = new Date(pacificTime);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      nextMidnight.setHours(0, 0, 0, 0);

      // Convert back to UTC for scheduling
      const delayMs = nextMidnight.getTime() - pacificTime.getTime();

      await this.quotaCleanupQueue.add(
        'daily-cleanup',
        { type: 'rpd' },
        {
          delay: delayMs,
          repeat: { pattern: '0 0 * * *', tz: 'America/Los_Angeles' }, // Daily at midnight PT
          removeOnComplete: 5,
          removeOnFail: 3,
        },
      );

      this.logger.log(
        `📅 Scheduled daily RPD cleanup at midnight Pacific Time (${delayMs}ms from now)`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to schedule daily cleanup: ${error.message}`,
      );
    }
  }

  /**
   * Schedule overload cleanup for a specific model
   */
  private async scheduleOverloadCleanup(model: string): Promise<void> {
    try {
      const cleanupDelay = this.OVERLOAD_TIMEOUT; // 5 minutes

      await this.quotaCleanupQueue.add(
        `overload-cleanup-${model}`,
        { type: 'overload', model },
        {
          delay: cleanupDelay,
          removeOnComplete: 1,
          removeOnFail: 1,
          jobId: `overload-${model}-${Date.now()}`, // Unique job ID to prevent duplicates
        },
      );

      this.logger.debug(
        `⏰ Scheduled overload cleanup for ${model} in ${cleanupDelay}ms`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to schedule overload cleanup for ${model}: ${error.message}`,
      );
    }
  }
}
