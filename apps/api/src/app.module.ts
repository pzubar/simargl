import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { TasksModule } from './tasks/tasks.module';
import { ChannelsModule } from './channels/channels.module';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';

// Import Schemas for global registration
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { Content, ContentSchema } from './schemas/content.schema';
import { Prompt, PromptSchema } from './schemas/prompt.schema';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    // Configuration Module
    ConfigModule.forRoot({ isGlobal: true }),

    // Database Module (Mongoose)
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),

    // Global Model Registration (for AdminJS access)
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Content.name, schema: ContentSchema },
      { name: Prompt.name, schema: PromptSchema },
    ]),

    // Queue Module (BullMQ)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
      }),
      inject: [ConfigService],
    }),

    // Register all queues for API service and Bull Board monitoring
    BullModule.registerQueue(
      { name: 'channel-poll' },
      { name: 'content-processing' },
      { name: 'analysis' },
      { name: 'stats' },
    ),

    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'channel-poll',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'content-processing',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'analysis',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'stats',
      adapter: BullMQAdapter,
    }),

    // Feature Modules
    ChannelsModule,
    TasksModule,
  ],
  controllers: [ApiController],
  providers: [ApiService],
})
export class AppModule {}
