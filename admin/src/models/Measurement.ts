import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IMeasurement extends Document {
  floorPlanId: mongoose.Types.ObjectId;
  operatorId?: mongoose.Types.ObjectId;
  roomId?: string;
  roomName?: string;
  deviceId?: string;
  value: number;
  unit: string;
  type: 'length' | 'height' | 'area' | 'volume' | 'angle';
  direction?: string;
  source: 'ble' | 'manual' | 'system';
  enterpriseId?: mongoose.Types.ObjectId;
  measuredAt: Date;
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
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: false,
    },
    roomId: {
      type: String,
      required: false,
      trim: true,
    },
    roomName: {
      type: String,
      required: false,
      trim: true,
    },
    deviceId: {
      type: String,
      required: false,
      trim: true,
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
      enum: ['length', 'height', 'area', 'volume', 'angle'],
      default: 'length',
    },
    direction: {
      type: String,
      required: false,
      trim: true,
    },
    source: {
      type: String,
      enum: ['ble', 'manual', 'system'],
      default: 'ble',
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: false,
    },
    measuredAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

MeasurementSchema.index({ enterpriseId: 1, measuredAt: -1 });
MeasurementSchema.index({ operatorId: 1, measuredAt: -1 });
MeasurementSchema.index({ floorPlanId: 1, measuredAt: -1 });
MeasurementSchema.index({ deviceId: 1, measuredAt: -1 });

MeasurementSchema.plugin(multiTenantPlugin);

export const Measurement: Model<IMeasurement> =
  mongoose.models.Measurement || mongoose.model<IMeasurement>('Measurement', MeasurementSchema);
