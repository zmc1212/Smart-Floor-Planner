import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAdminUser extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'viewer';
  enterpriseId?: mongoose.Types.ObjectId;
  openid?: string; // Link to WeChat identity
  phone?: string;  // Link via phone number
  menuPermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Default menu permissions per role
export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '系统管理员',
  enterprise_admin: '企业负责人',
  designer: '设计师',
  salesperson: '销售顾问',
  viewer: '只读审计员',
};

export const ALL_MENUS = [
  { key: 'dashboard', label: '总览' },
  { key: 'enterprises', label: '企业管理' },
  { key: 'floorplans', label: '户型图' },
  { key: 'users', label: '小程序用户' },
  { key: 'devices', label: '设备管理' },
  { key: 'leads', label: '客资线索' },
  { key: 'inspirations', label: '装修灵感库' },
  { key: 'staff', label: '员工管理' },
  { key: 'admins', label: '系统账号管理' },
];

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MENUS.map(m => m.key),
  admin: ['dashboard', 'enterprises', 'floorplans', 'users', 'devices', 'leads', 'inspirations'],
  enterprise_admin: ['dashboard', 'floorplans', 'leads', 'staff', 'devices'],
  designer: ['dashboard', 'floorplans', 'leads', 'devices'],
  salesperson: ['dashboard', 'leads'],
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
      enum: ['super_admin', 'admin', 'enterprise_admin', 'designer', 'salesperson', 'viewer'],
      default: 'admin',
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
    },
    openid: {
      type: String,
      sparse: true,
      index: true,
    },
    phone: {
      type: String,
      sparse: true,
      index: true,
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
