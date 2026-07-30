import mongoose, { Document, Model, Schema } from 'mongoose';

export type AiPromptLibraryRevisionStatus =
  | 'staging'
  | 'active'
  | 'superseded'
  | 'failed'
  | 'rolled_back';

export interface IAiPromptLibraryRevision extends Document {
  source: 'roomi';
  revisionKey: string;
  status: AiPromptLibraryRevisionStatus;
  manifestHash: string;
  contentHash: string;
  snapshotPath?: string;
  counts: {
    categories: number;
    templates: number;
    parameterTemplates: number;
    models: number;
    previewAssets: number;
  };
  validationErrors: string[];
  validationWarnings: string[];
  publishedAt?: Date;
  supersededAt?: Date;
  rolledBackAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CountsSchema = new Schema(
  {
    categories: { type: Number, required: true, min: 0 },
    templates: { type: Number, required: true, min: 0 },
    parameterTemplates: { type: Number, required: true, min: 0 },
    models: { type: Number, required: true, min: 0 },
    previewAssets: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const AiPromptLibraryRevisionSchema = new Schema<IAiPromptLibraryRevision>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi', index: true },
    revisionKey: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: ['staging', 'active', 'superseded', 'failed', 'rolled_back'],
      required: true,
      default: 'staging',
      index: true,
    },
    manifestHash: { type: String, required: true, index: true },
    contentHash: { type: String, required: true },
    snapshotPath: { type: String },
    counts: { type: CountsSchema, required: true },
    validationErrors: { type: [String], default: [] },
    validationWarnings: { type: [String], default: [] },
    publishedAt: { type: Date, index: true },
    supersededAt: { type: Date },
    rolledBackAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true }
);

AiPromptLibraryRevisionSchema.index({ source: 1, status: 1, publishedAt: -1 });

export const AiPromptLibraryRevision: Model<IAiPromptLibraryRevision> =
  (mongoose.models.AiPromptLibraryRevision as Model<IAiPromptLibraryRevision> | undefined) ||
  mongoose.model<IAiPromptLibraryRevision>('AiPromptLibraryRevision', AiPromptLibraryRevisionSchema);
