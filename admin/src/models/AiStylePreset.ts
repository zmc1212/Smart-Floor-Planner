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
  provider: 'tensor';
  tensor: {
    modelKey: string;
    modelId: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    scheduler?: string;
    guidance?: number;
    clipSkip?: number;
    denoisingStrength?: number;
    vae?: string;
    controlnet?: {
      enabled: boolean;
      preprocessor: string;
      model: string;
      weight: number;
      guidanceStart?: number;
      guidanceEnd?: number;
    };
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
    provider: { type: String, enum: ['tensor'], default: 'tensor' },
    tensor: {
      modelKey: { type: String, required: true },
      modelId: { type: String, required: true },
      width: { type: Number, default: 640 },
      height: { type: Number, default: 640 },
      steps: { type: Number, default: 20 },
      cfgScale: { type: Number, default: 7 },
      sampler: { type: String, default: 'Euler' },
      scheduler: { type: String },
      guidance: { type: Number },
      clipSkip: { type: Number },
      denoisingStrength: { type: Number },
      vae: { type: String },
      controlnet: {
        enabled: { type: Boolean, default: true },
        preprocessor: { type: String, default: 'canny' },
        model: { type: String, default: 'control_v11p_sd15_canny' },
        weight: { type: Number, default: 1 },
        guidanceStart: { type: Number, default: 0 },
        guidanceEnd: { type: Number, default: 1 },
      },
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
