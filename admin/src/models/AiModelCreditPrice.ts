import mongoose, { Document, Model, Schema } from 'mongoose';
import type { GrsResolutionTier } from '@/lib/ai/grs-image-models';

export interface IAiModelCreditPrice extends Document {
  actionKey: 'image.free_create';
  modelProfileKey: string;
  resolutionTier: GrsResolutionTier;
  label: string;
  credits: number;
  enabled: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiModelCreditPriceSchema = new Schema<IAiModelCreditPrice>(
  {
    actionKey: { type: String, enum: ['image.free_create'], required: true, default: 'image.free_create' },
    modelProfileKey: { type: String, required: true, trim: true },
    resolutionTier: { type: String, enum: ['1K', '2K', '4K', 'CUSTOM'], required: true },
    label: { type: String, required: true, trim: true },
    credits: { type: Number, required: true, min: 1, max: 100000 },
    enabled: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  },
  { timestamps: true }
);

AiModelCreditPriceSchema.index(
  { actionKey: 1, modelProfileKey: 1, resolutionTier: 1 },
  { unique: true }
);

export const AiModelCreditPrice: Model<IAiModelCreditPrice> =
  (mongoose.models.AiModelCreditPrice as Model<IAiModelCreditPrice> | undefined) ||
  mongoose.model<IAiModelCreditPrice>('AiModelCreditPrice', AiModelCreditPriceSchema);
