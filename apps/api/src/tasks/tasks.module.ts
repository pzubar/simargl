import { Module } from '@nestjs/common';  
import { BullModule } from '@nestjs/bullmq';  
import { MongooseModule } from '@nestjs/mongoose';

// Import Schemas for local registration
import { Channel, ChannelSchema } from '../schemas/channel.schema';  
import { Content, ContentSchema } from '../schemas/content.schema';  
import { Prompt, PromptSchema } from '../schemas/prompt.schema';

// Import Processors  
import { ChannelPollProcessor } from './channel-poll.processor';  
import { ContentProcessingProcessor } from './content-processing.processor';  
import { MetadataProcessingProcessor } from './metadata-processing.processor';
import { AnalysisProcessor } from './analysis.processor';  
import { StatsProcessor } from './stats.processor';

// Import Services
import { VideoAnalysisService } from '../services/video-analysis.service';
import { QuotaManagerService } from '../services/quota-manager.service';

@Module({  
  imports: [  
    // Local model registration for processors to inject
    MongooseModule.forFeature([  
      { name: Channel.name, schema: ChannelSchema },  
      { name: Content.name, schema: ContentSchema },  
      { name: Prompt.name, schema: PromptSchema },  
    ]),
    BullModule.registerQueue(  
      { name: 'channel-poll' },  
      { name: 'content-processing' },  
      { name: 'metadata-processing' },
      { name: 'analysis' },  
      { name: 'stats' },  
    ),  
  ],  
  providers: [  
    ChannelPollProcessor,  
    ContentProcessingProcessor,  
    MetadataProcessingProcessor,
    AnalysisProcessor,  
    StatsProcessor,
    VideoAnalysisService,
    QuotaManagerService,
  ],  
})  
export class TasksModule {}