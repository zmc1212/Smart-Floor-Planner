import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptSourceModel extends Document {
  source: 'roomi';
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  sourceHash: string;
  importRevision: mongoose.Types.ObjectId;
  importedAt: Date;
  name: string;
  modelCode?: string;
  capabilities: Record<string, unknown>;
  weight: number;
  enabled: boolean;
  localModelProfileId?: mongoose.Types.ObjectId;
}

const AiPromptSourceModelSchema = new Schema<IAiPromptSourceModel>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    sourceId: { type: String, required: true, trim: true },
    sourcePayload: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    importRevision: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision', required: true, index: true },
    importedAt: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    modelCode: { type: String, trim: true },
    capabilities: { type: Schema.Types.Mixed, required: true, default: {} },
    weight: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true, index: true },
    localModelProfileId: { type: Schema.Types.ObjectId, ref: 'AiCreationModelProfile' },
  },
  { timestamps: true }
);

AiPromptSourceModelSchema.index({ source: 1, sourceId: 1, importRevision: 1 }, { unique: true });

export const AiPromptSourceModel: Model<IAiPromptSourceModel> =
  (mongoose.models.AiPromptSourceModel as Model<IAiPromptSourceModel> | undefined) ||
  mongoose.model<IAiPromptSourceModel>('AiPromptSourceModel', AiPromptSourceModelSchema);
