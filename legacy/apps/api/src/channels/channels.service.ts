import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Queue } from 'bullmq';
import { Channel } from '../schemas/channel.schema';

export interface CreateChannelDto {
  sourceType: 'YOUTUBE' | 'TELEGRAM' | 'TIKTOK';
  sourceId: string;
  name: string;
  fetchLastN?: number;
  cronPattern?: string;
  authorContext?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ChannelsService {
  constructor(
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @InjectQueue('channel-monitoring') private channelMonitoringQueue: Queue, // Updated queue name
    @InjectQueue('performance-tracking')
    private performanceTrackingQueue: Queue, // NEW queue for performance tracking
  ) {}

  async createChannel(createChannelDto: CreateChannelDto): Promise<Channel> {
    // Create the channel in the database
    const channel = new this.channelModel(createChannelDto);
    await channel.save();

    // If it's a YouTube channel, schedule jobs and perform initial bulk fetch
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleChannelJobs(channel.id, channel.cronPattern);
    }

    return channel;
  }

  /**
   * Schedule all jobs for a YouTube channel including recurring monitoring,
   * performance tracking, and initial bulk video fetch
   */
  private async scheduleChannelJobs(
    channelId: string,
    cronPattern: string,
  ): Promise<void> {
    console.log(`🔧 Setting up jobs for YouTube channel: ${channelId}`);

    // 1. Schedule recurring channel monitoring (every 30 minutes by default)
    await this.scheduleRecurringChannelPoll(channelId, cronPattern);

    // 2. Schedule performance tracking (every 6 hours)
    await this.schedulePerformanceTracking(channelId);

    // 3. Trigger initial bulk video fetch (immediate)
    await this.triggerInitialBulkFetch(channelId);

    console.log(`✅ All jobs scheduled for channel: ${channelId}`);
  }

  /**
   * Schedule performance tracking for the channel
   */
  private async schedulePerformanceTracking(channelId: string): Promise<void> {
    const jobName = `performance-tracking-${channelId}`;

    try {
      await this.performanceTrackingQueue.add(
        'track-channel-performance',
        { channelId, type: 'channel' },
        {
          repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
          removeOnComplete: 5,
          removeOnFail: 3,
          jobId: jobName,
        },
      );
      console.log(
        `✅ Scheduled performance tracking for channel: ${channelId}`,
      );
    } catch (error) {
      console.warn(
        `⚠️ Failed to schedule performance tracking for ${channelId}: ${error.message}`,
      );
    }
  }

  /**
   * Trigger initial bulk fetch of videos from 2025 or last 150 videos
   */
  private async triggerInitialBulkFetch(channelId: string): Promise<void> {
    try {
      const job = await this.channelMonitoringQueue.add(
        'monitor-channel',
        {
          channelId,
          initialFetch: true,
          fetchLastN: 150, // Fetch up to 150 videos initially
        },
        {
          priority: 10, // Higher priority for initial fetch
          removeOnComplete: 5,
          removeOnFail: 3,
        },
      );
      console.log(
        `🚀 Triggered initial bulk fetch for channel: ${channelId}, Job ID: ${job.id}`,
      );
    } catch (error) {
      console.warn(
        `⚠️ Failed to trigger initial bulk fetch for ${channelId}: ${error.message}`,
      );
    }
  }

  async scheduleRecurringChannelPoll(
    channelId: string,
    cronPattern: string,
  ): Promise<void> {
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
      `✅ Scheduled recurring job for channel ${channelId} with pattern: ${cronPattern}`,
    );
  }

  async removeRecurringChannelPoll(channelId: string): Promise<void> {
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

  async scheduleChannelPollTask(channelId: string): Promise<void> {
    // This method is deprecated, replaced with scheduleRecurringChannelPoll
    // Schedule an immediate job to start monitoring the channel
    await this.channelMonitoringQueue.add('monitor-channel', { channelId });
    console.log(
      `✅ Scheduled immediate channel monitoring task for channel: ${channelId}`,
    );
  }

  async getAllChannels(): Promise<Channel[]> {
    return this.channelModel.find().exec();
  }

  async getChannelById(id: string): Promise<Channel | null> {
    const channel = await this.channelModel.findById(id).exec();
    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }
    return channel;
  }

  async deleteChannel(id: string): Promise<void> {
    const channel = await this.channelModel.findById(id).exec();
    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    // Remove recurring job before deleting the channel if it's a YouTube channel
    if (channel.sourceType === 'YOUTUBE') {
      await this.removeRecurringChannelPoll(id);
      console.log(
        `✅ Removed recurring job for deleted channel: ${channel.name}`,
      );
    }

    const result = await this.channelModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }
    console.log(`✅ Deleted channel: ${id}`);
  }

  async updateChannel(
    id: string,
    updateData: Partial<CreateChannelDto>,
  ): Promise<Channel> {
    const currentChannel = await this.channelModel.findById(id).exec();
    if (!currentChannel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    const channel = await this.channelModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .exec();

    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    // If cronPattern was updated and it's a YouTube channel, reschedule the job
    if (
      updateData.cronPattern &&
      currentChannel.sourceType === 'YOUTUBE' &&
      updateData.cronPattern !== currentChannel.cronPattern
    ) {
      await this.scheduleRecurringChannelPoll(id, updateData.cronPattern);
      console.log(
        `✅ Updated recurring job for channel: ${channel.name} (${updateData.cronPattern})`,
      );
    }

    return channel;
  }

  async triggerManualChannelPoll(
    channelId: string,
    fetchLastN?: number,
  ): Promise<void> {
    const job = await this.channelMonitoringQueue.add(
      'monitor-channel',
      {
        channelId,
        fetchLastN: fetchLastN, // Pass this to the job if provided
      },
      {
        removeOnComplete: true, // Clean up after completion
        removeOnFail: true, // Clean up on failure
      },
    );
    console.log(
      `✅ Manually triggered channel monitoring for ${channelId}, Job ID: ${job.id}`,
    );
  }
}
