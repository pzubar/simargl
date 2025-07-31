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
    @InjectQueue('channel-poll') private channelPollQueue: Queue,
  ) {}

  async createChannel(createChannelDto: CreateChannelDto): Promise<Channel> {
    // Create the channel in the database
    const channel = new this.channelModel(createChannelDto);
    await channel.save();

    // If it's a YouTube channel, schedule recurring polling
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleRecurringChannelPoll(channel.id, channel.cronPattern);
    }

    return channel;
  }

  async scheduleRecurringChannelPoll(
    channelId: string,
    cronPattern: string,
  ): Promise<void> {
    const jobName = `poll-channel-${channelId}`;

    // Remove any existing recurring job for this channel
    await this.removeRecurringChannelPoll(channelId);

    // Add new recurring job
    await this.channelPollQueue.add(
      'poll-channel',
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
    const jobName = `poll-channel-${channelId}`;

    try {
      // Get the repeatable job
      const repeatableJobs = await this.channelPollQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find((job) => job.id === jobName);

      if (jobToRemove) {
        await this.channelPollQueue.removeRepeatableByKey(jobToRemove.key);
        console.log(`✅ Removed recurring job for channel ${channelId}`);
      }
    } catch (error) {
      console.warn(
        `⚠️ Could not remove recurring job for channel ${channelId}: ${error.message}`,
      );
    }
  }

  async scheduleChannelPollTask(channelId: string): Promise<void> {
    // This method is deprecated, replaced with scheduleRecurringChannelPoll
    // Schedule an immediate job to start polling the channel
    await this.channelPollQueue.add('poll-channel', { channelId });
    console.log(
      `✅ Scheduled immediate channel poll task for channel: ${channelId}`,
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
    const job = await this.channelPollQueue.add(
      'poll-channel',
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
      `✅ Manually triggered poll for channel ${channelId}, Job ID: ${job.id}`,
    );
  }
}
