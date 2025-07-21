import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';  
import { Job, Queue } from 'bullmq';  
import { InjectModel } from '@nestjs/mongoose';  
import { Model } from 'mongoose';  
import { Content } from '../schemas/content.schema';  
import { Prompt } from '../schemas/prompt.schema';  
import { Channel } from '../schemas/channel.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@Processor('analysis')  
export class AnalysisProcessor extends WorkerHost {  
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(  
    @InjectModel(Content.name) private contentModel: Model<Content>,  
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,  
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectQueue('stats') private statsQueue: Queue,
    private configService: ConfigService,
    private videoAnalysisService: VideoAnalysisService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {  
    this.logger.log(`🔍 Analyzing content: ${job.data.contentId}`);  
    const content = await this.contentModel.findById(job.data.contentId).exec();  
    
    if (!content) {
      this.logger.error(`❌ Content with id ${job.data.contentId} not found.`);
      return;
    }
    
    const channel = await this.channelModel.findById(content.channelId).exec();
    
    if (!channel) {
      this.logger.error(`❌ Channel with id ${content.channelId} not found.`);
      return;
    }

    try {
      const youtubeUrl = `https://www.youtube.com/watch?v=${content.sourceContentId}`;
      this.logger.log(`🚀 Starting video analysis for: ${youtubeUrl}`);

      // Check if metadata exists
      let existingMetadata = null;
      if (content.metadata) {
        this.logger.log(`📊 Using existing metadata from database`);
        existingMetadata = content.metadata;
      } else if (job.data.hasMetadata) {
        // Refetch the content to get updated metadata
        const updatedContent = await this.contentModel.findById(job.data.contentId).exec();
        if (updatedContent?.metadata) {
          this.logger.log(`📊 Found fresh metadata in database`);
          existingMetadata = updatedContent.metadata;
        }
      }

      if (!existingMetadata) {
        this.logger.warn(`⚠️ No metadata found for content ${content._id}. Analysis may be less efficient.`);
      }

      // Pass existing metadata to analysis service
      const { analysis, prompt, modelUsed, modelUsageStats } = await this.videoAnalysisService.analyzeYouTubeVideo(
        youtubeUrl, 
        existingMetadata
      );
      
      await this.contentModel.updateOne({ _id: content._id }, {
        analysis: {
          promptVersion: prompt.version,
          promptName: prompt.promptName,
          promptId: prompt._id,
          modelUsed: modelUsed,
          result: analysis,
        },
        status: 'ANALYZED',
      });

      this.logger.log(`✅ Analysis completed using model: ${modelUsed}`);
      if (modelUsageStats && Object.keys(modelUsageStats).length > 1) {
        this.logger.log(`📊 Model usage breakdown:`, modelUsageStats);
      }
      
      this.logger.log(`✅ Successfully analyzed video: ${content.title || 'Unknown'}`);
      await this.statsQueue.add('update-stats', { contentId: content._id });
    } catch (error) {
      this.logger.error(`❌ Failed to analyze content ${content._id}: ${error.message}`);
      await this.contentModel.updateOne({ _id: content._id }, { status: 'FAILED' });
    }

    return {};  
  }  
}