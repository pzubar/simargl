import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';  
import { Job, Queue } from 'bullmq';  
import { InjectModel } from '@nestjs/mongoose';  
import { Model } from 'mongoose';  
import { Channel } from '../schemas/channel.schema';
import { Content } from '../schemas/content.schema';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@Processor('channel-poll')  
export class ChannelPollProcessor extends WorkerHost {  
  private readonly logger = new Logger(ChannelPollProcessor.name);
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
    this.logger.log(`🔄 Processing channel poll job ${job.id} with data: ${JSON.stringify(job.data)}`);  
    
    const channel = await this.channelModel.findById(job.data.channelId).exec();
    if (!channel) {
      this.logger.error(`❌ Channel with id ${job.data.channelId} not found in database`);
      return;
    }

    this.logger.log(`📺 Found channel: "${channel.name}" (${channel.sourceType})`);
    this.logger.log(`🎯 Channel source ID: ${channel.sourceId}`);
    this.logger.log(`📊 Fetch last N videos: ${channel.fetchLastN}`);

    if (channel.sourceType === 'YOUTUBE') {
      try {
        const searchParams = {
          channelId: channel.sourceId,
          part: ['snippet'],
          order: 'date',
          maxResults: Number(channel.fetchLastN),
          type: 'video',
        };

        this.logger.log(`🚀 Calling YouTube API with params:`, JSON.stringify(searchParams, null, 2));
        
        const response = await this.youtube.search.list(searchParams);

        this.logger.log(`📡 YouTube API response status: ${response.status}`);
        this.logger.log(`📊 Total items in response: ${response.data.items?.length || 0}`);
        
        if (response.data.pageInfo) {
          this.logger.log(`📄 Page info - Total results: ${response.data.pageInfo.totalResults}, Results per page: ${response.data.pageInfo.resultsPerPage}`);
        }

        if (response.data.items && response.data.items.length > 0) {
          this.logger.log(`🎥 Found ${response.data.items.length} videos from YouTube API`);
          
          let newVideosCount = 0;
          let skippedVideosCount = 0;

          for (const item of response.data.items) {
            if (item.id?.videoId) {
              const sourceContentId = item.id.videoId;
              this.logger.debug(`🔍 Processing video: ${sourceContentId} - "${item.snippet?.title}"`);
              
              const existingContent = await this.contentModel.findOne({ sourceContentId }).exec();
              if (!existingContent) {
                this.logger.log(`➕ Adding new video: ${sourceContentId} - "${item.snippet?.title}"`);
                
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
                await this.contentProcessingQueue.add('process-content', { 
                  contentId: newContent._id.toString() // Ensure it's a string
                }, {
                  attempts: 3,
                  backoff: {
                    type: 'exponential',
                    delay: 5000,
                  },
                  removeOnComplete: 10,
                  removeOnFail: 20,
                });
                newVideosCount++;
              } else {
                this.logger.debug(`⏭️ Skipping existing video: ${sourceContentId}`);
                skippedVideosCount++;
              }
            } else {
              this.logger.warn(`⚠️ Video item missing videoId:`, JSON.stringify(item, null, 2));
            }
          }

          this.logger.log(`✅ Channel poll completed for ${channel.sourceId}:`);
          this.logger.log(`   📈 New videos added: ${newVideosCount}`);
          this.logger.log(`   ⏭️ Existing videos skipped: ${skippedVideosCount}`);
          this.logger.log(`   📊 Total videos from API: ${response.data.items.length}`);
        } else {
          this.logger.warn(`⚠️ No videos found for channel ${channel.sourceId}`);
          this.logger.warn(`🔍 Full YouTube API response:`, JSON.stringify(response.data, null, 2));
        }
      } catch (error) {
        this.logger.error(`❌ Failed to fetch videos for channel ${channel.sourceId}:`);
        this.logger.error(`   Error message: ${error.message}`);
        this.logger.error(`   Error code: ${error.code}`);
        this.logger.error(`   Error details:`, error);
        
        if (error.response) {
          this.logger.error(`   HTTP status: ${error.response.status}`);
          this.logger.error(`   Response data:`, JSON.stringify(error.response.data, null, 2));
        }
        
        throw error;
      }
    } else {
      this.logger.warn(`⚠️ Unsupported channel source type: ${channel.sourceType}`);
    }
    
    return {};  
  }  
}