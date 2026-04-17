import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdminUser extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'viewer';
  menuPermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Default menu permissions per role
export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '普通管理员',
  viewer: '只读审计员',
};

export const ALL_MENUS = [
  { key: 'dashboard', label: '总览' },
  { key: 'floorplans', label: '户型图' },
  { key: 'users', label: '用户列表' },
  { key: 'devices', label: '设备管理' },
  { key: 'leads', label: '客资线索' },
  { key: 'inspirations', label: '装修灵感库' },
  { key: 'admins', label: '管理员管理' },
];

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MENUS.map(m => m.key),
  admin: ['dashboard', 'floorplans', 'users', 'devices', 'leads', 'inspirations'],
  viewer: ['dashboard', 'floorplans', 'inspirations'],
};

const AdminUserSchema: Schema<IAdminUser> = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'viewer'],
      default: 'admin',
    },
    menuPermissions: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser || mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
