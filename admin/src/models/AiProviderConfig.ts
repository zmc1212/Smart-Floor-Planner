import mongoose, { Document, Model, Schema } from 'mongoose';
import type { AiCapability, AiLogicalModelKey, AiProviderAdapterType } from '@/lib/ai/provider-types';

export interface IAiProviderConfig extends Document {
  key: string;
  name: string;
  adapterType: AiProviderAdapterType;
  baseUrl: string;
  apiKeyEncrypted: string;
  apiKeyMasked: string;
  credentialsEncrypted?: Record<string, string>;
  credentialsMasked?: Record<string, string>;
  adapterConfig: Record<string, string | number | boolean>;
  capabilities: AiCapability[];
  modelMappings: Partial<Record<AiLogicalModelKey, string>>;
  priority: number;
  timeoutMs: number;
  enabled: boolean;
  costRules: Array<{
    logicalModelKey: AiLogicalModelKey;
    remoteModel?: string;
    resolutionTier?: string;
    currency: string;
    estimatedMicros: number;
  }>;
  lastTestedAt?: Date;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  lastModelSyncAt?: Date;
  discoveredModels: string[];
  lastUpstreamBalance?: number;
  lastUpstreamBalanceUnit?: string;
  lastUpstreamBalanceAt?: Date;
  lastUpstreamBalanceMessage?: string;
  createdBy?: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiProviderConfigSchema = new Schema<IAiProviderConfig>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    adapterType: { type: String, enum: ['grs', 'pollinations', 'openai_compatible'], required: true },
    baseUrl: { type: String, required: true, trim: true },
    apiKeyEncrypted: { type: String, required: true, select: false },
    apiKeyMasked: { type: String, default: '' },
    credentialsEncrypted: { type: Schema.Types.Mixed, default: {}, select: false },
    credentialsMasked: { type: Schema.Types.Mixed, default: {} },
    adapterConfig: { type: Schema.Types.Mixed, default: {} },
    capabilities: { type: [String], enum: ['chat', 'vision', 'image.generate', 'image.edit'], default: [] },
    modelMappings: { type: Schema.Types.Mixed, default: {} },
    priority: { type: Number, default: 100, min: 0 },
    timeoutMs: { type: Number, default: 90000, min: 1000, max: 600000 },
    enabled: { type: Boolean, default: true, index: true },
    costRules: {
      type: [
        new Schema(
          {
            logicalModelKey: { type: String, required: true },
            remoteModel: { type: String, trim: true },
            resolutionTier: { type: String, enum: ['1K', '2K', '4K', 'CUSTOM'] },
            currency: { type: String, required: true, uppercase: true, trim: true },
            estimatedMicros: { type: Number, required: true, min: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    lastTestedAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String,
    lastModelSyncAt: Date,
    discoveredModels: { type: [String], default: [] },
    lastUpstreamBalance: Number,
    lastUpstreamBalanceUnit: String,
    lastUpstreamBalanceAt: Date,
    lastUpstreamBalanceMessage: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

AiProviderConfigSchema.index({ enabled: 1, priority: 1 });

export const AiProviderConfig: Model<IAiProviderConfig> =
  (mongoose.models.AiProviderConfig as Model<IAiProviderConfig> | undefined) ||
  mongoose.model<IAiProviderConfig>('AiProviderConfig', AiProviderConfigSchema);
