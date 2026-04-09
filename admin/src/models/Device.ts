import mongoose from 'mongoose';

const DeviceSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  description: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export const Device = mongoose.models.Device || mongoose.model('Device', DeviceSchema);
