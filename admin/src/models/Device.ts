import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IDevice extends Document {
  code: string;
  description?: string;
  enterpriseId?: mongoose.Types.ObjectId;
  assignedUserId?: mongoose.Types.ObjectId;
  status: 'unassigned' | 'assigned' | 'maintenance' | 'lost';
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema: Schema<IDevice> = new Schema(
  {
    code: { type: String, required: true, unique: true },
    description: { type: String },
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    status: {
      type: String,
      enum: ['unassigned', 'assigned', 'maintenance', 'lost'],
      default: 'unassigned',
    },
  },
  {
    timestamps: true,
  }
);

DeviceSchema.index({ enterpriseId: 1, status: 1 });
DeviceSchema.index({ enterpriseId: 1, assignedUserId: 1 });

// 应用多租户插件
DeviceSchema.plugin(multiTenantPlugin);

export const Device: Model<IDevice> = mongoose.models.Device || mongoose.model<IDevice>('Device', DeviceSchema);
