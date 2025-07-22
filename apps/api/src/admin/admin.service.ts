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
    @InjectQueue('channel-poll') private channelPollQueue: Queue,
  ) {}

  // ============== DASHBOARD ==============
  async getDashboardStats() {
    const [channelCount, contentCount, promptCount] = await Promise.all([
      this.channelModel.countDocuments(),
      this.contentModel.countDocuments(),
      this.promptModel.countDocuments(),
    ]);

    return {
      channelCount,
      contentCount,
      promptCount,
    };
  }

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
      console.log(`✅ [Admin] Scheduled recurring channel poll task for: ${channel.name} (${channel.cronPattern})`);
    }

    return channel;
  }

  async updateChannel(id: string, updateData: Partial<CreateChannelDto>) {
    const currentChannel = await this.channelModel.findById(id).exec();
    if (!currentChannel) {
      throw new Error(`Channel with id ${id} not found`);
    }

    const updatedChannel = await this.channelModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).exec();

    // If cronPattern was updated and it's a YouTube channel, reschedule the job
    if (updateData.cronPattern && currentChannel.sourceType === 'YOUTUBE' && 
        updateData.cronPattern !== currentChannel.cronPattern) {
      await this.scheduleRecurringChannelPoll(id, updateData.cronPattern);
      console.log(`✅ [Admin] Updated recurring job for channel: ${updatedChannel.name} (${updateData.cronPattern})`);
    }

    return updatedChannel;
  }

  async deleteChannel(id: string) {
    const channel = await this.channelModel.findById(id).exec();
    if (channel && channel.sourceType === 'YOUTUBE') {
      // Remove recurring job before deleting the channel
      await this.removeRecurringChannelPoll(id);
      console.log(`✅ [Admin] Removed recurring job for deleted channel: ${channel.name}`);
    }
    
    return this.channelModel.findByIdAndDelete(id).exec();
  }

  // ============== CONTENTS ==============
  async getAllContents() {
    return this.contentModel.find().populate('channelId').sort({ createdAt: -1 }).exec();
  }

  async getContentById(id: string) {
    return this.contentModel.findById(id).populate('channelId').exec();
  }

  async createContent(createContentDto: CreateContentDto) {
    const content = new this.contentModel(createContentDto);
    return content.save();
  }

  async updateContent(id: string, updateData: Partial<CreateContentDto>) {
    return this.contentModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).exec();
  }

  async deleteContent(id: string) {
    return this.contentModel.findByIdAndDelete(id).exec();
  }

  // ============== PROMPTS ==============
  async getAllPrompts() {
    return this.promptModel.find().sort({ createdAt: -1 }).exec();
  }

  async getPromptById(id: string) {
    return this.promptModel.findById(id).exec();
  }

  async createPrompt(createPromptDto: CreatePromptDto) {
    const prompt = new this.promptModel(createPromptDto);
    return prompt.save();
  }

  async updatePrompt(id: string, updateData: Partial<CreatePromptDto>) {
    return this.promptModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).exec();
  }

  async deletePrompt(id: string) {
    return this.promptModel.findByIdAndDelete(id).exec();
  }

  // ============== RECURRING JOB MANAGEMENT ==============
  async scheduleRecurringChannelPoll(channelId: string, cronPattern: string) {
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
      }
    );
    
    console.log(`✅ Scheduled recurring job for channel ${channelId} with pattern: ${cronPattern}`);
  }

  async removeRecurringChannelPoll(channelId: string) {
    const jobName = `poll-channel-${channelId}`;
    
    try {
      // Get the repeatable job
      const repeatableJobs = await this.channelPollQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(job => job.id === jobName);
      
      if (jobToRemove) {
        await this.channelPollQueue.removeRepeatableByKey(jobToRemove.key);
        console.log(`✅ Removed recurring job for channel ${channelId}`);
      }
    } catch (error) {
      console.warn(`⚠️ Could not remove recurring job for channel ${channelId}: ${error.message}`);
    }
  }

  async updateChannelCronPattern(channelId: string, newCronPattern: string) {
    const channel = await this.channelModel.findById(channelId).exec();
    if (!channel) {
      throw new Error(`Channel with id ${channelId} not found`);
    }

    // Update the database
    await this.channelModel.findByIdAndUpdate(
      channelId,
      { cronPattern: newCronPattern },
      { new: true, runValidators: true }
    ).exec();

    // Reschedule the recurring job if it's a YouTube channel
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleRecurringChannelPoll(channelId, newCronPattern);
      console.log(`✅ Updated recurring job for channel ${channelId} with new pattern: ${newCronPattern}`);
    }
  }

  async startAllChannelPolling() {
    const channels = await this.channelModel.find({ sourceType: 'YOUTUBE' }).exec();
    
    for (const channel of channels) {
      await this.scheduleRecurringChannelPoll(channel.id, channel.cronPattern);
    }
    
    console.log(`✅ Started recurring polling for ${channels.length} YouTube channels`);
    return { scheduledChannels: channels.length };
  }

  async stopAllChannelPolling() {
    const channels = await this.channelModel.find({ sourceType: 'YOUTUBE' }).exec();
    
    for (const channel of channels) {
      await this.removeRecurringChannelPoll(channel.id);
    }
    
    console.log(`✅ Stopped recurring polling for ${channels.length} YouTube channels`);
    return { stoppedChannels: channels.length };
  }

  async triggerManualChannelPoll(channelId: string) {
    await this.channelPollQueue.add('poll-channel', { channelId });
    console.log(`✅ Manually triggered poll for channel: ${channelId}`);
  }
} 