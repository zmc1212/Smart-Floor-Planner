import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IPackage extends Document {
  name: string;
  price: number;
  description?: string;
  features: string[];
  promotionCommission: number;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}

const PackageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true },
    features: [{ type: String }],
    promotionCommission: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
    },
  },
  { timestamps: true }
);

PackageSchema.index({ status: 1, createdAt: -1 });

export const Package: Model<IPackage> =
  mongoose.models.Package || mongoose.model<IPackage>('Package', PackageSchema);

// In development, we might need to update the schema if it's already registered
if (mongoose.models.Package) {
  const existingSchema = mongoose.models.Package.schema;
  if (!existingSchema.path('promotionCommission')) {
    existingSchema.add({ promotionCommission: { type: Number, default: 0 } });
  }
}
