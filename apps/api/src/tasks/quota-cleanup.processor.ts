import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QuotaViolation } from '../schemas/quota-violation.schema';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';

export interface QuotaCleanupJobData {
  type: 'overload' | 'rpd';
  model?: string; // For overload cleanup
}

@Processor('quota-cleanup')
export class QuotaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(QuotaCleanupProcessor.name);

  constructor(
    @InjectModel(QuotaViolation.name) private quotaViolationModel: Model<QuotaViolation>,
    private quotaManager: QuotaManagerService,
  ) {
    super();
  }

  async process(job: Job<QuotaCleanupJobData, any, string>): Promise<any> {
    const { type, model } = job.data;

    try {
      if (type === 'overload') {
        await this.cleanupOverloadedModel(model);
      } else if (type === 'rpd') {
        await this.cleanupDailyViolations();
      }

      return { success: true, type, model };
    } catch (error) {
      this.logger.error(`❌ Quota cleanup job failed: ${error.message}`, {
        type,
        model,
        error: error.message,
      });
      throw error;
    }
  }

  private async cleanupOverloadedModel(model?: string): Promise<void> {
    if (!model) {
      this.logger.warn('⚠️ No model specified for overload cleanup');
      return;
    }

    this.logger.log(`🧹 Processing scheduled overload cleanup for model: ${model}`);
    
    // Call the quota manager to perform the actual cleanup
    this.quotaManager.cleanupOverloadedModel(model);
  }

  private async cleanupDailyViolations(): Promise<void> {
    this.logger.log('🧹 Starting daily quota violations cleanup...');

    try {
      // Clean up old RPD violations (older than 1 day)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const result = await this.quotaViolationModel.deleteMany({
        isRpdViolation: true,
        createdAt: { $lt: oneDayAgo },
      });

      this.logger.log(`🧹 Cleaned up ${result.deletedCount} old RPD violations`);

      // Also clean up very old violations (older than 7 days) to prevent database bloat
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const oldResult = await this.quotaViolationModel.deleteMany({
        createdAt: { $lt: sevenDaysAgo },
      });

      this.logger.log(`🧹 Cleaned up ${oldResult.deletedCount} old quota violations (7+ days)`);
    } catch (error) {
      this.logger.error(`❌ Daily cleanup failed: ${error.message}`);
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<QuotaCleanupJobData>) {
    this.logger.log(`✅ Quota cleanup job completed: ${job.data.type}${job.data.model ? ` for ${job.data.model}` : ''}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<QuotaCleanupJobData>, err: Error) {
    this.logger.error(`❌ Quota cleanup job failed: ${job.data.type}${job.data.model ? ` for ${job.data.model}` : ''} - ${err.message}`);
  }
} 