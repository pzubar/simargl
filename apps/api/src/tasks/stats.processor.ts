import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

@Processor('stats')
export class StatsProcessor extends WorkerHost {
  private youtube;

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
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
    console.log(`Updating stats for content: ${job.data.contentId}`);
    const content = await this.contentModel.findById(job.data.contentId).exec();

    if (!content) {
      console.error(`Content with id ${job.data.contentId} not found.`);
      return;
    }

    try {
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

        if (!content.statistics) {
          content.statistics = [];
        }
        content.statistics.push(newStats);
        await content.save();
      }
    } catch (error) {
      console.error(
        `Failed to fetch stats for ${content.sourceContentId}`,
        error,
      );
    }

    return {};
  }
}
