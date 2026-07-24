import mongoose, { Document, Model, Schema } from 'mongoose';

export type MediaStorageDriver = 'qiniu';
export type MediaStorageConfigStatus = 'active' | 'archived';

export interface IMediaStorageConfig extends Document {
  key: string;
  name: string;
  driver: MediaStorageDriver;
  accessKeyEncrypted: string;
  accessKeyMasked: string;
  secretKeyEncrypted: string;
  secretKeyMasked: string;
  bucket: string;
  region: string;
  domain: string;
  objectPrefix: string;
  status: MediaStorageConfigStatus;
  lastTestedAt?: Date;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  archivedAt?: Date;
  archivedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MediaStorageConfigSchema = new Schema<IMediaStorageConfig>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      lowercase: true,
    },
    name: { type: String, required: true, trim: true },
    driver: { type: String, enum: ['qiniu'], required: true },
    accessKeyEncrypted: { type: String, required: true, select: false },
    accessKeyMasked: { type: String, required: true },
    secretKeyEncrypted: { type: String, required: true, select: false },
    secretKeyMasked: { type: String, required: true },
    bucket: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true },
    domain: { type: String, required: true, trim: true },
    objectPrefix: { type: String, required: true, trim: true, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    lastTestedAt: { type: Date },
    lastTestOk: { type: Boolean },
    lastTestMessage: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    archivedAt: { type: Date },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

MediaStorageConfigSchema.index({ status: 1, createdAt: 1 });

export const MediaStorageConfig: Model<IMediaStorageConfig> =
  (mongoose.models.MediaStorageConfig as Model<IMediaStorageConfig> | undefined)
  || mongoose.model<IMediaStorageConfig>('MediaStorageConfig', MediaStorageConfigSchema);
