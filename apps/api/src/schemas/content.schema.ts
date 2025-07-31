import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class Analysis {
  @Prop()
  promptVersion: number;

  @Prop()
  promptName: string;

  @Prop()
  promptId: string;

  @Prop()
  modelUsed?: string; // Track which Gemini model was used for analysis

  @Prop({ type: Object })
  result: Record<string, any>;
}

export const AnalysisSchema = SchemaFactory.createForClass(Analysis);

@Schema({ _id: false })
export class VideoMetadata {
  @Prop()
  duration: number; // in seconds

  @Prop()
  viewCount: number;

  @Prop()
  channel: string;

  @Prop()
  thumbnailUrl: string;

  @Prop()
  webpageUrl: string;

  @Prop()
  fetchedAt: Date;

  @Prop()
  lastUpdatedAt: Date;

  @Prop()
  expectedChunks?: number; // Number of chunks expected for complete analysis
}

export const VideoMetadataSchema = SchemaFactory.createForClass(VideoMetadata);

@Schema({ _id: false })
export class Statistics {
  @Prop()
  fetchDate: Date;

  @Prop()
  viewCount: number;

  @Prop()
  likeCount: number;

  @Prop()
  commentCount: number;
}

export const StatisticsSchema = SchemaFactory.createForClass(Statistics);

@Schema({ timestamps: true })
export class Content extends Document {
  @Prop({ required: true, unique: true })
  sourceContentId: string;

  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true })
  channelId: Types.ObjectId;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop()
  publishedAt: Date;

  @Prop({
    required: true,
    enum: [
      'DISCOVERED', // Video found but not yet initialized
      'INITIALIZING', // Setting up video for insight gathering
      'METADATA_READY', // Ready for insight extraction
      'INSIGHTS_QUEUED', // Insight gathering jobs scheduled
      'INSIGHTS_GATHERED', // All insights extracted - ready for research prompts
      'FAILED', // Processing failed
    ],
    default: 'DISCOVERED',
  })
  status: string;

  @Prop({ type: Object })
  data: {
    transcript?: string;
    text?: string;
  };

  @Prop({ type: VideoMetadataSchema })
  metadata?: VideoMetadata;

  @Prop({ type: AnalysisSchema })
  analysis?: Analysis;

  @Prop({ type: [StatisticsSchema], default: [] })
  statistics: Statistics[];

  // Business workflow tracking timestamps
  @Prop({ type: Date })
  discoveredAt?: Date; // When video was first discovered

  @Prop({ type: Date })
  metadataGatheredAt?: Date; // When metadata was successfully gathered

  @Prop({ type: Date })
  insightJobsQueuedAt?: Date; // When insight gathering jobs were queued

  @Prop({ type: Date })
  insightsGatheredAt?: Date; // When all insights were gathered
}

export const ContentSchema = SchemaFactory.createForClass(Content);
