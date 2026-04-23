import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';

export interface IAdminUser extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'viewer';
  enterpriseId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  promoterIds?: mongoose.Types.ObjectId[];
  wecomUserId?: string;
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
  admin: ['dashboard', 'enterprises', 'floorplans', 'users', 'devices', 'leads', 'inspirations', 'staff', 'admins'],
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

// 应用多租户插件 - 使用自定义过滤逻辑
const adminUserPluginOptions: TenantPluginOptions = {
  enableRoleBasedFiltering: true,
  customFilter: (store) => {
    const filter: any = {};

    // 企业级别隔离
    if (store.enterpriseId) {
      filter.enterpriseId = store.enterpriseId;
    }

    // 角色级别特殊逻辑
    if (store.role === 'enterprise_admin') {
      // 企业负责人可以看到自己企业的所有员工
      // 不需要额外的staff过滤
    } else if (store.role === 'designer' || store.role === 'salesperson') {
      // 设计师和销售只能看到自己和自己的promoter信息
      filter.$or = [
        { _id: store.userId }, // 可以看到自己的信息
        { promoterIds: store.userId } // 可以看到自己推广的员工
      ];
    }

    return filter;
  }
};

AdminUserSchema.plugin(multiTenantPlugin, adminUserPluginOptions);

export const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser || mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);