import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Content } from '../schemas/content.schema';
import { Prompt, PromptType } from '../schemas/prompt.schema';
import { ResearchResult } from '../schemas/research-result.schema';

@Processor('research-scheduling', {
  limiter: {
    max: 20, // Frequent checks allowed - database operations only
    duration: 60000,
  },
})
export class ResearchSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchSchedulerProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    @InjectModel(ResearchResult.name) private researchResultModel: Model<ResearchResult>,
    @InjectQueue('research-processing') private researchProcessingQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ batchSize?: number; promptId?: string }>): Promise<any> {
    const { batchSize = 10, promptId } = job.data;
    
    this.logger.log(`🔬 Scheduling research prompts (batch size: ${batchSize})`);

    // Find videos with insights gathered
    const readyVideos = await this.contentModel
      .find({ status: 'INSIGHTS_GATHERED' })
      .limit(batchSize)
      .exec();

    if (readyVideos.length === 0) {
      this.logger.log(`📭 No videos ready for research processing`);
      return { processedVideos: 0, queuedJobs: 0 };
    }

    // Get available research question prompts
    const prompts = promptId 
      ? await this.promptModel.find({ _id: promptId, promptType: PromptType.RESEARCH_QUESTION }).exec()
      : await this.promptModel.find({ isActive: true, promptType: PromptType.RESEARCH_QUESTION }).exec();

    if (prompts.length === 0) {
      this.logger.log(`📭 No active research prompts available`);
      return { processedVideos: 0, queuedJobs: 0 };
    }

    this.logger.log(`📦 Found ${readyVideos.length} videos and ${prompts.length} prompts to process`);

    let queuedJobs = 0;

    for (const video of readyVideos) {
      for (const prompt of prompts) {
        try {
          // Check if this video-prompt combination has already been processed
          const existingResult = await this.researchResultModel.findOne({
            contentId: video._id,
            promptId: prompt._id,
          }).exec();

          if (existingResult) {
            this.logger.debug(`⏭️ Skipping already processed: video ${video._id} + prompt ${prompt._id}`);
            continue;
          }

          // Queue research processing job
          await this.researchProcessingQueue.add('process-research-prompt', {
            contentId: video._id.toString(),
            promptId: prompt._id.toString(),
            videoInfo: {
              title: video.title,
              description: video.description,
              duration: video.metadata?.duration,
              publishedAt: video.publishedAt,
            }
          }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
            removeOnComplete: 10,
            removeOnFail: 20,
          });

          // Create placeholder research result to track scheduling
          await this.researchResultModel.create({
            contentId: video._id,
            promptId: prompt._id,
            status: 'QUEUED',
            queuedAt: new Date(),
          });

          queuedJobs++;
          
        } catch (error) {
          this.logger.error(`❌ Failed to queue research for video ${video._id} + prompt ${prompt._id}: ${error.message}`);
        }
      }
    }

    this.logger.log(`✅ Queued ${queuedJobs} research processing jobs for ${readyVideos.length} videos`);
    
    return { 
      processedVideos: readyVideos.length,
      queuedJobs: queuedJobs,
      availablePrompts: prompts.length
    };
  }
}