import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { Channel } from '../schemas/channel.schema';
import { Content } from '../schemas/content.schema';
import { Prompt } from '../schemas/prompt.schema';

export interface CreateChannelDto {
  sourceType: 'YOUTUBE' | 'TELEGRAM' | 'TIKTOK';
  sourceId: string;
  name: string;
  fetchLastN?: number;
  cronPattern?: string;
  authorContext?: string;
  metadata?: Record<string, any>;
}

export interface CreateContentDto {
  channelId: string;
  sourceContentId: string;
  title: string;
  description?: string;
  publishedAt?: Date;
  status?: 'PENDING' | 'PROCESSING' | 'ANALYZED' | 'FAILED';
  data?: {
    transcript?: string;
    text?: string;
  };
}

export interface CreatePromptDto {
  promptName: string;
  promptTemplate: string;
  description?: string;
  version: number;
  isDefault?: boolean;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectModel(Content.name) private contentModel: Model<Content>,
    @InjectModel(Prompt.name) private promptModel: Model<Prompt>,
    @InjectQueue('channel-monitoring') private channelMonitoringQueue: Queue, // Updated queue name
    @InjectQueue('video-readiness') private videoReadinessQueue: Queue, // NEW queue for decoupled scheduling
    @InjectQueue('research-scheduling') private researchSchedulingQueue: Queue, // NEW queue for research scheduling
  ) {}

  // ============== CHANNELS ==============
  async getAllChannels() {
    return this.channelModel.find().sort({ createdAt: -1 }).exec();
  }

  async getChannelById(id: string) {
    return this.channelModel.findById(id).exec();
  }

  async createChannel(createChannelDto: CreateChannelDto) {
    const channel = new this.channelModel(createChannelDto);
    await channel.save();

    // Schedule recurring polling task for YouTube channels
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleRecurringChannelPoll(channel.id, channel.cronPattern);
      console.log(
        `✅ [Admin] Scheduled recurring channel poll task for: ${channel.name} (${channel.cronPattern})`,
      );
    }

    return channel;
  }

  async updateChannel(id: string, updateData: Partial<CreateChannelDto>) {
    const currentChannel = await this.channelModel.findById(id).exec();
    if (!currentChannel) {
      throw new Error(`Channel with id ${id} not found`);
    }

    const updatedChannel = await this.channelModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .exec();

    // If cronPattern was updated and it's a YouTube channel, reschedule the job
    if (
      updateData.cronPattern &&
      currentChannel.sourceType === 'YOUTUBE' &&
      updateData.cronPattern !== currentChannel.cronPattern
    ) {
      await this.scheduleRecurringChannelPoll(id, updateData.cronPattern);
      console.log(
        `✅ [Admin] Updated recurring job for channel: ${updatedChannel.name} (${updateData.cronPattern})`,
      );
    }

    return updatedChannel;
  }

  async updateContent(id: string, updateData: Partial<CreateContentDto>) {
    return this.contentModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .exec();
  }

  // ============== RECURRING JOB MANAGEMENT ==============
  async scheduleRecurringChannelPoll(channelId: string, cronPattern: string) {
    const jobName = `monitor-channel-${channelId}`;

    // Remove any existing recurring job for this channel
    await this.removeRecurringChannelPoll(channelId);

    // Add new recurring job
    await this.channelMonitoringQueue.add(
      'monitor-channel',
      { channelId },
      {
        repeat: { pattern: cronPattern },
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 5, // Keep last 5 failed jobs
        jobId: jobName, // Use consistent job ID for easy management
      },
    );

    console.log(
      `✅ Scheduled recurring channel monitoring for ${channelId} with pattern: ${cronPattern}`,
    );
  }

  async removeRecurringChannelPoll(channelId: string) {
    const jobName = `monitor-channel-${channelId}`;

    try {
      // Get the repeatable job
      const repeatableJobs =
        await this.channelMonitoringQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find((job) => job.id === jobName);

      if (jobToRemove) {
        await this.channelMonitoringQueue.removeRepeatableByKey(
          jobToRemove.key,
        );
        console.log(`✅ Removed recurring channel monitoring for ${channelId}`);
      }
    } catch (error) {
      console.warn(
        `⚠️ Could not remove recurring channel monitoring for ${channelId}: ${error.message}`,
      );
    }
  }

  async updateChannelCronPattern(channelId: string, newCronPattern: string) {
    const channel = await this.channelModel.findById(channelId).exec();
    if (!channel) {
      throw new Error(`Channel with id ${channelId} not found`);
    }

    // Update the database
    await this.channelModel
      .findByIdAndUpdate(
        channelId,
        { cronPattern: newCronPattern },
        { new: true, runValidators: true },
      )
      .exec();

    // Reschedule the recurring job if it's a YouTube channel
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleRecurringChannelPoll(channelId, newCronPattern);
      console.log(
        `✅ Updated recurring job for channel ${channelId} with new pattern: ${newCronPattern}`,
      );
    }
  }

  async startAllChannelPolling() {
    const channels = await this.channelModel
      .find({ sourceType: 'YOUTUBE' })
      .exec();

    for (const channel of channels) {
      await this.scheduleRecurringChannelPoll(channel.id, channel.cronPattern);
    }

    console.log(
      `✅ Started recurring polling for ${channels.length} YouTube channels`,
    );
    return { scheduledChannels: channels.length };
  }

  async stopAllChannelPolling() {
    const channels = await this.channelModel
      .find({ sourceType: 'YOUTUBE' })
      .exec();

    for (const channel of channels) {
      await this.removeRecurringChannelPoll(channel.id);
    }

    console.log(
      `✅ Stopped recurring polling for ${channels.length} YouTube channels`,
    );
    return { stoppedChannels: channels.length };
  }

  async triggerManualChannelPoll(channelId: string) {
    await this.channelMonitoringQueue.add('monitor-channel', { channelId });
    console.log(`✅ Manually triggered channel monitoring for: ${channelId}`);
  }

  // ============== GLOBAL SYSTEM SCHEDULING ==============

  /**
   * Initialize system-wide periodic processors that run independently of channels
   */
  async initializeSystemPeriodicProcessors() {
    await this.scheduleVideoReadinessProcessor();
    await this.scheduleResearchSchedulerProcessor();

    console.log(`✅ Initialized system-wide periodic processors`);
    return {
      videoReadinessScheduled: true,
      researchSchedulerScheduled: true,
    };
  }

  /**
   * Schedule VideoReadinessProcessor to run every 3 minutes
   * Checks for videos with METADATA_READY status and queues insight gathering jobs
   */
  async scheduleVideoReadinessProcessor() {
    const jobName = 'video-readiness-check';

    try {
      // Remove any existing job
      await this.removeSystemJob(this.videoReadinessQueue, jobName);

      // Schedule new recurring job
      await this.videoReadinessQueue.add(
        'check-readiness',
        { batchSize: 10 }, // Process up to 10 videos per check
        {
          repeat: { pattern: '*/3 * * * *' }, // Every 3 minutes
          removeOnComplete: 5,
          removeOnFail: 3,
          jobId: jobName,
        },
      );

      console.log(
        `✅ Scheduled VideoReadinessProcessor to run every 3 minutes`,
      );
    } catch (error) {
      console.error(
        `❌ Failed to schedule VideoReadinessProcessor: ${error.message}`,
      );
    }
  }

  /**
   * Schedule ResearchSchedulerProcessor to run every 7 minutes
   * Checks for videos with INSIGHTS_GATHERED status and queues research processing jobs
   */
  async scheduleResearchSchedulerProcessor() {
    const jobName = 'research-scheduler';

    try {
      // Remove any existing job
      await this.removeSystemJob(this.researchSchedulingQueue, jobName);

      // Schedule new recurring job
      await this.researchSchedulingQueue.add(
        'schedule-research',
        { batchSize: 15 }, // Process up to 15 videos per check
        {
          repeat: { pattern: '*/7 * * * *' }, // Every 7 minutes
          removeOnComplete: 5,
          removeOnFail: 3,
          jobId: jobName,
        },
      );

      console.log(
        `✅ Scheduled ResearchSchedulerProcessor to run every 7 minutes`,
      );
    } catch (error) {
      console.error(
        `❌ Failed to schedule ResearchSchedulerProcessor: ${error.message}`,
      );
    }
  }

  /**
   * Stop system-wide periodic processors
   */
  async stopSystemPeriodicProcessors() {
    await this.removeSystemJob(
      this.videoReadinessQueue,
      'video-readiness-check',
    );
    await this.removeSystemJob(
      this.researchSchedulingQueue,
      'research-scheduler',
    );

    console.log(`✅ Stopped system-wide periodic processors`);
    return {
      videoReadinessStopped: true,
      researchSchedulerStopped: true,
    };
  }

  /**
   * Helper method to remove system jobs
   */
  private async removeSystemJob(queue: Queue, jobName: string) {
    try {
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find((job) => job.id === jobName);

      if (jobToRemove) {
        await queue.removeRepeatableByKey(jobToRemove.key);
        console.log(`✅ Removed system job: ${jobName}`);
      }
    } catch (error) {
      console.warn(
        `⚠️ Could not remove system job ${jobName}: ${error.message}`,
      );
    }
  }
}
