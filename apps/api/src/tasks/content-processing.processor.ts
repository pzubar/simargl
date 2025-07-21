import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';

@Processor('content-processing')
export class ContentProcessingProcessor extends WorkerHost {
  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    console.log(`Processing content: ${job.data.contentId}`);
    const content = await this.contentModel.findById(job.data.contentId).exec();
    
    if (!content) {
      console.error(`Content with id ${job.data.contentId} not found.`);
      return;
    }

    try {
      // For now, we'll skip transcript fetching and go directly to analysis
      // The video analysis service will handle all video processing
      content.status = 'PROCESSING';
      await content.save();

      await this.analysisQueue.add('analyze-content', { contentId: content._id });
    } catch (error) {
      console.error(`Failed to process content ${content.sourceContentId}`, error);
      content.status = 'FAILED';
      await content.save();
    }

    return {};
  }
}
