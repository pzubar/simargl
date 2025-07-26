import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiService } from './api.service';
import { QuotaManagerService } from './services/quota-manager.service';

@Controller('api')
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    @InjectQueue('content-processing') private contentProcessingQueue: Queue,
    @InjectQueue('channel-poll') private channelPollQueue: Queue,
    private quotaManager: QuotaManagerService,
  ) {}

  @Get()
  getHello(): string {
    return this.apiService.getHello();
  }

  @Post('test-video-analysis')
  async testVideoAnalysis(@Body() body: { contentId: string; model?: string }) {
    // Enhanced logging for debugging
    console.log(`📨 Received video analysis request:`, {
      body: body,
      contentId: body?.contentId,
      model: body?.model,
      bodyType: typeof body,
      bodyKeys: body ? Object.keys(body) : 'null/undefined',
    });

    // Validate required fields
    if (!body) {
      throw new Error('Request body is missing');
    }

    if (!body.contentId) {
      throw new Error(
        `contentId is required. Received: ${JSON.stringify(body)}`,
      );
    }

    if (typeof body.contentId !== 'string' || body.contentId.trim() === '') {
      throw new Error(
        `contentId must be a non-empty string. Received: "${body.contentId}" (type: ${typeof body.contentId})`,
      );
    }

    const contentId = body.contentId.trim();
    console.log(`✅ Valid contentId received: "${contentId}"`);

    // Add job to content-processing queue (which will handle metadata → analysis pipeline)
    const job = await this.contentProcessingQueue.add(
      'process-content',
      {
        contentId: contentId,
        forceModel: body.model, // Pass model selection to the job
      },
      {
        attempts: 4, // Total attempts (1 initial + 3 retries)
        backoff: {
          type: 'exponential',
          delay: 30000, // 30 seconds base delay for overload errors
        },
        removeOnComplete: 10,
        removeOnFail: 20,
      },
    );

    console.log(
      `🚀 Job queued successfully: ${job.id} for content: ${contentId}`,
    );

    return {
      message: 'Video analysis job queued (metadata → analysis pipeline)',
      contentId: contentId,
      jobId: job.id,
      model: body.model || 'auto-select',
    };
  }

  @Get('quota/status')
  getQuotaStatus() {
    const availableModels = this.quotaManager.getAvailableModels();
    const status = availableModels.map((model) => ({
      model,
      ...this.quotaManager.getUsageStats(model),
    }));

    const violationStats = this.quotaManager.getViolationStats();

    return {
      currentTier: this.quotaManager['currentTier'],
      models: status,
      availableModels,
      quotaViolations: violationStats,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('quota/check/:model')
  checkQuotaForModel(@Param('model') model: string) {
    const estimatedTokens = 1000; // Default estimation
    const check = this.quotaManager.canMakeRequest(model, estimatedTokens);

    return {
      model,
      estimatedTokens,
      check,
      limits: this.quotaManager.getQuotaLimits(model),
      usage: this.quotaManager.getUsageStats(model).usage,
    };
  }

  @Get('quota/violations')
  getQuotaViolations() {
    const stats = this.quotaManager.getViolationStats();

    return {
      violations: stats.recentViolations,
      statistics: stats,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('test-channel-poll')
  async testChannelPoll(@Body() body: { channelId: string }) {
    console.log(
      `Manually triggering channel poll for channel: ${body.channelId}`,
    );

    // Add job to channel-poll queue
    const job = await this.channelPollQueue.add('poll-channel', {
      channelId: body.channelId,
    });

    return {
      message: 'Channel poll job queued',
      channelId: body.channelId,
      jobId: job.id,
    };
  }

  @Get('quota/models')
  getAvailableModels() {
    const availableModels = this.quotaManager.getAvailableModels();

    return {
      models: availableModels,
      modelsByTier: {
        free: this.quotaManager['quotaLimits'].free
          ? Object.keys(this.quotaManager['quotaLimits'].free)
          : [],
        tier1: this.quotaManager['quotaLimits'].tier1
          ? Object.keys(this.quotaManager['quotaLimits'].tier1)
          : [],
        tier2: this.quotaManager['quotaLimits'].tier2
          ? Object.keys(this.quotaManager['quotaLimits'].tier2)
          : [],
        tier3: this.quotaManager['quotaLimits'].tier3
          ? Object.keys(this.quotaManager['quotaLimits'].tier3)
          : [],
      },
      currentTier: this.quotaManager['currentTier'],
      timestamp: new Date().toISOString(),
    };
  }
}
