import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ 
  timestamps: true,
  collection: 'research_results'
})
export class ResearchResult extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Content', required: true, index: true })
  contentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Prompt', required: true, index: true })
  promptId: Types.ObjectId;

  @Prop({ 
    type: String, 
    enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'], 
    default: 'QUEUED',
    index: true 
  })
  status: string;

  @Prop({ type: Object }) // The actual research result/answer
  result?: any;

  @Prop({ type: String }) // Model used for processing
  modelUsed?: string;

  @Prop({ type: Number }) // Tokens consumed
  tokensUsed?: number;

  @Prop({ type: Date }) // When job was queued
  queuedAt?: Date;

  @Prop({ type: Date }) // When processing completed
  processedAt?: Date;

  @Prop({ type: Date }) // When processing failed
  failedAt?: Date;

  @Prop({ type: String }) // Error message if failed
  error?: string;

  @Prop({ type: Date })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const ResearchResultSchema = SchemaFactory.createForClass(ResearchResult);

// Compound index for efficient video-prompt lookups
ResearchResultSchema.index({ contentId: 1, promptId: 1 }, { unique: true });

// Performance indexes
ResearchResultSchema.index({ status: 1 });
ResearchResultSchema.index({ contentId: 1, status: 1 });
ResearchResultSchema.index({ promptId: 1, status: 1 });