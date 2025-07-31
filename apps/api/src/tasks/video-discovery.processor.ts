import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content } from '../schemas/content.schema';
import { Logger } from '@nestjs/common';

@Processor('video-discovery')
export class VideoDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoDiscoveryProcessor.name);

  constructor(
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectQueue('video-metadata') private videoMetadataQueue: Queue,
  ) {
    super();
  }

  /**
   * Check if error is due to invalid data (non-retryable)
   */
  private isValidationError(error: any): boolean {
    const errorMessage = error?.message || '';
    const validationKeywords = [
      'not found',
      'invalid',
      'required',
      'missing',
      'malformed',
      'bad request',
      'validation',
      'content with id',
      'database query failed',
    ];

    return (
      error?.status === 400 ||
      error?.status === 404 ||
      error?.code === 400 ||
      error?.code === 404 ||
      validationKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase()),
      )
    );
  }

  /**
   * Check if error indicates system overload (retryable)
   */
  private isOverloadError(error: any): boolean {
    const errorMessage = error?.message || '';
    const overloadKeywords = [
      'overloaded',
      'UNAVAILABLE',
      'Service Unavailable',
      'try again later',
      'capacity',
    ];

    return (
      error?.status === 503 ||
      error?.code === 503 ||
      overloadKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase()),
      )
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    // Enhanced logging for video discovery
    this.logger.log(`🎬 Processing video discovery job: ${job.id}`);
    this.logger.debug(
      `📊 Job data structure:`,
      JSON.stringify(job.data, null, 2),
    );

    // Validate job data structure
    if (!job.data) {
      throw new Error('Job data is missing or undefined');
    }

    if (!job.data.contentId) {
      throw new Error(
        `Job data missing contentId. Available keys: ${Object.keys(job.data).join(', ')}`,
      );
    }

    this.logger.log(`🔍 Initializing video discovery for content ID: ${job.data.contentId}`);

    // More robust database query with detailed logging
    let content;
    try {
      content = await this.contentModel.findById(job.data.contentId).exec();
      this.logger.debug(
        `📊 Database query result: ${content ? 'FOUND' : 'NOT_FOUND'}`,
      );
    } catch (dbError) {
      this.logger.error(`❌ Database query failed:`, dbError);
      throw new Error(`Database query failed: ${dbError.message}`);
    }

    if (!content) {
      this.logger.error(
        `❌ Content with id ${job.data.contentId} not found in database.`,
      );

      // Additional debugging: check if it's an ObjectId issue
      try {
        const allContent = await this.contentModel.find({}).limit(5).exec();
        this.logger.debug(
          `📊 Sample content IDs in database: ${allContent.map((c) => c._id.toString()).join(', ')}`,
        );
      } catch (debugError) {
        this.logger.error(
          `❌ Failed to query sample content for debugging:`,
          debugError,
        );
      }

      throw new Error(`Content not found: ${job.data.contentId}`);
    }

    this.logger.log(
      `✅ Found video for discovery: "${content.title}" (${content.sourceContentId})`,
    );

    try {
      // Initialize video for the insight gathering pipeline
      this.logger.log(
        `🎯 Initializing video for insight pipeline: ${content.sourceContentId}`,
      );

      // Update status to indicate video discovery initialization has started
      this.logger.debug(`🔄 Updating video status to INITIALIZING...`);
      const updateResult = await this.contentModel.updateOne(
        { _id: content._id },
        {
          status: 'INITIALIZING',
          discoveryInitializedAt: new Date(),
        },
      );

      this.logger.debug(
        `📊 Status update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`,
      );

      // Queue video metadata gathering (next step in the business workflow)
      this.logger.debug(`🚀 Adding job to video-metadata queue...`);
      const metadataJob = await this.videoMetadataQueue.add(
        'gather-video-metadata',
        {
          contentId: content._id.toString(), // Ensure it's a string
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 10,
          removeOnFail: 20,
        },
      );

      this.logger.log(
        `✅ Video discovery initialized successfully for: ${content._id} (metadata job: ${metadataJob.id})`,
      );
      
      return {
        contentId: content._id.toString(),
        videoTitle: content.title,
        sourceContentId: content.sourceContentId,
        status: 'INITIALIZING',
        metadataJobId: metadataJob.id,
      };
    } catch (processingError) {
      this.logger.error(
        `❌ Failed to initialize video discovery for ${content?.sourceContentId || 'unknown'}:`,
        processingError,
      );

      // Determine if this is a retryable error
      const isValidation = this.isValidationError(processingError);
      const isOverload = this.isOverloadError(processingError);

      this.logger.debug(
        `📊 Error classification: validation=${isValidation}, overload=${isOverload}`,
      );

      try {
        if (content && content._id) {
          const status = isValidation ? 'FAILED' : 'DISCOVERED'; // Return to DISCOVERED for retry
          const failUpdateResult = await this.contentModel.updateOne(
            { _id: content._id },
            {
              status: status,
              lastError: processingError.message,
              discoveryFailedAt: new Date(),
            },
          );
          this.logger.debug(
            `📊 Status update (${status}): matched=${failUpdateResult.matchedCount}, modified=${failUpdateResult.modifiedCount}`,
          );
        }
      } catch (updateError) {
        this.logger.error(`❌ Failed to update content status:`, updateError);
      }

      // Only re-throw for retryable errors
      if (isValidation) {
        this.logger.error(
          `❌ Validation error - job will NOT be retried: ${processingError.message}`,
        );
        // Don't re-throw validation errors to prevent retry
        return {
          contentId: content._id.toString(),
          videoTitle: content.title,
          sourceContentId: content.sourceContentId,
          status: 'FAILED',
          error: processingError.message,
        };
      }

      // Re-throw for retryable errors (overload, network issues, etc.)
      this.logger.warn(
        `⚠️ Retryable error - job will be rescheduled: ${processingError.message}`,
      );
      throw processingError;
    }
  }
}