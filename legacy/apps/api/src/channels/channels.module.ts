import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { Channel, ChannelSchema } from '../schemas/channel.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Channel.name, schema: ChannelSchema }]),
    BullModule.registerQueue({ name: 'channel-monitoring' }), // Updated queue name
    BullModule.registerQueue({ name: 'performance-tracking' }), // New queue for performance tracking
  ],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService], // Export service in case other modules need it
})
export class ChannelsModule {}
