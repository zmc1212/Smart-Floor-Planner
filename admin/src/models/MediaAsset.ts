import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export type MediaAssetStorageProvider = string;

export interface IMediaAsset extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  ownerType: 'ai_workflow_source' | 'ai_generation_output' | 'ai_generation_input' | 'manual_upload';
  ownerId?: mongoose.Types.ObjectId;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  storageProvider: MediaAssetStorageProvider;
  storageKey: string;
  storageBucket?: string;
  checksumSha256?: string;
  originalUrl?: string;
  deletedAt?: Date;
  purgedAt?: Date;
  purgeError?: string;
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
    width: { type: Number, min: 1 },
    height: { type: Number, min: 1 },
    storageProvider: {
      type: String,
      default: 'local',
      required: true,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
    },
    storageBucket: { type: String },
    checksumSha256: { type: String },
    originalUrl: {
      type: String,
    },
    deletedAt: { type: Date, index: true },
    purgedAt: { type: Date, index: true },
    purgeError: { type: String },
  },
  { timestamps: true }
);

MediaAssetSchema.index({ enterpriseId: 1, ownerType: 1, ownerId: 1, createdAt: -1 });

MediaAssetSchema.plugin(multiTenantPlugin);

const existingMediaAssetModel = mongoose.models.MediaAsset as Model<IMediaAsset> | undefined;
if (
  existingMediaAssetModel
  && (!existingMediaAssetModel.schema.path('deletedAt')
    || !existingMediaAssetModel.schema.path('width')
    || !existingMediaAssetModel.schema.path('height')
    || !existingMediaAssetModel.schema.path('storageBucket')
    || !existingMediaAssetModel.schema.path('checksumSha256')
    || !existingMediaAssetModel.schema.path('purgedAt'))
) {
  mongoose.deleteModel('MediaAsset');
}

export const MediaAsset: Model<IMediaAsset> =
  (mongoose.models.MediaAsset as Model<IMediaAsset> | undefined) ||
  mongoose.model<IMediaAsset>('MediaAsset', MediaAssetSchema);
