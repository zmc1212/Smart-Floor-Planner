import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';

export interface IAiCreationTask extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  title: string;
  prompt: string;
  referenceAssetIds: mongoose.Types.ObjectId[];
  modelProfileId: mongoose.Types.ObjectId;
  lastBatchId?: mongoose.Types.ObjectId;
  status: 'active' | 'archived';
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiCreationTaskSchema = new Schema<IAiCreationTask>(
  {
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise', required: true, index: true },
    operatorId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    prompt: { type: String, required: true, maxlength: 12000 },
    referenceAssetIds: [{ type: Schema.Types.ObjectId, ref: 'MediaAsset' }],
    modelProfileId: { type: Schema.Types.ObjectId, ref: 'AiCreationModelProfile', required: true },
    lastBatchId: { type: Schema.Types.ObjectId, ref: 'AiCreationBatch' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    deletedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

AiCreationTaskSchema.index({ enterpriseId: 1, deletedAt: 1, updatedAt: -1 });
AiCreationTaskSchema.plugin(multiTenantPlugin);

export const AiCreationTask: Model<IAiCreationTask> =
  (mongoose.models.AiCreationTask as Model<IAiCreationTask> | undefined) ||
  mongoose.model<IAiCreationTask>('AiCreationTask', AiCreationTaskSchema);
