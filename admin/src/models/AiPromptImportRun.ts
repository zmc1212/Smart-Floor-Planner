import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptImportRun extends Document {
  source: 'roomi';
  mode: 'live' | 'source_file';
  execute: boolean;
  status: 'running' | 'dry_run_succeeded' | 'succeeded' | 'failed';
  revisionId?: mongoose.Types.ObjectId;
  sourceFile?: string;
  authorization: {
    authorizationProvided: boolean;
    cookieProvided: boolean;
    persistedSecrets: false;
  };
  statistics: Record<string, unknown>;
  errorMessages: string[];
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiPromptImportRunSchema = new Schema<IAiPromptImportRun>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    mode: { type: String, enum: ['live', 'source_file'], required: true },
    execute: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ['running', 'dry_run_succeeded', 'succeeded', 'failed'],
      required: true,
      default: 'running',
      index: true,
    },
    revisionId: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision' },
    sourceFile: { type: String },
    authorization: {
      authorizationProvided: { type: Boolean, required: true },
      cookieProvided: { type: Boolean, required: true },
      persistedSecrets: { type: Boolean, enum: [false], required: true, default: false },
    },
    statistics: { type: Schema.Types.Mixed, default: {} },
    errorMessages: { type: [String], default: [] },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

AiPromptImportRunSchema.index({ source: 1, startedAt: -1 });

export const AiPromptImportRun: Model<IAiPromptImportRun> =
  (mongoose.models.AiPromptImportRun as Model<IAiPromptImportRun> | undefined) ||
  mongoose.model<IAiPromptImportRun>('AiPromptImportRun', AiPromptImportRunSchema);
