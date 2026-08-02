import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';

export interface IAiCreationTask extends Document {
  enterpriseId: mongoose.Types.ObjectId | string;
  operatorId: mongoose.Types.ObjectId | string;
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
    // AI tasks predate the PostgreSQL identity migration, so this keeps legacy
    // ObjectId values readable while new tasks use PostgreSQL string IDs.
    enterpriseId: { type: Schema.Types.Mixed, required: true, index: true },
    operatorId: { type: Schema.Types.Mixed, required: true, index: true },
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

const existingAiCreationTask = mongoose.models.AiCreationTask as Model<IAiCreationTask> | undefined;
if (existingAiCreationTask && existingAiCreationTask.schema.path('enterpriseId')?.instance !== 'Mixed') {
  mongoose.deleteModel('AiCreationTask');
}

export const AiCreationTask: Model<IAiCreationTask> =
  (mongoose.models.AiCreationTask as Model<IAiCreationTask> | undefined) ||
  mongoose.model<IAiCreationTask>('AiCreationTask', AiCreationTaskSchema);
