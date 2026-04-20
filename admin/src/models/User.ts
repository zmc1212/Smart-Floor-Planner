import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  username?: string;
  passwordHash?: string;
  role: 'admin' | 'user' | 'staff';
  openid?: string;
  nickname?: string;
  avatar?: string; // Storing as base64 or URL
  communityName?: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    username: {
      type: String,
      unique: true,
      sparse: true, // Allow multiple nulls/undefined for WX users
      trim: true,
    },
    passwordHash: {
      type: String,
    },
    role: {
      type: String,
      enum: ['admin', 'user', 'staff'],
      default: 'user',
    },
    openid: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    nickname: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String, // Large strings allowed for base64
    },
    communityName: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent mongoose from compiling the model multiple times in development
export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
