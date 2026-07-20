import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IEnterprise extends Document {
  name: string;
  code: string;
  status: 'pending_approval' | 'active' | 'disabled';
  registrationMode: 'self_service' | 'manual';
  contactPerson: {
    name: string;
    phone: string;
    email?: string;
  };
  address?: string;
  industry?: string;
  description?: string;
  logo?: string;
  branding?: {
    primaryColor?: string;
    accentColor?: string;
  };
  groundPromotionFixedCommission?: number;
  automationConfig?: {
    followUpSlaHours?: number;
    measureTaskSlaHours?: number;
    designTaskSlaHours?: number;
    reminderIntervalHours?: number;
    maxReminderTimes?: number;
    browserNotificationEnabled?: boolean;
    miniprogramNotificationEnabled?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  aiConfig?: {
    provider: 'pollinations';
    keyMode: 'managed_child_key';
    pollinationsKeyRef?: string;
    pollinationsKeyName?: string;
    pollinationsKeyEncrypted?: string;
    pollinationsMaskedKey?: string;
    allowedCapabilities?: string[];
    allowedModels?: string[];
    pollenBudget?: number | null;
    lastSyncedAt?: Date | null;
  };
  aiPolicy?: {
    enabledActionKeys?: string[];
    logicalModelTier?: 'standard';
  };
}

const EnterpriseSchema: Schema<IEnterprise> = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: ['pending_approval', 'active', 'disabled'],
      default: 'pending_approval',
    },
    registrationMode: {
      type: String,
      enum: ['self_service', 'manual'],
      default: 'manual',
    },
    contactPerson: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
    },
    address: { type: String },
    industry: { type: String, trim: true },
    description: { type: String },
    logo: { type: String },
    branding: {
      primaryColor: { type: String, default: '#171717' },
      accentColor: { type: String, default: '#0070f3' }
    },
    groundPromotionFixedCommission: {
      type: Number,
      default: 0,
      min: 0,
    },
    automationConfig: {
      followUpSlaHours: { type: Number, default: 24, min: 1 },
      measureTaskSlaHours: { type: Number, default: 48, min: 1 },
      designTaskSlaHours: { type: Number, default: 72, min: 1 },
      reminderIntervalHours: { type: Number, default: 24, min: 1 },
      maxReminderTimes: { type: Number, default: 3, min: 1 },
      browserNotificationEnabled: { type: Boolean, default: true },
      miniprogramNotificationEnabled: { type: Boolean, default: true },
    },
    aiConfig: {
      provider: {
        type: String,
        enum: ['pollinations'],
      },
      keyMode: {
        type: String,
        enum: ['managed_child_key'],
      },
      pollinationsKeyRef: { type: String },
      pollinationsKeyName: { type: String },
      pollinationsKeyEncrypted: { type: String },
      pollinationsMaskedKey: { type: String },
      allowedCapabilities: { type: [String], default: ['image'] },
      allowedModels: { type: [String], default: [] },
      pollenBudget: { type: Number, default: null },
      lastSyncedAt: { type: Date, default: null },
    },
    aiPolicy: {
      enabledActionKeys: { type: [String], default: undefined },
      logicalModelTier: { type: String, enum: ['standard'], default: 'standard' },
    }
  },
  {
    timestamps: true,
  }
);

export const Enterprise: Model<IEnterprise> =
  mongoose.models.Enterprise || mongoose.model<IEnterprise>('Enterprise', EnterpriseSchema);
