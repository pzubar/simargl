import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Type } from '@google/genai';

export enum PromptType {
  INSIGHT_GATHERING = 'insight_gathering', // For extracting insights from video segments
  RESEARCH_QUESTION = 'research_question', // For answering specific research questions
}

// Valid schema types based on @google/genai Type enum
const VALID_SCHEMA_TYPES = [
  Type.STRING,
  Type.NUMBER,
  Type.BOOLEAN,
  Type.OBJECT,
  Type.ARRAY,
];

// Validation function for responseSchema
export function validateResponseSchema(schema: any): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  // Check if schema has a valid type
  if (!schema.type || !VALID_SCHEMA_TYPES.includes(schema.type)) {
    return false;
  }

  // Validate OBJECT type properties
  if (schema.type === Type.OBJECT) {
    if (schema.properties && typeof schema.properties === 'object') {
      // Recursively validate each property
      for (const propKey in schema.properties) {
        if (!validateResponseSchema(schema.properties[propKey])) {
          return false;
        }
      }
    }
    // propertyOrdering should be an array of strings if present
    if (schema.propertyOrdering && !Array.isArray(schema.propertyOrdering)) {
      return false;
    }
  }

  // Validate ARRAY type items
  if (schema.type === Type.ARRAY) {
    if (schema.items && !validateResponseSchema(schema.items)) {
      return false;
    }
  }

  return true;
}

@Schema({ timestamps: true })
export class Prompt extends Document {
  @Prop({ required: true, unique: false })
  promptName: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  promptTemplate: string;

  @Prop({
    required: true,
    enum: Object.values(PromptType),
    type: String,
  })
  promptType: PromptType;

  @Prop({ default: false })
  isActive: boolean; // Renamed from isDefault for clarity

  @Prop()
  description?: string;

  @Prop({
    type: Object,
    validate: {
      validator: function (value: any) {
        // Allow null/undefined (optional field)
        if (!value) return true;
        return validateResponseSchema(value);
      },
      message:
        'responseSchema must follow @google/genai schema format with valid Type values',
    },
  })
  responseSchema?: any; // Optional structured output schema for Gemini API

  @Prop({
    enum: ['application/json', 'text/plain'],
    validate: {
      validator: function (value: any) {
        // responseMimeType can only be set if responseSchema is also set
        if (value && !this.responseSchema) {
          return false;
        }
        return true;
      },
      message:
        'responseMimeType can only be set when responseSchema is provided',
    },
  })
  responseMimeType?: string; // MIME type for response (only when responseSchema is set)
}

export const PromptSchema = SchemaFactory.createForClass(Prompt);
PromptSchema.index({ promptName: 1, version: 1 }, { unique: true });

// Pre-save middleware to handle responseMimeType logic
PromptSchema.pre('save', function () {
  // If responseSchema is set but responseMimeType is not, default to 'application/json'
  if (this.responseSchema && !this.responseMimeType) {
    this.responseMimeType = 'application/json';
  }

  // If responseSchema is not set, clear responseMimeType
  if (!this.responseSchema) {
    this.responseMimeType = undefined;
  }
});
