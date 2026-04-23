import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IMeasurement extends Document {
  floorPlanId: mongoose.Types.ObjectId;
  deviceId: string; // The Bluetooth MAC or identifier of the laser measure
  value: number; // Raw measurement in meters or millimeters
  unit: string;
  type: 'length' | 'area' | 'volume' | 'angle';
  enterpriseId?: mongoose.Types.ObjectId; // For tenant isolation
  createdAt: Date;
  updatedAt: Date;
}

const MeasurementSchema: Schema<IMeasurement> = new Schema(
  {
    floorPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'FloorPlan',
      required: true,
    },
    deviceId: {
      type: String,
      required: false,
    },
    value: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      default: 'meters',
    },
    type: {
      type: String,
      enum: ['length', 'area', 'volume', 'angle'],
      default: 'length',
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// 应用多租户插件
MeasurementSchema.plugin(multiTenantPlugin);

export const Measurement: Model<IMeasurement> = mongoose.models.Measurement || mongoose.model<IMeasurement>('Measurement', MeasurementSchema);
