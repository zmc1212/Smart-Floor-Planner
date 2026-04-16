import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDevice extends Document {
  code: string;
  description?: string;
  createdAt: Date;
}

const DeviceSchema: Schema<IDevice> = new Schema(
  {
    code: { type: String, required: true, unique: true },
    description: { type: String },
    createdAt: { type: Date, default: Date.now }
  }
);

export const Device: Model<IDevice> = mongoose.models.Device || mongoose.model<IDevice>('Device', DeviceSchema);
