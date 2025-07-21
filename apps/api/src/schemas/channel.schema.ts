import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';  
import { Document } from 'mongoose';

@Schema({ timestamps: true })  
export class Channel extends Document {  
  @Prop({ required: true, enum: ['YOUTUBE', 'TELEGRAM', 'TIKTOK'] })  
  sourceType: string;

  @Prop({ required: true, unique: true })  
  sourceId: string;

  @Prop({ required: true })  
  name: string;

  @Prop({ default: 10 })  
  fetchLastN: number;

  @Prop({ default: '0 */6 * * *' })  
  cronPattern: string;

  @Prop()  
  authorContext?: string;

  @Prop({ type: Object })  
  metadata?: Record<string, any>;  
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);