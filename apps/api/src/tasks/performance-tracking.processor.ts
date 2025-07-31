import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { Channel } from '../schemas/channel.schema';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

interface PerformanceTrackingJobData {
  contentId?: string;
  channelId?: string;
  type: 'video' | 'channel';
}

@Processor('performance-tracking')
export class PerformanceTrackingProcessor extends WorkerHost {
  private readonly logger = new Logger(PerformanceTrackingProcessor.name);
  private youtube;

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
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

  async process(job: Job<PerformanceTrackingJobData, any, string>): Promise<any> {
    const { contentId, channelId, type } = job.data;

    if (type === 'video' && contentId) {
      return await this.trackVideoPerformance(contentId);
    } else if (type === 'channel' && channelId) {
      return await this.trackChannelPerformance(channelId);
    } else {
      throw new Error('Invalid job data: must specify either contentId for video tracking or channelId for channel tracking');
    }
  }

  /**
   * Track performance metrics for a specific video
   */
  private async trackVideoPerformance(contentId: string): Promise<any> {
    this.logger.log(`📊 Tracking video performance for content: ${contentId}`);
    
    const content = await this.contentModel.findById(contentId).exec();

    if (!content) {
      this.logger.error(`❌ Content with id ${contentId} not found.`);
      return { success: false, reason: 'Content not found' };
    }

    try {
      this.logger.log(`🔍 Fetching YouTube statistics for video: ${content.sourceContentId}`);
      
      const response = await this.youtube.videos.list({
        id: [content.sourceContentId],
        part: ['statistics'],
      });

      if (response.data.items && response.data.items.length > 0) {
        const stats = response.data.items[0].statistics;
        const newStats = {
          fetchDate: new Date(),
          viewCount: parseInt(stats.viewCount || '0'),
          likeCount: parseInt(stats.likeCount || '0'),
          commentCount: parseInt(stats.commentCount || '0'),
        };

        // Initialize statistics array if needed
        if (!content.statistics) {
          content.statistics = [];
        }
        
        content.statistics.push(newStats);
        await content.save();

        this.logger.log(`✅ Video performance metrics updated for ${content.title}:`);
        this.logger.log(`   👀 Views: ${newStats.viewCount.toLocaleString()}`);
        this.logger.log(`   👍 Likes: ${newStats.likeCount.toLocaleString()}`);
        this.logger.log(`   💬 Comments: ${newStats.commentCount.toLocaleString()}`);

        return {
          success: true,
          contentId: contentId,
          videoTitle: content.title,
          metrics: newStats,
        };
      } else {
        this.logger.warn(`⚠️ No statistics found for video ${content.sourceContentId}`);
        return { 
          success: false, 
          reason: 'No statistics found',
          contentId: contentId,
        };
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to track performance for video ${content.sourceContentId}: ${error.message}`,
      );
      return {
        success: false,
        contentId: contentId,
        error: error.message,
      };
    }
  }

  /**
   * Track performance metrics for a channel (aggregate stats)
   */
  private async trackChannelPerformance(channelId: string): Promise<any> {
    this.logger.log(`📊 Tracking channel performance for channel: ${channelId}`);
    
    const channel = await this.channelModel.findById(channelId).exec();

    if (!channel) {
      this.logger.error(`❌ Channel with id ${channelId} not found.`);
      return { success: false, reason: 'Channel not found' };
    }

    try {
      // Get all videos for this channel
      const channelVideos = await this.contentModel.find({ channelId: channelId }).exec();
      
      if (channelVideos.length === 0) {
        this.logger.warn(`⚠️ No videos found for channel ${channel.name}`);
        return { 
          success: false, 
          reason: 'No videos found',
          channelId: channelId,
        };
      }

      let totalViews = 0;
      let totalLikes = 0;
      let totalComments = 0;
      let videosWithStats = 0;

      // Aggregate statistics from all videos
      for (const video of channelVideos) {
        if (video.statistics && video.statistics.length > 0) {
          // Get the latest statistics for each video
          const latestStats = video.statistics[video.statistics.length - 1];
          totalViews += latestStats.viewCount || 0;
          totalLikes += latestStats.likeCount || 0;
          totalComments += latestStats.commentCount || 0;
          videosWithStats++;
        }
      }

      this.logger.log(`✅ Channel performance aggregated for ${channel.name}:`);
      this.logger.log(`   📹 Videos tracked: ${videosWithStats}/${channelVideos.length}`);
      this.logger.log(`   👀 Total views: ${totalViews.toLocaleString()}`);
      this.logger.log(`   👍 Total likes: ${totalLikes.toLocaleString()}`);
      this.logger.log(`   💬 Total comments: ${totalComments.toLocaleString()}`);

      return {
        success: true,
        channelId: channelId,
        channelName: channel.name,
        aggregateMetrics: {
          totalVideos: channelVideos.length,
          videosWithStats: videosWithStats,
          totalViews: totalViews,
          totalLikes: totalLikes,
          totalComments: totalComments,
          averageViewsPerVideo: videosWithStats > 0 ? Math.round(totalViews / videosWithStats) : 0,
          averageLikesPerVideo: videosWithStats > 0 ? Math.round(totalLikes / videosWithStats) : 0,
          averageCommentsPerVideo: videosWithStats > 0 ? Math.round(totalComments / videosWithStats) : 0,
          trackingDate: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(
        `❌ Failed to track channel performance for ${channel.name}: ${error.message}`,
      );
      return {
        success: false,
        channelId: channelId,
        error: error.message,
      };
    }
  }
}