import { Controller, Get, Post, Body, Param, Redirect } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiService } from './api.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from './services/enhanced-quota-manager.service';
import { ResearchService } from './services/research.service';
import { Model } from 'mongoose';
import { VideoInsight } from 'apps/api/src/schemas/video-insight.schema';
import { Prompt } from 'apps/api/src/schemas/prompt.schema';
import { InjectModel } from '@nestjs/mongoose';

@Controller('api')
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    @InjectQueue('video-discovery') private videoDiscoveryQueue: Queue,
    @InjectQueue('channel-monitoring') private channelMonitoringQueue: Queue,
    private quotaManager: QuotaManagerService,
    private researchService: ResearchService,
    @InjectModel(VideoInsight.name)
    private videoInsightModel: Model<VideoInsight>,
    @InjectModel(Prompt.name)
    private promptModel: Model<Prompt>,
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

    // Add job to video-discovery queue (which will handle initialization → metadata pipeline)
    const job = await this.videoDiscoveryQueue.add(
      'discover-video',
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
  async checkQuotaForModel(@Param('model') model: string) {
    const estimatedTokens = 1000; // Default estimation
    const check = await this.quotaManager.canMakeRequest(
      model,
      estimatedTokens,
    );
    const usageStats = await this.quotaManager.getUsageStats(model);

    return {
      model,
      estimatedTokens,
      check,
      limits: this.quotaManager.getQuotaLimits(model),
      usage: usageStats.usage,
    };
  }

  @Get('quota/violations')
  async getQuotaViolations() {
    const stats = await this.quotaManager.getViolationStats();

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
    const job = await this.channelMonitoringQueue.add('monitor-channel', {
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

  @Get('contents/:id/chunk-progress')
  async getChunkProgress(@Param('id') id: string) {
    console.log(`Getting chunk progress for content: ${id}`);
    const totalChunks = await this.videoInsightModel.countDocuments({
      contentId: id,
    });
    const analyzedChunks = await this.videoInsightModel.countDocuments({
      contentId: id,
      status: 'INSIGHTS_GATHERED',
    });
    console.log(
      `Total chunks: ${totalChunks}, Analyzed chunks: ${analyzedChunks}, Content ID: ${id}`,
    );
    return { total: totalChunks, analyzed: analyzedChunks };
  }

  @Get('content/:contentId/research-status')
  async getResearchStatus(@Param('contentId') contentId: string) {
    try {
      const status = await this.researchService.getResearchStatus(contentId);
      return {
        success: true,
        status,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('content/:contentId/trigger-research')
  async triggerResearch(
    @Param('contentId') contentId: string,
    @Body() body: { forceModel?: string } = {},
  ) {
    try {
      // TODO: Fix this - need to pass promptId, not forceModel
      // For now, get first active prompt
      const firstPrompt = await this.promptModel
        .findOne({ isActive: true })
        .exec();
      if (!firstPrompt) {
        return {
          success: false,
          reason: 'No active prompt found',
          timestamp: new Date().toISOString(),
        };
      }

      const result = await this.researchService.queueResearchProcessing(
        contentId,
        firstPrompt._id,
      );
      return {
        success: result.success,
        jobId: result.jobId,
        reason: result.reason,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('content/:contentId/reset-insights')
  async resetInsights(@Param('contentId') contentId: string) {
    try {
      const result = await this.researchService.resetInsights(contentId);
      return {
        success: result.success,
        deletedInsights: result.deletedInsights,
        deletedResearch: result.deletedResearch,
        reason: result.reason,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

@Controller()
export class RootController {
  @Get()
  @Redirect('/admin', 302)
  redirectToAdmin() {
    // This method will redirect all requests to '/' to '/admin'
  }
}
