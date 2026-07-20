import mongoose, { Document, Model, Schema } from 'mongoose';
import type { AiActionKey } from '@/lib/ai/provider-types';

export type MiniAiTaskType =
  | 'reference_recreate'
  | 'style_transform'
  | 'floor_plan_render'
  | 'soft_furnishing';

export interface IAiCreditPrice extends Document {
  actionKey: AiActionKey;
  mode?: MiniAiTaskType;
  label: string;
  credits: number;
  enabled: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiCreditPriceSchema = new Schema<IAiCreditPrice>(
  {
    actionKey: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true,
    },
    mode: {
      type: String,
      enum: ['reference_recreate', 'style_transform', 'floor_plan_render', 'soft_furnishing'],
    },
    label: { type: String, required: true, trim: true },
    credits: { type: Number, required: true, min: 0, default: 10 },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

const existingAiCreditPrice = mongoose.models.AiCreditPrice as Model<IAiCreditPrice> | undefined;
const existingModeEnum = ((existingAiCreditPrice?.schema.path('mode') as unknown as { enumValues?: string[] })?.enumValues || []);
if (
  existingAiCreditPrice &&
  (!existingAiCreditPrice.schema.path('actionKey') ||
    !existingModeEnum.includes('floor_plan_render') ||
    !existingModeEnum.includes('soft_furnishing'))
) {
  mongoose.deleteModel('AiCreditPrice');
}

export const AiCreditPrice: Model<IAiCreditPrice> =
  (mongoose.models.AiCreditPrice as Model<IAiCreditPrice> | undefined) ||
  mongoose.model<IAiCreditPrice>('AiCreditPrice', AiCreditPriceSchema);
