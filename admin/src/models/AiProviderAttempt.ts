import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';
import type { AiCapability, AiLogicalModelKey, AiProviderAttemptStatus } from '@/lib/ai/provider-types';

export interface IAiProviderAttempt extends Document {
  enterpriseId: mongoose.Types.ObjectId | string;
  generationId?: mongoose.Types.ObjectId;
  providerConfigId: mongoose.Types.ObjectId;
  providerKey: string;
  adapterType: string;
  capability: AiCapability;
  logicalModelKey: AiLogicalModelKey;
  remoteModel: string;
  resolutionTier?: string;
  remoteTaskId?: string;
  status: AiProviderAttemptStatus;
  accepted: boolean;
  remoteStatus?: string;
  estimatedCost?: { currency: string; micros: number };
  actualCost?: { currency: string; micros: number };
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  requestFingerprint?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const MoneySchema = new Schema({ currency: String, micros: Number }, { _id: false });
const AiProviderAttemptSchema = new Schema<IAiProviderAttempt>(
  {
    enterpriseId: { type: Schema.Types.Mixed, required: true, index: true },
    generationId: { type: Schema.Types.ObjectId, ref: 'AiGeneration', index: true },
    providerConfigId: { type: Schema.Types.ObjectId, ref: 'AiProviderConfig', required: true },
    providerKey: { type: String, required: true },
    adapterType: { type: String, required: true },
    capability: { type: String, required: true },
    logicalModelKey: { type: String, required: true },
    remoteModel: { type: String, required: true },
    resolutionTier: { type: String, enum: ['1K', '2K', '4K', 'CUSTOM'] },
    remoteTaskId: String,
    status: { type: String, enum: ['created', 'submitted', 'processing', 'succeeded', 'failed', 'unknown'], default: 'created', index: true },
    accepted: { type: Boolean, default: false },
    remoteStatus: String,
    estimatedCost: MoneySchema,
    actualCost: MoneySchema,
    errorCode: String,
    errorMessage: String,
    durationMs: Number,
    requestFingerprint: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true }
);

AiProviderAttemptSchema.index({ generationId: 1, createdAt: -1 });
AiProviderAttemptSchema.index({ status: 1, updatedAt: 1 });
AiProviderAttemptSchema.plugin(multiTenantPlugin);

const existingAiProviderAttempt = mongoose.models.AiProviderAttempt as Model<IAiProviderAttempt> | undefined;
if (existingAiProviderAttempt && existingAiProviderAttempt.schema.path('enterpriseId')?.instance !== 'Mixed') {
  mongoose.deleteModel('AiProviderAttempt');
}

export const AiProviderAttempt: Model<IAiProviderAttempt> =
  (mongoose.models.AiProviderAttempt as Model<IAiProviderAttempt> | undefined) ||
  mongoose.model<IAiProviderAttempt>('AiProviderAttempt', AiProviderAttemptSchema);
