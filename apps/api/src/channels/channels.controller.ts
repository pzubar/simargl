import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ChannelsService, CreateChannelDto } from './channels.service';
import { Channel } from '../schemas/channel.schema';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createChannel(@Body() createChannelDto: CreateChannelDto): Promise<Channel> {
    try {
      return await this.channelsService.createChannel(createChannelDto);
    } catch (error) {
      throw new HttpException('Failed to create channel', HttpStatus.BAD_REQUEST);
    }
  }

  @Get()
  async getAllChannels(): Promise<Channel[]> {
    return this.channelsService.getAllChannels();
  }

  @Get(':id')
  async getChannelById(@Param('id') id: string): Promise<Channel | null> {
    return this.channelsService.getChannelById(id);
  }

  @Put(':id')
  async updateChannel(
    @Param('id') id: string,
    @Body() updateData: Partial<CreateChannelDto>
  ): Promise<Channel> {
    return this.channelsService.updateChannel(id, updateData);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteChannel(@Param('id') id: string): Promise<void> {
    await this.channelsService.deleteChannel(id);
  }
} 