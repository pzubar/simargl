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
    private quotaManager: QuotaManagerService,
  ) {}

  @Get()
  getHello(): string {
    return this.apiService.getHello();
  }

  @Post('test-video-analysis')
  async testVideoAnalysis(@Body() body: { contentId: string }) {
    console.log(`Manually triggering video analysis for content: ${body.contentId}`);
    
    // Add job to content-processing queue (which will handle metadata → analysis pipeline)
    const job = await this.contentProcessingQueue.add('process-content', { 
      contentId: body.contentId 
    });
    
    return {
      message: 'Video analysis job queued (metadata → analysis pipeline)',
      contentId: body.contentId,
      jobId: job.id,
    };
  }

  @Get('quota/status')
  getQuotaStatus() {
    const availableModels = this.quotaManager.getAvailableModels();
    const status = availableModels.map(model => ({
      model,
      ...this.quotaManager.getUsageStats(model)
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
    const check = await this.quotaManager.canMakeRequest(model, estimatedTokens);
    
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
    const violations = this.quotaManager.getQuotaViolations(50);
    const stats = this.quotaManager.getViolationStats();
    
    return {
      violations,
      statistics: stats,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('quota/models')
  getAvailableModels() {
    const availableModels = this.quotaManager.getAvailableModels();
    
    return {
      models: availableModels,
      modelsByTier: {
        free: this.quotaManager['quotaLimits'].free ? Object.keys(this.quotaManager['quotaLimits'].free) : [],
        tier1: this.quotaManager['quotaLimits'].tier1 ? Object.keys(this.quotaManager['quotaLimits'].tier1) : [],
        tier2: this.quotaManager['quotaLimits'].tier2 ? Object.keys(this.quotaManager['quotaLimits'].tier2) : [],
        tier3: this.quotaManager['quotaLimits'].tier3 ? Object.keys(this.quotaManager['quotaLimits'].tier3) : [],
      },
      currentTier: this.quotaManager['currentTier'],
      timestamp: new Date().toISOString(),
    };
  }


}
