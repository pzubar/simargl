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

    // Schedule polling task for YouTube channels
    if (channel.sourceType === 'YOUTUBE') {
      await this.channelPollQueue.add('poll-channel', { channelId: channel.id });
      console.log(`✅ [Admin] Scheduled channel poll task for: ${channel.name}`);
    }

    return channel;
  }

  async updateChannel(id: string, updateData: Partial<CreateChannelDto>) {
    return this.channelModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).exec();
  }

  async deleteChannel(id: string) {
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
} 