import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  maxTokensPerRequest?: number;
}

export interface QuotaUsage {
  requestsInCurrentMinute: number;
  tokensInCurrentMinute: number;
  requestsToday: number;
  currentMinuteWindow: number;
  currentDayWindow: number;
}

export interface QuotaViolation {
  timestamp: Date;
  model: string;
  error: any;
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string;
  retryDelay?: string;
}

@Injectable()
export class QuotaManagerService {
  private readonly logger = new Logger(QuotaManagerService.name);
  private quotaUsage: Map<string, QuotaUsage> = new Map();
  private quotaViolations: QuotaViolation[] = [];
  private currentTier: 'free' | 'tier1' | 'tier2' | 'tier3' = 'free';

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
        maxTokensPerRequest: 4096,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 10,
        tpm: 250000,
        rpd: 250,
        maxTokensPerRequest: 4096,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 15,
        tpm: 250000,
        rpd: 1000,
        maxTokensPerRequest: 4096,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 15,
        tpm: 1000000,
        rpd: 200,
        maxTokensPerRequest: 4096,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 30,
        tpm: 1000000,
        rpd: 200,
        maxTokensPerRequest: 4096,
      },
    },
    tier1: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 150,
        tpm: 2000000,
        rpd: 10000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 1000,
        tpm: 1000000,
        rpd: 10000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 4000,
        tpm: 4000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 2000,
        tpm: 4000000,
        rpd: 10000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 4000,
        tpm: 4000000,
        rpd: 10000000,
        maxTokensPerRequest: 8192,
      },
    },
    tier2: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 1000,
        tpm: 5000000,
        rpd: 50000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 2000,
        tpm: 3000000,
        rpd: 100000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 10000,
        tpm: 10000000,
        rpd: 100000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 10000,
        tpm: 10000000,
        rpd: 1000000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 20000,
        tpm: 10000000,
        rpd: 1000000000,
        maxTokensPerRequest: 8192,
      },
    },
    tier3: {
      [GEMINI_MODELS.GEMINI_2_5_PRO]: {
        rpm: 2000,
        tpm: 8000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH]: {
        rpm: 10000,
        tpm: 8000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_5_FLASH_LITE]: {
        rpm: 30000,
        tpm: 30000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH]: {
        rpm: 30000,
        tpm: 30000000,
        maxTokensPerRequest: 8192,
      },
      [GEMINI_MODELS.GEMINI_2_0_FLASH_LITE]: {
        rpm: 30000,
        tpm: 30000000,
        maxTokensPerRequest: 8192,
      },
    },
  };

  constructor(private configService: ConfigService) {
    // Determine tier from environment variable
    const tierConfig = this.configService
      .get<string>('GEMINI_TIER', 'free')
      .toLowerCase();
    this.currentTier = tierConfig as any;

    this.logger.log(
      `🎯 Quota Manager initialized for ${this.currentTier.toUpperCase()} tier`,
    );
    this.logCurrentLimits();

    // Clean up old quota usage data every minute
    setInterval(() => this.cleanupOldUsage(), 60000);
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
      return { rpm: 5, tpm: 100000, maxTokensPerRequest: 2048 };
    }

    return modelLimits;
  }

  /**
   * Check if we can make a request without exceeding quotas
   */
  canMakeRequest(
    model: string,
    estimatedTokens: number = 1000,
  ): {
    allowed: boolean;
    reason?: string;
    waitTime?: number;
  } {
    const limits = this.getQuotaLimits(model);
    const usage = this.getOrCreateUsage(model);
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const currentDay = Math.floor(now / 86400000);

    // Reset counters if we're in a new time window
    if (usage.currentMinuteWindow !== currentMinute) {
      usage.requestsInCurrentMinute = 0;
      usage.tokensInCurrentMinute = 0;
      usage.currentMinuteWindow = currentMinute;
    }

    if (usage.currentDayWindow !== currentDay) {
      usage.requestsToday = 0;
      usage.currentDayWindow = currentDay;
    }

    // Check RPM limit
    if (usage.requestsInCurrentMinute >= limits.rpm) {
      const waitTime = 60 - (Math.floor(now / 1000) % 60);
      return {
        allowed: false,
        reason: `RPM limit exceeded (${usage.requestsInCurrentMinute}/${limits.rpm})`,
        waitTime,
      };
    }

    // Check TPM limit
    if (usage.tokensInCurrentMinute + estimatedTokens > limits.tpm) {
      const waitTime = 60 - (Math.floor(now / 1000) % 60);
      return {
        allowed: false,
        reason: `TPM limit would be exceeded (${usage.tokensInCurrentMinute + estimatedTokens}/${limits.tpm})`,
        waitTime,
      };
    }

    // Check RPD limit (if applicable)
    if (limits.rpd && usage.requestsToday >= limits.rpd) {
      const nextDayMs = (currentDay + 1) * 86400000;
      const waitTime = Math.ceil((nextDayMs - now) / 1000);
      return {
        allowed: false,
        reason: `RPD limit exceeded (${usage.requestsToday}/${limits.rpd})`,
        waitTime,
      };
    }

    // Check max tokens per request
    // if (
    //   limits.maxTokensPerRequest &&
    //   estimatedTokens > limits.maxTokensPerRequest
    // ) {
    //   return {
    //     allowed: false,
    //     reason: `Request too large (${estimatedTokens}/${limits.maxTokensPerRequest} tokens)`,
    //   };
    // }

    return { allowed: true };
  }

  /**
   * Record a successful request
   */
  recordRequest(model: string, actualTokens: number): void {
    const usage = this.getOrCreateUsage(model);
    usage.requestsInCurrentMinute++;
    usage.tokensInCurrentMinute += actualTokens;
    usage.requestsToday++;

    this.logger.debug(
      `📊 Quota usage for ${model}: RPM ${usage.requestsInCurrentMinute}, TPM ${usage.tokensInCurrentMinute}, RPD ${usage.requestsToday}`,
    );
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(model: string): { usage: QuotaUsage; limits: QuotaLimits } {
    return {
      usage: this.getOrCreateUsage(model),
      limits: this.getQuotaLimits(model),
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
   * Wait for quota to be available
   */
  async waitForQuota(
    model: string,
    estimatedTokens: number = 1000,
  ): Promise<void> {
    const check = this.canMakeRequest(model, estimatedTokens);

    if (check.allowed) {
      return;
    }

    if (check.waitTime) {
      this.logger.log(
        `⏳ Quota limit reached for ${model}. Waiting ${check.waitTime}s. Reason: ${check.reason}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, check.waitTime * 1000),
      );

      // Recursive check after waiting
      return this.waitForQuota(model, estimatedTokens);
    } else {
      throw new Error(`Quota limit exceeded for ${model}: ${check.reason}`);
    }
  }

  /**
   * Record a quota violation from Gemini API
   */
  recordQuotaViolation(model: string, error: any): void {
    const violation: QuotaViolation = {
      timestamp: new Date(),
      model,
      error,
    };

    // Parse specific quota violation details from the error
    if (error?.details) {
      for (const detail of error.details) {
        if (
          detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
          detail.violations
        ) {
          const firstViolation = detail.violations[0];
          violation.quotaMetric = firstViolation?.quotaMetric;
          violation.quotaId = firstViolation?.quotaId;
          violation.quotaValue = firstViolation?.quotaValue;
        }

        if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
          violation.retryDelay = detail.retryDelay;
        }
      }
    }

    this.quotaViolations.push(violation);

    // Keep only last 100 violations to prevent memory issues
    if (this.quotaViolations.length > 100) {
      this.quotaViolations = this.quotaViolations.slice(-100);
    }

    this.logger.error(
      `❌ Quota violation recorded for ${model}: ${violation.quotaId || 'Unknown quota'}`,
    );
    if (violation.retryDelay) {
      this.logger.warn(`⏳ Retry after: ${violation.retryDelay}`);
    }
  }

  /**
   * Get all models ordered by preference (best performance first)
   */
  getAvailableModels(): GeminiModel[] {
    const tierModels = Object.keys(
      this.quotaLimits[this.currentTier],
    ) as GeminiModel[];

    // Order models by preference - best performance and capabilities first
    const preferenceOrder: GeminiModel[] = [
      GEMINI_MODELS.GEMINI_2_5_PRO,
      GEMINI_MODELS.GEMINI_2_5_FLASH,
      GEMINI_MODELS.GEMINI_2_0_FLASH,
      GEMINI_MODELS.GEMINI_2_5_FLASH_LITE,
      GEMINI_MODELS.GEMINI_2_0_FLASH_LITE,
    ];

    return preferenceOrder.filter((model) => tierModels.includes(model));
  }

  /**
   * Mark a model as temporarily overloaded
   */
  markModelAsOverloaded(model: string): void {
    this.overloadedModels.set(model, new Date());
    this.logger.warn(
      `🚫 Temporarily marking ${model} as overloaded for ${this.OVERLOAD_TIMEOUT / 60000} minutes`,
    );
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

      const check = this.canMakeRequest(model, estimatedTokens);
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
   * Get recent quota violations
   */
  getQuotaViolations(limit: number = 50): QuotaViolation[] {
    return this.quotaViolations.slice(-limit);
  }

  /**
   * Get violation statistics
   */
  getViolationStats(): {
    totalViolations: number;
    violationsByModel: Record<string, number>;
    recentViolations: QuotaViolation[];
  } {
    const violationsByModel: Record<string, number> = {};

    for (const violation of this.quotaViolations) {
      violationsByModel[violation.model] =
        (violationsByModel[violation.model] || 0) + 1;
    }

    return {
      totalViolations: this.quotaViolations.length,
      violationsByModel,
      recentViolations: this.quotaViolations.slice(-10),
    };
  }

  /**
   * Switch to a different tier (for dynamic upgrades)
   */
  setTier(tier: 'free' | 'tier1' | 'tier2' | 'tier3'): void {
    const oldTier = this.currentTier;
    this.currentTier = tier;

    this.logger.log(
      `🔄 Switched from ${oldTier.toUpperCase()} to ${tier.toUpperCase()} tier`,
    );
    this.logCurrentLimits();

    // Clear usage stats when switching tiers to avoid confusion
    this.quotaUsage.clear();
  }

  private getOrCreateUsage(model: string): QuotaUsage {
    if (!this.quotaUsage.has(model)) {
      const now = Date.now();
      this.quotaUsage.set(model, {
        requestsInCurrentMinute: 0,
        tokensInCurrentMinute: 0,
        requestsToday: 0,
        currentMinuteWindow: Math.floor(now / 60000),
        currentDayWindow: Math.floor(now / 86400000),
      });
    }
    return this.quotaUsage.get(model);
  }

  private cleanupOldUsage(): void {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);

    for (const [model, usage] of this.quotaUsage.entries()) {
      // Remove usage data for models not used in the last hour
      if (currentMinute - usage.currentMinuteWindow > 60) {
        this.quotaUsage.delete(model);
        this.logger.debug(`🧹 Cleaned up old usage data for ${model}`);
      }
    }
  }

  private logCurrentLimits(): void {
    const models = Object.keys(this.quotaLimits[this.currentTier]);
    this.logger.log(
      `📋 Available models for ${this.currentTier.toUpperCase()} tier:`,
    );

    models.forEach((model) => {
      const limits = this.quotaLimits[this.currentTier][model];
      this.logger.log(
        `   🤖 ${model}: ${limits.rpm} RPM, ${(limits.tpm / 1000).toFixed(0)}K TPM${limits.rpd ? `, ${limits.rpd} RPD` : ''}`,
      );
    });
  }
}
