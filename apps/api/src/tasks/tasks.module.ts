import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';

// Import Schemas for local registration
import { Channel, ChannelSchema } from '../schemas/channel.schema';
import { Content, ContentSchema } from '../schemas/content.schema';
import { Prompt, PromptSchema } from '../schemas/prompt.schema';
import {
  VideoInsight,
  VideoInsightSchema,
} from '../schemas/video-insight.schema'; // Renamed from VideoChunk
import {
  ResearchResult,
  ResearchResultSchema,
} from '../schemas/research-result.schema'; // New model
import { QuotaUsage, QuotaUsageSchema } from '../schemas/quota-usage.schema';
import {
  QuotaViolation,
  QuotaViolationSchema,
} from '../schemas/quota-violation.schema';

// Import Business-Focused Processors
import { ChannelMonitoringProcessor } from './channel-monitoring.processor'; // Renamed from ChannelPollProcessor
import { VideoDiscoveryProcessor } from './video-discovery.processor'; // Renamed from ContentProcessingProcessor
import { VideoMetadataGatheringProcessor } from './video-metadata-gathering.processor'; // Renamed from MetadataProcessingProcessor
import { VideoReadinessProcessor } from './video-readiness.processor'; // NEW processor for decoupled scheduling
import { VideoInsightGatheringProcessor } from './video-insight-gathering.processor'; // Renamed from ChunkAnalysisProcessor
import { ResearchSchedulerProcessor } from './research-scheduler.processor'; // NEW processor for research scheduling
import { ResearchPromptProcessingProcessor } from './research-prompt-processing.processor'; // Renamed from CombinationProcessor
import { PerformanceTrackingProcessor } from './performance-tracking.processor'; // Renamed from StatsProcessor
import { QuotaCleanupProcessor } from './quota-cleanup.processor'; // No change

// Import Business-Focused Services
import { VideoInsightService } from '../services/video-insight.service'; // Renamed from VideoAnalysisService
import { ResearchService } from '../services/research.service'; // Renamed from VideoCombinationService
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';
import { BullMQRateLimitService } from '../services/bullmq-rate-limit.service';
import { ChannelsService } from '../channels/channels.service';

@Module({
  imports: [
    // Local model registration for processors to inject
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Content.name, schema: ContentSchema },
      { name: Prompt.name, schema: PromptSchema },
      { name: VideoInsight.name, schema: VideoInsightSchema }, // Renamed from VideoChunk
      { name: ResearchResult.name, schema: ResearchResultSchema }, // New model for research tracking
      { name: QuotaUsage.name, schema: QuotaUsageSchema },
      { name: QuotaViolation.name, schema: QuotaViolationSchema },
    ]),
    // Business-Focused Queue Registration
    BullModule.registerQueue(
      { name: 'channel-monitoring' }, // Renamed from 'channel-poll' - reflects business purpose
      { name: 'video-discovery' }, // Renamed from 'content-processing' - clearer business intent
      { name: 'video-metadata' }, // Renamed from 'metadata-processing' - specific business function
      { name: 'video-readiness' }, // NEW queue for decoupled insight scheduling
      { name: 'insight-gathering' }, // Renamed from 'chunk-analysis' - business-focused purpose
      { name: 'research-scheduling' }, // NEW queue for research prompt scheduling
      { name: 'research-processing' }, // Renamed from 'combination' - clear research focus
      { name: 'performance-tracking' }, // Renamed from 'stats' - business intelligence focus
      { name: 'quota-cleanup' }, // No change - already clear
    ),
  ],
  providers: [
    // Business-Focused Processors
    ChannelMonitoringProcessor, // Renamed from ChannelPollProcessor - business purpose
    VideoDiscoveryProcessor, // Renamed from ContentProcessingProcessor - clear intent
    VideoMetadataGatheringProcessor, // Renamed from MetadataProcessingProcessor - specific function
    VideoReadinessProcessor, // NEW processor for decoupled insight scheduling
    VideoInsightGatheringProcessor, // Renamed from ChunkAnalysisProcessor - business focus
    ResearchSchedulerProcessor, // NEW processor for research prompt scheduling
    ResearchPromptProcessingProcessor, // Renamed from CombinationProcessor - clear research purpose
    PerformanceTrackingProcessor, // Renamed from StatsProcessor - business intelligence
    QuotaCleanupProcessor, // No change - already clear

    // Business-Focused Services
    VideoInsightService, // Renamed from VideoAnalysisService - business purpose
    ResearchService, // Renamed from VideoCombinationService - clear research focus
    QuotaManagerService, // No change
    BullMQRateLimitService, // No change
    ChannelsService,
  ],
})
export class TasksModule {}
