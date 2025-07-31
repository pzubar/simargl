import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { TasksModule } from './tasks/tasks.module';
import { ChannelsModule } from './channels/channels.module';
import { AdminModule } from './admin/admin.module';
import { ApiController, RootController } from './api.controller';
import { ApiService } from './api.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from './services/enhanced-quota-manager.service';
import { VideoCombinationService } from './services/video-combination.service';

// Import Schemas for global registration
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { Content, ContentSchema } from './schemas/content.schema';
import { Prompt, PromptSchema } from './schemas/prompt.schema';
import { VideoChunk, VideoChunkSchema } from './schemas/video-chunk.schema';
import { QuotaUsage, QuotaUsageSchema } from './schemas/quota-usage.schema';
import {
  QuotaViolation,
  QuotaViolationSchema,
} from './schemas/quota-violation.schema';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { VideoAnalysisService } from './services/video-analysis.service';
import { BullMQRateLimitService } from './services/bullmq-rate-limit.service';

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
      { name: VideoChunk.name, schema: VideoChunkSchema },
      { name: QuotaUsage.name, schema: QuotaUsageSchema },
      { name: QuotaViolation.name, schema: QuotaViolationSchema },
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
      { name: 'metadata-processing' },
      { name: 'analysis' },
      { name: 'chunk-analysis' },
      { name: 'stats' },
      { name: 'combination' },
      { name: 'quota-cleanup' },
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
      name: 'metadata-processing',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'analysis',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'chunk-analysis',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'stats',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'combination',
      adapter: BullMQAdapter,
    }),

    // Feature Modules
    ChannelsModule,
    AdminModule,
    TasksModule,
  ],
  controllers: [ApiController, RootController],
  providers: [
    ApiService,
    QuotaManagerService,
    VideoAnalysisService,
    VideoCombinationService,
    BullMQRateLimitService,
  ],
})
export class AppModule {}
