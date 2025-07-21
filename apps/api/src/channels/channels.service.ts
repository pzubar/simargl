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

    // If it's a YouTube channel, schedule the channel poll task
    if (channel.sourceType === 'YOUTUBE') {
      await this.scheduleChannelPollTask(channel.id);
    }

    return channel;
  }

  async scheduleChannelPollTask(channelId: string): Promise<void> {
    // Schedule an immediate job to start polling the channel
    await this.channelPollQueue.add('poll-channel', { channelId });
    console.log(`✅ Scheduled channel poll task for channel: ${channelId}`);
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
    const result = await this.channelModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }
    console.log(`✅ Deleted channel: ${id}`);
  }

  async updateChannel(id: string, updateData: Partial<CreateChannelDto>): Promise<Channel> {
    const channel = await this.channelModel.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    ).exec();
    
    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    return channel;
  }
} 