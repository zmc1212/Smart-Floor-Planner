import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IFloorPlan extends Document {
  name: string;
  creator: mongoose.Types.ObjectId; // Customer (Mini Program User)
  staffId?: mongoose.Types.ObjectId; // Designer/Sales (AdminUser)
  enterpriseId?: mongoose.Types.ObjectId; // Tracking Company
  layoutData: any; 
  status: 'draft' | 'completed';
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
    status: {
      type: String,
      enum: ['draft', 'completed'],
      default: 'draft',
    },
  },
  {
    timestamps: true,
  }
);

FloorPlanSchema.index({ enterpriseId: 1, createdAt: -1 });
FloorPlanSchema.index({ staffId: 1, createdAt: -1 });
FloorPlanSchema.index({ creator: 1, createdAt: -1 });

// 应用多租户插件
FloorPlanSchema.plugin(multiTenantPlugin);

export const FloorPlan: Model<IFloorPlan> = mongoose.models.FloorPlan || mongoose.model<IFloorPlan>('FloorPlan', FloorPlanSchema);
