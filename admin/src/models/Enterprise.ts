import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IEnterprise extends Document {
  name: string;
  code: string; // Tax ID or Unique Code
  status: 'pending_approval' | 'active' | 'disabled';
  registrationMode: 'self_service' | 'manual';
  contactPerson: {
    name: string;
    phone: string;
    email?: string;
  };
  address?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EnterpriseSchema: Schema<IEnterprise> = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: ['pending_approval', 'active', 'disabled'],
      default: 'pending_approval',
    },
    registrationMode: {
      type: String,
      enum: ['self_service', 'manual'],
      default: 'manual',
    },
    contactPerson: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String },
    },
    address: { type: String },
    description: { type: String },
  },
  {
    timestamps: true,
  }
);

export const Enterprise: Model<IEnterprise> =
  mongoose.models.Enterprise || mongoose.model<IEnterprise>('Enterprise', EnterpriseSchema);
