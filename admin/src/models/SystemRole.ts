import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ISystemRole extends Document {
  roleKey: string;
  label: string;
  menuKeys: string[];
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SystemRoleSchema: Schema<ISystemRole> = new Schema(
  {
    roleKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    menuKeys: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

export const SystemRole: Model<ISystemRole> =
  mongoose.models.SystemRole || mongoose.model<ISystemRole>('SystemRole', SystemRoleSchema);
