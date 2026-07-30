import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IAiPromptCategory extends Document {
  source: 'roomi';
  sourceId: string;
  sourcePayload: Record<string, unknown>;
  sourceHash: string;
  importRevision: mongoose.Types.ObjectId;
  importedAt: Date;
  parentSourceId?: string;
  parentCategoryId?: mongoose.Types.ObjectId;
  level: number;
  name: string;
  weight: number;
  enabled: boolean;
}

const AiPromptCategorySchema = new Schema<IAiPromptCategory>(
  {
    source: { type: String, enum: ['roomi'], required: true, default: 'roomi' },
    sourceId: { type: String, required: true, trim: true },
    sourcePayload: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    importRevision: { type: Schema.Types.ObjectId, ref: 'AiPromptLibraryRevision', required: true, index: true },
    importedAt: { type: Date, required: true },
    parentSourceId: { type: String, trim: true },
    parentCategoryId: { type: Schema.Types.ObjectId, ref: 'AiPromptCategory' },
    level: { type: Number, required: true, min: 1, max: 3 },
    name: { type: String, required: true, trim: true },
    weight: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

AiPromptCategorySchema.index({ source: 1, sourceId: 1, importRevision: 1 }, { unique: true });
AiPromptCategorySchema.index({ importRevision: 1, parentSourceId: 1, weight: -1 });

export const AiPromptCategory: Model<IAiPromptCategory> =
  (mongoose.models.AiPromptCategory as Model<IAiPromptCategory> | undefined) ||
  mongoose.model<IAiPromptCategory>('AiPromptCategory', AiPromptCategorySchema);
