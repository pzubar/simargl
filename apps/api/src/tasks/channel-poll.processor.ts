import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';  
import { Job, Queue } from 'bullmq';  
import { InjectModel } from '@nestjs/mongoose';  
import { Model } from 'mongoose';  
import { Channel } from '../schemas/channel.schema';
import { Content } from '../schemas/content.schema';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

@Processor('channel-poll')  
export class ChannelPollProcessor extends WorkerHost {  
  private youtube;

  constructor(
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('content-processing') private contentProcessingQueue: Queue,
    private configService: ConfigService,
  ) {
    super();
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
    if (!apiKey) {
      throw new Error('YOUTUBE_API_KEY is required');
    }
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });
  }

  async process(job: Job<any, any, string>): Promise<any> {  
    console.log(`Processing job ${job.id} of type ${job.name} with data ${JSON.stringify(job.data)}...`);  
    const channel = await this.channelModel.findById(job.data.channelId).exec();
    if (!channel) {
      console.error(`Channel with id ${job.data.channelId} not found.`);
      return;
    }

    if (channel.sourceType === 'YOUTUBE') {
      try {
        const response = await this.youtube.search.list({
          channelId: channel.sourceId,
          part: ['snippet'],
          order: 'date',
          maxResults: Number(channel.fetchLastN),
          type: 'video',
        });

        console.log(`Fetched ${response.data.items.length} videos for channel ${channel.sourceId}`, response);

        if (response.data.items) {
          for (const item of response.data.items) {
            if (item.id?.videoId) {
              const sourceContentId = item.id.videoId;
              const existingContent = await this.contentModel.findOne({ sourceContentId }).exec();
              if (!existingContent) {
                const newContent = new this.contentModel({
                  sourceContentId,
                  channelId: channel._id,
                  title: item.snippet?.title || 'Untitled',
                  description: item.snippet?.description || '',
                  publishedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
                  status: 'PENDING',
                  data: {},
                });
                await newContent.save();
                await this.contentProcessingQueue.add('process-content', { contentId: newContent._id });
              }
            }
          }
        }
      } catch (error) {
        console.error(`Failed to fetch videos for channel ${channel.sourceId}:`, error);
        throw error;
      }
    }
    return {};  
  }  
}