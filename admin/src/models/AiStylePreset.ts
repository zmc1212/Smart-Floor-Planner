import mongoose, { Document, Model, Schema } from 'mongoose';
import type { AiPresetType } from '@/lib/ai/preset-definitions';

export interface IAiStylePreset extends Document {
  key: string;
  type: AiPresetType;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  mockImageUrl?: string;
  promptTemplate: string;
  negativePrompt: string;
  provider: 'pollinations';
  image: {
    model: string;
    size: string;
    quality: 'standard' | 'hd' | 'low' | 'medium' | 'high';
    mode: 'generation' | 'edit';
  };
  enabled: boolean;
  sortOrder: number;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiStylePresetSchema = new Schema<IAiStylePreset>(
  {
    key: { type: String, required: true, trim: true },
    type: { type: String, enum: ['floor_plan_style', 'furnishing_style'], required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '' },
    previewClassName: { type: String, default: '' },
    mockImageUrl: { type: String, default: '' },
    promptTemplate: { type: String, required: true },
    negativePrompt: { type: String, default: '' },
    provider: { type: String, enum: ['pollinations'], default: 'pollinations' },
    image: {
      model: { type: String, required: true },
      size: { type: String, default: '1024x1024' },
      quality: { type: String, enum: ['standard', 'hd', 'low', 'medium', 'high'], default: 'medium' },
      mode: { type: String, enum: ['generation', 'edit'], default: 'edit' },
    },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

AiStylePresetSchema.index({ type: 1, enabled: 1, sortOrder: 1 });
AiStylePresetSchema.index({ type: 1, key: 1 }, { unique: true });

export const AiStylePreset: Model<IAiStylePreset> =
  mongoose.models.AiStylePreset || mongoose.model<IAiStylePreset>('AiStylePreset', AiStylePresetSchema);
