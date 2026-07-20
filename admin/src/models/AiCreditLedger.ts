import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';

export type AiCreditLedgerType = 'grant' | 'hold' | 'consume' | 'release' | 'adjust';

export interface IAiCreditLedger extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  generationId?: mongoose.Types.ObjectId;
  operatorId?: mongoose.Types.ObjectId;
  operationId: string;
  type: AiCreditLedgerType;
  amount: number;
  balanceAfter?: number;
  frozenAfter?: number;
  status: 'pending' | 'completed' | 'failed';
  note?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AiCreditLedgerSchema = new Schema<IAiCreditLedger>(
  {
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise', required: true, index: true },
    generationId: { type: Schema.Types.ObjectId, ref: 'AiGeneration', index: true },
    operatorId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    operationId: { type: String, required: true, unique: true, trim: true },
    type: {
      type: String,
      enum: ['grant', 'hold', 'consume', 'release', 'adjust'],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number },
    frozenAfter: { type: Number },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    note: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

AiCreditLedgerSchema.index({ enterpriseId: 1, createdAt: -1 });
AiCreditLedgerSchema.index({ enterpriseId: 1, generationId: 1, createdAt: -1 });
AiCreditLedgerSchema.plugin(multiTenantPlugin);

export const AiCreditLedger: Model<IAiCreditLedger> =
  (mongoose.models.AiCreditLedger as Model<IAiCreditLedger> | undefined) ||
  mongoose.model<IAiCreditLedger>('AiCreditLedger', AiCreditLedgerSchema);
