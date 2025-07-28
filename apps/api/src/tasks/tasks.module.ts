import { Module } from '@nestjs/common';  
import { BullModule } from '@nestjs/bullmq';  
import { MongooseModule } from '@nestjs/mongoose';

// Import Schemas for local registration
import { Channel, ChannelSchema } from '../schemas/channel.schema';  
import { Content, ContentSchema } from '../schemas/content.schema';  
import { Prompt, PromptSchema } from '../schemas/prompt.schema';
import { VideoChunk, VideoChunkSchema } from '../schemas/video-chunk.schema';
import { QuotaUsage, QuotaUsageSchema } from '../schemas/quota-usage.schema';
import { QuotaViolation, QuotaViolationSchema } from '../schemas/quota-violation.schema';

// Import Processors  
import { ChannelPollProcessor } from './channel-poll.processor';  
import { ContentProcessingProcessor } from './content-processing.processor';  
import { MetadataProcessingProcessor } from './metadata-processing.processor';
import { AnalysisProcessor } from './analysis.processor';  
import { ChunkAnalysisProcessor } from './chunk-analysis.processor';
import { StatsProcessor } from './stats.processor';

// Import Services
import { VideoAnalysisService } from '../services/video-analysis.service';
import { VideoCombinationService } from '../services/video-combination.service';
import { EnhancedQuotaManagerService as QuotaManagerService } from '../services/enhanced-quota-manager.service';

@Module({  
  imports: [  
    // Local model registration for processors to inject
    MongooseModule.forFeature([  
      { name: Channel.name, schema: ChannelSchema },  
      { name: Content.name, schema: ContentSchema },  
      { name: Prompt.name, schema: PromptSchema },
      { name: VideoChunk.name, schema: VideoChunkSchema },
      { name: QuotaUsage.name, schema: QuotaUsageSchema },
      { name: QuotaViolation.name, schema: QuotaViolationSchema },  
    ]),
    BullModule.registerQueue(
      { name: 'channel-poll' },
      { name: 'content-processing' },
      { name: 'metadata-processing' },
      { name: 'analysis' },
      { name: 'chunk-analysis' },
      { name: 'stats' },
    ),
  ],  
  providers: [  
    ChannelPollProcessor,  
    ContentProcessingProcessor,  
    MetadataProcessingProcessor,
    AnalysisProcessor,  
    ChunkAnalysisProcessor,
    StatsProcessor,
    VideoAnalysisService,
    VideoCombinationService,
    QuotaManagerService,
  ],  
})  
export class TasksModule {}