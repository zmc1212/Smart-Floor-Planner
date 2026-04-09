import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IFloorPlan extends Document {
  name: string;
  creator: mongoose.Types.ObjectId;
  layoutData: any; // Storing canvas layout or nodes structure
  status: 'draft' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

const FloorPlanSchema: Schema<IFloorPlan> = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    layoutData: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['draft', 'completed'],
      default: 'draft',
    },
  },
  {
    timestamps: true,
  }
);

export const FloorPlan: Model<IFloorPlan> = mongoose.models.FloorPlan || mongoose.model<IFloorPlan>('FloorPlan', FloorPlanSchema);
