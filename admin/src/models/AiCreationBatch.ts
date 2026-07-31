import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';

export interface IAiCreationBatch extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  taskId: mongoose.Types.ObjectId;
  sequence: number;
  prompt: string;
  negativePrompt?: string;
  referenceAssetIds: mongoose.Types.ObjectId[];
  modelProfileId: mongoose.Types.ObjectId;
  modelProfileSnapshot: Record<string, unknown>;
  parameterSnapshot: {
    aspectRatio: string;
    resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
    width?: number;
    height?: number;
    size?: string;
    quality?: string;
    templateId?: string;
  };
  requestedCount: number;
  generationIds: mongoose.Types.ObjectId[];
  status: 'pending' | 'processing' | 'succeeded' | 'partial' | 'failed';
  creditsEstimate: number;
  createdAt: Date;
  updatedAt: Date;
}

const AiCreationBatchSchema = new Schema<IAiCreationBatch>(
  {
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise', required: true, index: true },
    operatorId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'AiCreationTask', required: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    prompt: { type: String, required: true, maxlength: 12000 },
    negativePrompt: { type: String, maxlength: 4000 },
    referenceAssetIds: [{ type: Schema.Types.ObjectId, ref: 'MediaAsset' }],
    modelProfileId: { type: Schema.Types.ObjectId, ref: 'AiCreationModelProfile', required: true },
    modelProfileSnapshot: { type: Schema.Types.Mixed, required: true },
    parameterSnapshot: {
      aspectRatio: { type: String, required: true },
      resolutionTier: { type: String, enum: ['1K', '2K', '4K', 'CUSTOM'], required: true },
      width: { type: Number },
      height: { type: Number },
      size: { type: String },
      quality: { type: String },
      templateId: { type: String },
    },
    requestedCount: { type: Number, required: true, min: 1, max: 4 },
    generationIds: [{ type: Schema.Types.ObjectId, ref: 'AiGeneration' }],
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'partial', 'failed'],
      default: 'pending',
      index: true,
    },
    creditsEstimate: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

AiCreationBatchSchema.index({ taskId: 1, sequence: 1 }, { unique: true });
AiCreationBatchSchema.index({ enterpriseId: 1, createdAt: -1 });
AiCreationBatchSchema.plugin(multiTenantPlugin);

export const AiCreationBatch: Model<IAiCreationBatch> =
  (mongoose.models.AiCreationBatch as Model<IAiCreationBatch> | undefined) ||
  mongoose.model<IAiCreationBatch>('AiCreationBatch', AiCreationBatchSchema);
