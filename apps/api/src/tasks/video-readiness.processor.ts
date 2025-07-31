import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Content } from '../schemas/content.schema';

@Processor('video-readiness', {
  limiter: {
    max: 30, // More frequent checks allowed - database operations only
    duration: 60000,
  },
})
export class VideoReadinessProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoReadinessProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('insight-gathering') private insightGatheringQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ batchSize?: number }>): Promise<any> {
    const batchSize = job.data.batchSize || 10;

    this.logger.log(
      `🔍 Checking for videos ready for insight gathering (batch size: ${batchSize})`,
    );

    // Find videos with metadata ready
    const readyVideos = await this.contentModel
      .find({ status: 'METADATA_READY' })
      .limit(batchSize)
      .exec();

    if (readyVideos.length === 0) {
      this.logger.log(`📭 No videos ready for insight gathering`);
      return { processedVideos: 0 };
    }

    this.logger.log(
      `📦 Found ${readyVideos.length} videos ready for insight gathering`,
    );

    let totalInsightJobs = 0;

    for (const video of readyVideos) {
      try {
        // Calculate optimal chunks for this video
        const chunkDuration = 300; // 5 minutes per chunk for optimal insight extraction
        const videoDuration = video.metadata?.duration || 600; // Default to 10 minutes if unknown
        const totalChunks = Math.ceil(videoDuration / chunkDuration);

        this.logger.log(
          `📊 Video ${video._id}: ${videoDuration}s → ${totalChunks} chunks`,
        );

        // Queue insight gathering jobs for each chunk
        for (let i = 0; i < totalChunks; i++) {
          const startTime = i * chunkDuration;
          const endTime = Math.min((i + 1) * chunkDuration, videoDuration);

          await this.insightGatheringQueue.add(
            'gather-insights',
            {
              contentId: video._id.toString(),
              chunkIndex: i,
              startTime: startTime,
              endTime: endTime,
              totalChunks: totalChunks,
              youtubeUrl: `https://www.youtube.com/watch?v=${video.sourceContentId}`,
              videoInfo: {
                title: video.title,
                description: video.description,
                duration: videoDuration,
                channel: video.metadata?.channel,
                publishedAt: video.publishedAt,
              },
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 30000 },
              removeOnComplete: 10,
              removeOnFail: 20,
            },
          );
        }

        // Update video status
        await this.contentModel.updateOne(
          { _id: video._id },
          {
            status: 'INSIGHTS_QUEUED',
            insightJobsQueuedAt: new Date(),
          },
        );

        totalInsightJobs += totalChunks;
      } catch (error) {
        this.logger.error(
          `❌ Failed to queue insights for video ${video._id}: ${error.message}`,
        );

        // Update video status to failed
        await this.contentModel.updateOne(
          { _id: video._id },
          { status: 'FAILED' },
        );
      }
    }

    this.logger.log(
      `✅ Queued ${totalInsightJobs} insight gathering jobs for ${readyVideos.length} videos`,
    );

    return {
      processedVideos: readyVideos.length,
      queuedInsightJobs: totalInsightJobs,
    };
  }
}
