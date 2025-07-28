import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Prompt extends Document {
  @Prop({ required: true, unique: false })
  promptName: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  promptTemplate: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop()
  description?: string;
}

export const PromptSchema = SchemaFactory.createForClass(Prompt);
PromptSchema.index({ promptName: 1, version: 1 }, { unique: true });
