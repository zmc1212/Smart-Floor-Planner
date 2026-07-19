import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export type FloorPlanSource = 'manual' | 'template' | 'kujiale';

export interface IFloorPlanExternalSource {
  provider?: string;
  externalId?: string;
  communityName?: string;
  city?: string;
  area?: number;
  layoutLabel?: string;
  previewUrl?: string;
  importedAt?: Date;
  rawSummary?: Record<string, unknown>;
}

export interface IFloorPlan extends Document {
  name: string;
  creator: mongoose.Types.ObjectId; // Customer (Mini Program User)
  staffId?: mongoose.Types.ObjectId; // Designer/Sales (AdminUser)
  enterpriseId?: mongoose.Types.ObjectId; // Tracking Company
  layoutData: any; 
  source: FloorPlanSource;
  externalSource?: IFloorPlanExternalSource;
  status: 'draft' | 'completed';
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FloorPlanSchema: Schema<IFloorPlan> = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
    },
    layoutData: {
      type: Schema.Types.Mixed,
      default: {},
    },
    source: {
      type: String,
      enum: ['manual', 'template', 'kujiale'],
      default: 'manual',
      index: true,
    },
    externalSource: {
      provider: { type: String, trim: true },
      externalId: { type: String, trim: true },
      communityName: { type: String, trim: true },
      city: { type: String, trim: true },
      area: { type: Number },
      layoutLabel: { type: String, trim: true },
      previewUrl: { type: String, trim: true },
      importedAt: { type: Date },
      rawSummary: { type: Schema.Types.Mixed, default: {} },
    },
    status: {
      type: String,
      enum: ['draft', 'completed'],
      default: 'draft',
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

FloorPlanSchema.index({ enterpriseId: 1, createdAt: -1 });
FloorPlanSchema.index({ staffId: 1, createdAt: -1 });
FloorPlanSchema.index({ staffId: 1, status: 1, completedAt: -1 });
FloorPlanSchema.index({ creator: 1, createdAt: -1 });
FloorPlanSchema.index({ enterpriseId: 1, 'externalSource.provider': 1, 'externalSource.externalId': 1 });

// 应用多租户插件 - 配置角色级隔离
FloorPlanSchema.plugin(multiTenantPlugin, {
  enableRoleBasedFiltering: true,
  roleFilterFields: {
    designer: 'staffId',
    salesperson: 'staffId'
  }
});

export const FloorPlan: Model<IFloorPlan> = mongoose.models.FloorPlan || mongoose.model<IFloorPlan>('FloorPlan', FloorPlanSchema);
