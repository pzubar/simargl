import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { VideoAnalysisService } from '../services/video-analysis.service';
import { Logger } from '@nestjs/common';

@Processor('metadata-processing')
export class MetadataProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataProcessingProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('analysis') private analysisQueue: Queue,
    private videoAnalysisService: VideoAnalysisService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`📋 Processing metadata for content: ${job.data.contentId}`);
    
    const content = await this.contentModel.findById(job.data.contentId).exec();
    
    if (!content) {
      this.logger.error(`❌ Content with id ${job.data.contentId} not found.`);
      return;
    }

    try {
      // Construct YouTube URL
      const youtubeUrl = `https://www.youtube.com/watch?v=${content.sourceContentId}`;
      
      this.logger.log(`🔍 Fetching metadata for: ${youtubeUrl}`);

      // Fetch video metadata
      const { videoId, metadata } = await this.videoAnalysisService.fetchVideoMetadata(youtubeUrl);

      // Save metadata to database
      await this.contentModel.updateOne(
        { _id: content._id },
        {
          metadata: metadata,
          status: 'METADATA_FETCHED',
        }
      );

      this.logger.log(`✅ Successfully saved metadata for content: ${content._id}`);
      this.logger.log(`   📊 Duration: ${Math.round(metadata.duration / 60)}m ${metadata.duration % 60}s`);
      this.logger.log(`   👀 Views: ${metadata.viewCount.toLocaleString()}`);

      // Queue for analysis with retry configuration
      await this.analysisQueue.add('analyze-content', { 
        contentId: content._id,
        hasMetadata: true // Flag to indicate metadata is already available
      }, {
        attempts: 4, // Total attempts (1 initial + 3 retries)
        backoff: {
          type: 'exponential',
          delay: 30000, // 30 seconds base delay
        },
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 20, // Keep last 20 failed jobs for debugging
      });

    } catch (error) {
      this.logger.error(`❌ Failed to fetch metadata for ${content.sourceContentId}: ${error.message}`);
      
      await this.contentModel.updateOne(
        { _id: content._id },
        { status: 'FAILED' }
      );
    }

    return {};
  }
} 