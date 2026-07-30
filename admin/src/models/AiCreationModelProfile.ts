import mongoose, { Document, Model, Schema } from 'mongoose';
import type { AiLogicalModelKey } from '@/lib/ai/provider-types';

export interface IAiCreationModelProfile extends Document {
  key: string;
  name: string;
  description?: string;
  sourceModelSourceIds: string[];
  generateLogicalModelKey: AiLogicalModelKey;
  editLogicalModelKey?: AiLogicalModelKey;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
  sizes: string[];
  qualities: string[];
  defaultAspectRatio: string;
  defaultSize: string;
  defaultQuality: string;
  enabled: boolean;
  weight: number;
  createdAt: Date;
  updatedAt: Date;
}

const AiCreationModelProfileSchema = new Schema<IAiCreationModelProfile>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    sourceModelSourceIds: { type: [String], default: [] },
    generateLogicalModelKey: { type: String, enum: ['image.generate.standard'], required: true },
    editLogicalModelKey: { type: String, enum: ['image.edit.standard'] },
    supportsReferenceImages: { type: Boolean, default: true },
    maxReferenceImages: { type: Number, default: 6, min: 0, max: 10 },
    aspectRatios: { type: [String], default: ['1:1', '4:3', '3:4', '16:9', '9:16'] },
    sizes: { type: [String], default: ['1K', '2K'] },
    qualities: { type: [String], default: ['auto', 'high', 'medium', 'low'] },
    defaultAspectRatio: { type: String, default: '1:1' },
    defaultSize: { type: String, default: '1K' },
    defaultQuality: { type: String, default: 'auto' },
    enabled: { type: Boolean, default: true, index: true },
    weight: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AiCreationModelProfileSchema.index({ enabled: 1, weight: -1, name: 1 });
AiCreationModelProfileSchema.index({ sourceModelSourceIds: 1 });

export const AiCreationModelProfile: Model<IAiCreationModelProfile> =
  (mongoose.models.AiCreationModelProfile as Model<IAiCreationModelProfile> | undefined) ||
  mongoose.model<IAiCreationModelProfile>('AiCreationModelProfile', AiCreationModelProfileSchema);
