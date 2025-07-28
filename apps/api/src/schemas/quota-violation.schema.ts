import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'quota_violations',
})
export class QuotaViolation extends Document {
  @Prop({ required: true, index: true })
  modelName: string;

  @Prop({ type: Object, required: true })
  error: any; // Raw error object from Gemini API

  @Prop()
  quotaMetric?: string; // e.g., "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count"

  @Prop({ index: true })
  quotaId?: string; // e.g., "GenerateContentInputTokensPerModelPerDay-FreeTier" or "GenerateContentInputTokensPerModelPerMinute-FreeTier"

  @Prop()
  quotaValue?: string; // Current quota value

  @Prop()
  retryDelay?: string; // e.g., "56s" - from Google's retry info

  @Prop()
  retryDelaySeconds?: number; // Parsed retry delay in seconds

  @Prop({ index: true })
  quotaType?: string; // "RPM", "RPD", "TPM" - parsed from quotaId

  @Prop({ index: true })
  tier?: string; // "FreeTier", "Tier1", etc. - parsed from quotaId

  @Prop({ default: false, index: true })
  isRpmViolation: boolean; // Quick lookup for RPM violations

  @Prop({ default: false, index: true })
  isRpdViolation: boolean; // Quick lookup for RPD violations

  @Prop({ default: false, index: true })
  isTpmViolation: boolean; // Quick lookup for TPM violations

  @Prop({ type: Date, default: Date.now, expires: 604800 }) // Auto-delete after 7 days
  expiresAt: Date;

  @Prop({ type: Date })
  createdAt: Date;

  @Prop({ type: Date })
  updatedAt: Date;
}

export const QuotaViolationSchema = SchemaFactory.createForClass(QuotaViolation);

// Indexes for efficient querying
QuotaViolationSchema.index({ modelName: 1, createdAt: -1 });
QuotaViolationSchema.index({ quotaType: 1, createdAt: -1 });
QuotaViolationSchema.index({ isRpmViolation: 1, createdAt: -1 });
QuotaViolationSchema.index({ isRpdViolation: 1, createdAt: -1 }); 