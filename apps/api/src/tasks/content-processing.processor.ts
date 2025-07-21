import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { Logger } from '@nestjs/common';

@Processor('content-processing')
export class ContentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentProcessingProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('metadata-processing') private metadataQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`📋 Processing content: ${job.data.contentId}`);
    const content = await this.contentModel.findById(job.data.contentId).exec();
    
    if (!content) {
      this.logger.error(`❌ Content with id ${job.data.contentId} not found.`);
      return;
    }

    try {
      // First step: fetch metadata (this is now separated from analysis)
      this.logger.log(`📊 Queueing metadata processing for: ${content.sourceContentId}`);
      
      // Update status to indicate processing has started
      await this.contentModel.updateOne(
        { _id: content._id },
        { status: 'PROCESSING' }
      );

      // Queue metadata processing (which will then queue analysis)
      await this.metadataQueue.add('fetch-metadata', { contentId: content._id });
      
      this.logger.log(`✅ Successfully queued metadata processing for content: ${content._id}`);
    } catch (error) {
      this.logger.error(`❌ Failed to process content ${content.sourceContentId}: ${error.message}`);
      
      await this.contentModel.updateOne(
        { _id: content._id },
        { status: 'FAILED' }
      );
    }

    return {};
  }
}
