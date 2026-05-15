import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IPlatformConfig extends Document {
  key: string;
  promotionConfig?: {
    protectionPeriodDays?: number;
    protectionExtendDays?: number;
    maxProtectionExtends?: number;
    poolClaimRequiresApproval?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PlatformConfigSchema = new Schema<IPlatformConfig>(
  {
    key: { type: String, required: true, unique: true, trim: true, default: 'default' },
    promotionConfig: {
      protectionPeriodDays: { type: Number, min: 1, default: 30 },
      protectionExtendDays: { type: Number, min: 1, default: 15 },
      maxProtectionExtends: { type: Number, min: 0, default: 3 },
      poolClaimRequiresApproval: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

export const PlatformConfig: Model<IPlatformConfig> =
  mongoose.models.PlatformConfig ||
  mongoose.model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
