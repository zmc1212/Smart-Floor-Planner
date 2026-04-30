import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';

export interface ICommissionRecord extends Document {
  recordId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  promoterId: mongoose.Types.ObjectId;
  enterpriseId?: mongoose.Types.ObjectId;
  commissionType: 'fixed_per_paid_order';
  commissionAmount: number;
  status: 'pending_settlement' | 'paid' | 'voided';
  generatedAt: Date;
  settledAt?: Date;
  settledBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CommissionRecordSchema = new Schema<ICommissionRecord>(
  {
    recordId: { type: Schema.Types.ObjectId, ref: 'PromotionEnterpriseRecord', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'EnterpriseOrder', required: true, unique: true },
    promoterId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
    commissionType: { type: String, enum: ['fixed_per_paid_order'], default: 'fixed_per_paid_order' },
    commissionAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending_settlement', 'paid', 'voided'], default: 'pending_settlement' },
    generatedAt: { type: Date, default: Date.now },
    settledAt: { type: Date },
    settledBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

CommissionRecordSchema.index({ enterpriseId: 1, createdAt: -1 });
CommissionRecordSchema.index({ promoterId: 1, createdAt: -1 });
CommissionRecordSchema.index({ status: 1, createdAt: -1 });

const commissionPluginOptions: TenantPluginOptions = {
  enableRoleBasedFiltering: true,
  customFilter: (store) => {
    if (store.role === 'salesperson') return { promoterId: store.userId };
    return {};
  },
};

CommissionRecordSchema.plugin(multiTenantPlugin, commissionPluginOptions);

export const CommissionRecord: Model<ICommissionRecord> =
  mongoose.models.CommissionRecord || mongoose.model<ICommissionRecord>('CommissionRecord', CommissionRecordSchema);
