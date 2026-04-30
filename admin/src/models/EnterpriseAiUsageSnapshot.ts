import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IEnterpriseAiUsageDaily {
  date: string;
  model: string;
  requests: number;
  costUsd: number;
  meterSource?: string;
}

export interface IEnterpriseAiUsageSnapshot extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  balance: number;
  currency: string;
  dailyUsage: IEnterpriseAiUsageDaily[];
  keyInfo?: {
    keyId?: string;
    keyName?: string;
    maskedKey?: string;
    status?: string;
    allowedModels?: string[];
    pollenBudget?: number | null;
  };
  lastSyncedAt?: Date;
  syncError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DailyUsageSchema = new Schema<IEnterpriseAiUsageDaily>(
  {
    date: { type: String, required: true },
    model: { type: String, required: true, default: 'unknown' },
    requests: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    meterSource: { type: String },
  },
  { _id: false }
);

const EnterpriseAiUsageSnapshotSchema = new Schema<IEnterpriseAiUsageSnapshot>(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
      unique: true,
    },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    dailyUsage: { type: [DailyUsageSchema], default: [] },
    keyInfo: {
      keyId: { type: String },
      keyName: { type: String },
      maskedKey: { type: String },
      status: { type: String },
      allowedModels: { type: [String], default: [] },
      pollenBudget: { type: Number, default: null },
    },
    lastSyncedAt: { type: Date },
    syncError: { type: String },
  },
  { timestamps: true }
);

EnterpriseAiUsageSnapshotSchema.index({ enterpriseId: 1 });
EnterpriseAiUsageSnapshotSchema.index({ 'dailyUsage.date': 1 });

export const EnterpriseAiUsageSnapshot: Model<IEnterpriseAiUsageSnapshot> =
  (mongoose.models.EnterpriseAiUsageSnapshot as Model<IEnterpriseAiUsageSnapshot> | undefined) ||
  mongoose.model<IEnterpriseAiUsageSnapshot>(
    'EnterpriseAiUsageSnapshot',
    EnterpriseAiUsageSnapshotSchema
  );
