import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IEnterpriseOrder extends Document {
  recordId: mongoose.Types.ObjectId;
  enterpriseId?: mongoose.Types.ObjectId;
  enterpriseNameSnapshot: string;
  packageName: string;
  amount: number;
  currency: 'CNY';
  status: 'draft' | 'signed' | 'paid' | 'cancelled';
  paidAt?: Date;
  createdBy?: mongoose.Types.ObjectId;
  remark?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EnterpriseOrderSchema = new Schema<IEnterpriseOrder>(
  {
    recordId: { type: Schema.Types.ObjectId, ref: 'PromotionEnterpriseRecord', required: true },
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
    enterpriseNameSnapshot: { type: String, required: true, trim: true },
    packageName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['CNY'], default: 'CNY' },
    status: { type: String, enum: ['draft', 'signed', 'paid', 'cancelled'], default: 'draft' },
    paidAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    remark: { type: String, trim: true },
  },
  { timestamps: true }
);

EnterpriseOrderSchema.index({ enterpriseId: 1, createdAt: -1 });
EnterpriseOrderSchema.index({ recordId: 1, createdAt: -1 });
EnterpriseOrderSchema.index({ status: 1, createdAt: -1 });

EnterpriseOrderSchema.plugin(multiTenantPlugin);

export const EnterpriseOrder: Model<IEnterpriseOrder> =
  mongoose.models.EnterpriseOrder || mongoose.model<IEnterpriseOrder>('EnterpriseOrder', EnterpriseOrderSchema);
