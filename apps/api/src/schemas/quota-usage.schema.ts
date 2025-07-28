import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'quota_usage',
})
export class QuotaUsage extends Document {
  @Prop({ required: true, index: true })
  modelName: string;

  @Prop({ required: true, index: true })
  timeWindow: string; // Format: 'YYYY-MM-DD-HH-mm' for minute-level tracking

  @Prop({ required: true, index: true })
  day: string; // Format: 'YYYY-MM-DD' for day-level tracking

  @Prop({ default: 0 })
  requestsInCurrentMinute: number;

  @Prop({ default: 0 })
  tokensInCurrentMinute: number;

  @Prop({ default: 0 })
  requestsToday: number;

  @Prop({ type: Date, default: Date.now, expires: 86400 }) // Auto-delete after 24 hours
  expiresAt: Date;

  @Prop({ type: Date })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const QuotaUsageSchema = SchemaFactory.createForClass(QuotaUsage);

// Compound indexes for efficient querying
QuotaUsageSchema.index({ modelName: 1, timeWindow: 1 }, { unique: true });
QuotaUsageSchema.index({ modelName: 1, day: 1 }); 