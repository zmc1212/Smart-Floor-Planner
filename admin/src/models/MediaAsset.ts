import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export type MediaAssetStorageProvider = 'local' | 'object_storage';

export interface IMediaAsset extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  ownerType: 'ai_workflow_source' | 'ai_generation_output' | 'ai_generation_input' | 'manual_upload';
  ownerId?: mongoose.Types.ObjectId;
  mimeType: string;
  size: number;
  storageProvider: MediaAssetStorageProvider;
  storageKey: string;
  originalUrl?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MediaAssetSchema: Schema<IMediaAsset> = new Schema(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
      index: true,
    },
    ownerType: {
      type: String,
      enum: ['ai_workflow_source', 'ai_generation_output', 'ai_generation_input', 'manual_upload'],
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    storageProvider: {
      type: String,
      enum: ['local', 'object_storage'],
      default: 'local',
      required: true,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
    },
    originalUrl: {
      type: String,
    },
    deletedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

MediaAssetSchema.index({ enterpriseId: 1, ownerType: 1, ownerId: 1, createdAt: -1 });

MediaAssetSchema.plugin(multiTenantPlugin);

const existingMediaAssetModel = mongoose.models.MediaAsset as Model<IMediaAsset> | undefined;
if (existingMediaAssetModel && !existingMediaAssetModel.schema.path('deletedAt')) {
  mongoose.deleteModel('MediaAsset');
}

export const MediaAsset: Model<IMediaAsset> =
  (mongoose.models.MediaAsset as Model<IMediaAsset> | undefined) ||
  mongoose.model<IMediaAsset>('MediaAsset', MediaAssetSchema);
