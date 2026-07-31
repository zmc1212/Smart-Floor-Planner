import mongoose, { Document, Model, Schema } from 'mongoose';
import type { AiLogicalModelKey } from '@/lib/ai/provider-types';
import type { GrsImageModelFamily, GrsResolutionTier } from '@/lib/ai/grs-image-models';

export interface IAiCreationModelProfile extends Document {
  key: string;
  name: string;
  description?: string;
  sourceModelSourceIds: string[];
  sourceType: 'grs_catalog' | 'roomi_legacy';
  adapterType?: 'grs';
  remoteModel?: string;
  family?: GrsImageModelFamily;
  catalogVersion?: string;
  generateLogicalModelKey: AiLogicalModelKey;
  editLogicalModelKey?: AiLogicalModelKey;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
  sizes: string[];
  qualities: string[];
  resolutionTiers: GrsResolutionTier[];
  supportsCustomSize: boolean;
  defaultAspectRatio: string;
  defaultSize: string;
  defaultQuality: string;
  defaultResolutionTier: GrsResolutionTier;
  isDefault: boolean;
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
    sourceType: { type: String, enum: ['grs_catalog', 'roomi_legacy'], default: 'roomi_legacy', index: true },
    adapterType: { type: String, enum: ['grs'] },
    remoteModel: { type: String, trim: true },
    family: { type: String, enum: ['gpt-image-2', 'gpt-image-2-vip', 'nano-banana', 'nano-banana-2'] },
    catalogVersion: { type: String, trim: true },
    generateLogicalModelKey: { type: String, enum: ['image.generate.standard'], required: true },
    editLogicalModelKey: { type: String, enum: ['image.edit.standard'] },
    supportsReferenceImages: { type: Boolean, default: true },
    maxReferenceImages: { type: Number, default: 6, min: 0, max: 10 },
    aspectRatios: { type: [String], default: ['1:1', '4:3', '3:4', '16:9', '9:16'] },
    sizes: { type: [String], default: ['1K', '2K'] },
    qualities: { type: [String], default: ['auto', 'high', 'medium', 'low'] },
    resolutionTiers: { type: [String], enum: ['1K', '2K', '4K', 'CUSTOM'], default: ['1K'] },
    supportsCustomSize: { type: Boolean, default: false },
    defaultAspectRatio: { type: String, default: '1:1' },
    defaultSize: { type: String, default: '1K' },
    defaultQuality: { type: String, default: 'auto' },
    defaultResolutionTier: { type: String, enum: ['1K', '2K', '4K', 'CUSTOM'], default: '1K' },
    isDefault: { type: Boolean, default: false, index: true },
    enabled: { type: Boolean, default: true, index: true },
    weight: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AiCreationModelProfileSchema.index({ enabled: 1, weight: -1, name: 1 });
AiCreationModelProfileSchema.index({ sourceModelSourceIds: 1 });
AiCreationModelProfileSchema.index(
  { adapterType: 1, remoteModel: 1 },
  { unique: true, partialFilterExpression: { remoteModel: { $type: 'string' } } }
);

export const AiCreationModelProfile: Model<IAiCreationModelProfile> =
  (mongoose.models.AiCreationModelProfile as Model<IAiCreationModelProfile> | undefined) ||
  mongoose.model<IAiCreationModelProfile>('AiCreationModelProfile', AiCreationModelProfileSchema);
