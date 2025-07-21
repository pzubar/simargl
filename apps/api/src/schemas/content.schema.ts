import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';  
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class Analysis {  
  @Prop()  
  promptVersion: number;

  @Prop()  
  promptName: string;

  @Prop({ type: Object })  
  result: Record<string, any>;  
}

export const AnalysisSchema = SchemaFactory.createForClass(Analysis);

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

  @Prop({ required: true, enum: ['PENDING', 'PROCESSING', 'ANALYZED', 'FAILED'] })  
  status: string;

  @Prop({ type: Object })  
  data: {  
    transcript?: string;  
    text?: string;  
  };

  @Prop({ type: AnalysisSchema })  
  analysis?: Analysis;

  @Prop({ type: [StatisticsSchema], default: [] })  
  statistics: Statistics[];  
}

export const ContentSchema = SchemaFactory.createForClass(Content);