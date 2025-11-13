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
import { ResearchService } from './services/research.service';

// Import Schemas for global registration
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { Content, ContentSchema } from './schemas/content.schema';
import { Prompt, PromptSchema } from './schemas/prompt.schema';
import {
  VideoInsight,
  VideoInsightSchema,
} from './schemas/video-insight.schema';
import {
  ResearchResult,
  ResearchResultSchema,
} from './schemas/research-result.schema';
import { QuotaUsage, QuotaUsageSchema } from './schemas/quota-usage.schema';
import {
  QuotaViolation,
  QuotaViolationSchema,
} from './schemas/quota-violation.schema';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { VideoInsightService } from './services/video-insight.service';
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
      { name: VideoInsight.name, schema: VideoInsightSchema },
      { name: ResearchResult.name, schema: ResearchResultSchema },
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

    // Register queues for services and controllers used in AppModule
    BullModule.registerQueue({ name: 'quota-cleanup' }),
    BullModule.registerQueue({ name: 'video-metadata' }),
    BullModule.registerQueue({ name: 'insight-gathering' }),
    BullModule.registerQueue({ name: 'research-processing' }),
    BullModule.registerQueue({ name: 'video-discovery' }),
    BullModule.registerQueue({ name: 'channel-monitoring' }),

    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'channel-monitoring',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'video-discovery',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'video-metadata',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'insight-gathering',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'performance-tracking',
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: 'research-processing',
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
    VideoInsightService,
    ResearchService,
    BullMQRateLimitService,
  ],
})
export class AppModule {}
