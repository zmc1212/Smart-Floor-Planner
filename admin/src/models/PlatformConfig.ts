import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IPlatformConfig extends Document {
  key: string;
  mediaStorage?: {
    activeProviderKey?: string;
    activatedAt?: Date;
    activatedBy?: mongoose.Types.ObjectId;
    persistGrsAiOutputs?: boolean;
  };
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
    mediaStorage: {
      activeProviderKey: { type: String, trim: true, default: 'local' },
      activatedAt: { type: Date },
      activatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
      persistGrsAiOutputs: { type: Boolean, default: false },
    },
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

const existingPlatformConfigModel = mongoose.models.PlatformConfig as Model<IPlatformConfig> | undefined;
if (existingPlatformConfigModel && !existingPlatformConfigModel.schema.path('mediaStorage.persistGrsAiOutputs')) {
  mongoose.deleteModel('PlatformConfig');
}

export const PlatformConfig: Model<IPlatformConfig> =
  (mongoose.models.PlatformConfig as Model<IPlatformConfig> | undefined) ||
  mongoose.model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
