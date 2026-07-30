import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptParameterTemplate extends Document {
  source: 'roomi';
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  sourceHash: string;
  importRevision: mongoose.Types.ObjectId;
  importedAt: Date;
  name: string;
  adaptationModel: string[];
  parameters: Record<string, unknown>;
  weight: number;
  enabled: boolean;
}

const AiPromptParameterTemplateSchema = new Schema<IAiPromptParameterTemplate>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    sourceId: { type: String, required: true, trim: true },
    sourcePayload: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    importRevision: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision', required: true, index: true },
    importedAt: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    adaptationModel: { type: [String], default: [] },
    parameters: { type: Schema.Types.Mixed, required: true, default: {} },
    weight: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

AiPromptParameterTemplateSchema.index({ source: 1, sourceId: 1, importRevision: 1 }, { unique: true });

export const AiPromptParameterTemplate: Model<IAiPromptParameterTemplate> =
  (mongoose.models.AiPromptParameterTemplate as Model<IAiPromptParameterTemplate> | undefined) ||
  mongoose.model<IAiPromptParameterTemplate>('AiPromptParameterTemplate', AiPromptParameterTemplateSchema);
