import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'enterprise_admin'
  | 'designer'
  | 'salesperson'
  | 'measurer'
  | 'viewer';

export interface IAdminUser extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
  role: AdminRole;
  enterpriseId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  promoterIds?: mongoose.Types.ObjectId[];
  wecomUserId?: string;
  openid?: string;
  phone?: string;
  menuPermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '平台管理员',
  enterprise_admin: '企业负责人',
  designer: '设计师',
  salesperson: '地推员',
  measurer: '测量员',
  viewer: '只读审计员',
};

export const ALL_MENUS = [
  { key: 'dashboard', label: '概览' },
  { key: 'enterprises', label: '企业管理' },
  { key: 'floorplans', label: '户型图库' },
  { key: 'users', label: '用户审计' },
  { key: 'devices', label: '设备管理' },
  { key: 'measurements', label: '量房记录' },
  { key: 'leads', label: '客户线索' },
  { key: 'promotion-records', label: '企业报备' },
  { key: 'workflow-logs', label: '提醒日志' },
  { key: 'enterprise-orders', label: '成交订单' },
  { key: 'commissions', label: '提成结算' },
  { key: 'ai-floorplan', label: 'AI 室内平面' },
  { key: 'ai-furnishing', label: 'AI 风格设计' },
  { key: 'ai-soft-furnishing', label: 'AI 软装设计' },
  { key: 'ai-presets', label: 'AI 预设配置' },
  { key: 'inspirations', label: '灵感方案' },
  { key: 'staff', label: '员工管理' },
  { key: 'admins', label: '系统账号管理' },
];

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MENUS.map((m) => m.key),
  admin: [
    'dashboard',
    'enterprises',
    'floorplans',
    'users',
    'devices',
    'measurements',
    'leads',
    'promotion-records',
    'workflow-logs',
    'enterprise-orders',
    'commissions',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'ai-presets',
    'inspirations',
    'staff',
    'admins',
  ],
  enterprise_admin: [
    'dashboard',
    'floorplans',
    'leads',
    'promotion-records',
    'workflow-logs',
    'enterprise-orders',
    'commissions',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'inspirations',
    'staff',
    'devices',
    'measurements',
  ],
  designer: [
    'dashboard',
    'floorplans',
    'leads',
    'promotion-records',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'inspirations',
    'devices',
    'measurements',
  ],
  salesperson: [
    'dashboard',
    'leads',
    'promotion-records',
    'enterprise-orders',
    'commissions',
    'measurements',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'inspirations',
  ],
  measurer: ['dashboard', 'promotion-records', 'measurements', 'devices'],
  viewer: ['dashboard', 'floorplans', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing', 'inspirations'],
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
      enum: ['super_admin', 'admin', 'enterprise_admin', 'designer', 'salesperson', 'measurer', 'viewer'],
      default: 'admin',
    },
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Department',
    },
    promoterIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'AdminUser',
      },
    ],
    wecomUserId: {
      type: String,
      sparse: true,
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

AdminUserSchema.index({ enterpriseId: 1, role: 1 });
AdminUserSchema.index({ enterpriseId: 1, departmentId: 1 });
AdminUserSchema.index({ enterpriseId: 1, username: 1 });

const adminUserPluginOptions: TenantPluginOptions = {
  enableRoleBasedFiltering: true,
  customFilter: (store) => {
    const filter: Record<string, unknown> = {};

    if (store.enterpriseId) {
      filter.enterpriseId = store.enterpriseId;
    }

    if (store.role === 'enterprise_admin') {
      return filter;
    }

    if (store.role === 'designer' || store.role === 'salesperson' || store.role === 'measurer') {
      filter.$or = [{ _id: store.userId }, { promoterIds: store.userId }];
    }

    return filter;
  },
};

AdminUserSchema.plugin(multiTenantPlugin, adminUserPluginOptions);

export const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser || mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
