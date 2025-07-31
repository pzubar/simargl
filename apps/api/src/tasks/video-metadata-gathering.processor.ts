import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { VideoInsightService } from '../services/video-insight.service';
import { Logger } from '@nestjs/common';

@Processor('video-metadata')
export class VideoMetadataGatheringProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoMetadataGatheringProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    private videoInsightService: VideoInsightService,
  ) {
    super();
  }

  async process(job: Job<{ contentId: string }>): Promise<void> {
    this.logger.log(
      `📊 Gathering video metadata for content: ${job.data.contentId}`,
    );

    const { contentId } = job.data;

    const content = await this.contentModel.findById(job.data.contentId).exec();

    if (!content) {
      this.logger.error(`❌ Content with id ${job.data.contentId} not found.`);
      return;
    }

    try {
      // Construct YouTube URL
      const youtubeUrl = `https://www.youtube.com/watch?v=${content.sourceContentId}`;

      this.logger.log(`🔍 Gathering metadata for video: ${youtubeUrl}`);

      // Fetch video metadata using the renamed service
      const { metadata } = await this.videoInsightService.fetchVideoMetadata(youtubeUrl);

      // Save metadata to database with new business-focused status
      await this.contentModel.updateOne(
        { _id: content._id },
        {
          metadata: metadata,
          status: 'METADATA_READY', // New business-focused status
          metadataGatheredAt: new Date(), // Track when metadata was gathered
        },
      );

      this.logger.log(
        `✅ Video metadata gathered successfully for content: ${content._id}`,
      );
      this.logger.log(
        `   📊 Duration: ${Math.round(metadata.duration / 60)}m ${metadata.duration % 60}s`,
      );
      this.logger.log(`   👀 Views: ${metadata.viewCount.toLocaleString()}`);
      this.logger.log(`   👤 Channel: ${metadata.channel}`);

      // IMPORTANT: NO direct job queueing here - this is the key decoupling improvement
      // The VideoReadinessProcessor will periodically check for videos with METADATA_READY status
      // and queue insight gathering jobs appropriately
      this.logger.log(`🎯 Video ready for insight gathering (will be picked up by VideoReadinessProcessor)`);

    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `❌ Failed to gather metadata for ${content.sourceContentId}: ${error.message}`,
        );
      }
      await this.contentModel.updateOne(
        { _id: content._id },
        { 
          status: 'FAILED',
          lastError: error.message,
          metadataFailedAt: new Date(),
        },
      );
    }
  }
}