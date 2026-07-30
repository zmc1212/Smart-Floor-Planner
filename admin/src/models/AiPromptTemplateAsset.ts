import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptTemplateAsset extends Document {
  source: 'roomi';
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  sourceHash: string;
  importRevision: mongoose.Types.ObjectId;
  importedAt: Date;
  templateSourceId: string;
  sourceUrl?: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  checksumSha256: string;
  storageProvider: string;
  storageKey: string;
  storageBucket?: string;
}

const AiPromptTemplateAssetSchema = new Schema<IAiPromptTemplateAsset>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    sourceId: { type: String, required: true, trim: true },
    sourcePayload: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    importRevision: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision', required: true, index: true },
    importedAt: { type: Date, required: true },
    templateSourceId: { type: String, required: true, trim: true },
    sourceUrl: { type: String },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    checksumSha256: { type: String, required: true, index: true },
    storageProvider: { type: String, required: true },
    storageKey: { type: String, required: true },
    storageBucket: { type: String },
  },
  { timestamps: true }
);

AiPromptTemplateAssetSchema.index({ source: 1, sourceId: 1, importRevision: 1 }, { unique: true });
AiPromptTemplateAssetSchema.index({ storageProvider: 1, storageKey: 1 });

export const AiPromptTemplateAsset: Model<IAiPromptTemplateAsset> =
  (mongoose.models.AiPromptTemplateAsset as Model<IAiPromptTemplateAsset> | undefined) ||
  mongoose.model<IAiPromptTemplateAsset>('AiPromptTemplateAsset', AiPromptTemplateAssetSchema);
