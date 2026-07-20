import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';

export interface IAiCreditAccount extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  balance: number;
  frozenBalance: number;
  version: number;
  appliedOperationIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const AiCreditAccountSchema = new Schema<IAiCreditAccount>(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    frozenBalance: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0 },
    appliedOperationIds: { type: [String], default: [], select: false },
  },
  { timestamps: true }
);

AiCreditAccountSchema.plugin(multiTenantPlugin);

const existingAiCreditAccount = mongoose.models.AiCreditAccount as Model<IAiCreditAccount> | undefined;
if (existingAiCreditAccount && !existingAiCreditAccount.schema.path('appliedOperationIds')) {
  mongoose.deleteModel('AiCreditAccount');
}

export const AiCreditAccount: Model<IAiCreditAccount> =
  (mongoose.models.AiCreditAccount as Model<IAiCreditAccount> | undefined) ||
  mongoose.model<IAiCreditAccount>('AiCreditAccount', AiCreditAccountSchema);
