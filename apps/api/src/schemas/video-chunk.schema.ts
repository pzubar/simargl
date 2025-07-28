import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { VideoAnalysisResponse } from './video-analysis-response.schema';

@Schema({
  timestamps: true,
  collection: 'video_chunks',
})
export class VideoChunk extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Content', index: true, required: true })
  contentId: Types.ObjectId; // Reference to the parent content

  @Prop({ required: true })
  chunkIndex: number;

  @Prop({ required: true })
  startTime: number; // in seconds

  @Prop({ required: true })
  endTime: number; // in seconds

  @Prop({ required: true })
  duration: number; // in seconds

  @Prop({
    required: true,
    enum: ['PENDING', 'PROCESSING', 'ANALYZED', 'FAILED', 'OVERLOADED'],
    default: 'PENDING',
  })
  status: string;

  @Prop({ type: Object }) // Raw analysis result from Gemini for this chunk
  analysisResult?: VideoAnalysisResponse;

  @Prop()
  modelUsed?: string; // Model used for this specific chunk

  @Prop()
  processingTime?: number; // Time taken to analyze this chunk

  @Prop()
  error?: string; // Error message if analysis failed

  @Prop({ default: false })
  isCombined?: boolean; // Mark if this chunk's analysis has been combined

  @Prop({ type: Types.ObjectId, ref: 'Prompt' })
  promptIdUsed?: Types.ObjectId; // Prompt version used for this chunk

  @Prop()
  promptVersionUsed?: number; // Prompt version used for this chunk

  @Prop({ type: Date })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const VideoChunkSchema = SchemaFactory.createForClass(VideoChunk);
