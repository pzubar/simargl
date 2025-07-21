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
    console.log(`Analyzing content: ${job.data.contentId}`);  
    const content = await this.contentModel.findById(job.data.contentId).exec();  
    
    if (!content) {
      console.error(`Content with id ${job.data.contentId} not found.`);
      return;
    }
    
    const channel = await this.channelModel.findById(content.channelId).exec();
    
    if (!channel) {
      console.error(`Channel with id ${content.channelId} not found.`);
      return;
    }

    try {
      // No need to fetch the prompt here anymore, the service does it.
      const youtubeUrl = `https://www.youtube.com/watch?v=${content.sourceContentId}`;
      this.logger.log(`Starting video analysis for: ${youtubeUrl}`);
      
      const { analysis, prompt } = await this.videoAnalysisService.analyzeYouTubeVideo(youtubeUrl);
      
      await this.contentModel.updateOne({ _id: content._id }, {
        analysis: {
          promptVersion: prompt.version,
          promptName: prompt.promptName,
          promptId: prompt._id,
          result: analysis,
        },
        status: 'ANALYZED',
      });
      
      this.logger.log(`✅ Successfully analyzed video: ${content.title || 'Unknown'}`);
      await this.statsQueue.add('update-stats', { contentId: content._id });
    } catch (error) {
      console.error(`Failed to analyze content ${content._id}:`, error);
      content.status = 'FAILED';
      await content.save();
      throw error;
    }

    return {};  
  }  
}