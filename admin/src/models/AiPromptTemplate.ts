import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptTemplate extends Document {
  source: 'roomi';
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  sourceHash: string;
  importRevision: mongoose.Types.ObjectId;
  importedAt: Date;
  name: string;
  promptContent: string;
  categorySourceId: string;
  categoryId: mongoose.Types.ObjectId;
  bestModelSourceId?: string;
  sourceModelId?: mongoose.Types.ObjectId;
  parameterTemplateSourceId?: string;
  parameterTemplateId?: mongoose.Types.ObjectId;
  adaptationModel: string[];
  previewAssetId?: mongoose.Types.ObjectId;
  weight: number;
  enabled: boolean;
}

const AiPromptTemplateSchema = new Schema<IAiPromptTemplate>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    sourceId: { type: String, required: true, trim: true },
    sourcePayload: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    importRevision: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision', required: true, index: true },
    importedAt: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    promptContent: { type: String, required: true },
    categorySourceId: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'AiPromptCategory', required: true, index: true },
    bestModelSourceId: { type: String, trim: true },
    sourceModelId: { type: Schema.Types.ObjectId, ref: 'AiPromptSourceModel' },
    parameterTemplateSourceId: { type: String, trim: true },
    parameterTemplateId: { type: Schema.Types.ObjectId, ref: 'AiPromptParameterTemplate' },
    adaptationModel: { type: [String], default: [] },
    previewAssetId: { type: Schema.Types.ObjectId, ref: 'AiPromptTemplateAsset' },
    weight: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

AiPromptTemplateSchema.index({ source: 1, sourceId: 1, importRevision: 1 }, { unique: true });
AiPromptTemplateSchema.index({ importRevision: 1, categoryId: 1, enabled: 1, weight: -1 });
AiPromptTemplateSchema.index({ importRevision: 1, name: 'text', promptContent: 'text' });

export const AiPromptTemplate: Model<IAiPromptTemplate> =
  (mongoose.models.AiPromptTemplate as Model<IAiPromptTemplate> | undefined) ||
  mongoose.model<IAiPromptTemplate>('AiPromptTemplate', AiPromptTemplateSchema);
