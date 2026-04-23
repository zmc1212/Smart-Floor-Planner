import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IDepartment extends Document {
  name: string;
  enterpriseId: mongoose.Types.ObjectId;
  parentId?: mongoose.Types.ObjectId;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentSchema: Schema<IDepartment> = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster lookups
DepartmentSchema.index({ enterpriseId: 1, parentId: 1 });

// 应用多租户插件
DepartmentSchema.plugin(multiTenantPlugin);

export const Department: Model<IDepartment> =
  mongoose.models.Department || mongoose.model<IDepartment>('Department', DepartmentSchema);
