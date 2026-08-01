import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';
import {
  DEFAULT_PERMISSIONS,
  type AdminRole,
} from '../lib/admin-user-roles';

export {
  ALL_MENUS,
  DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  type AdminRole,
} from '../lib/admin-user-roles';

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
      unique: true,
      sparse: true,
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

// Pre-save hook to set default permissions if empty
AdminUserSchema.pre('save', function () {
  if (this.isNew && (!this.menuPermissions || this.menuPermissions.length === 0)) {
    this.menuPermissions = DEFAULT_PERMISSIONS[this.role] || [];
  }
});

AdminUserSchema.index({ enterpriseId: 1, role: 1 });
AdminUserSchema.index({ enterpriseId: 1, departmentId: 1 });
AdminUserSchema.index({ enterpriseId: 1, username: 1 });

const adminUserPluginOptions: TenantPluginOptions = {
  enableRoleBasedFiltering: true,
  customFilter: (store) => {
    const filter: Record<string, unknown> = {};

    // salesperson is platform-level, no enterpriseId filtering
    if (store.role === 'salesperson') {
      return { _id: store.userId };
    }

    if (store.enterpriseId) {
      filter.enterpriseId = store.enterpriseId;
    }

    if (store.role === 'enterprise_admin') {
      return filter;
    }

    if (store.role === 'designer' || store.role === 'measurer') {
      filter.$or = [{ _id: store.userId }, { promoterIds: store.userId }];
    }

    return filter;
  },
};

AdminUserSchema.plugin(multiTenantPlugin, adminUserPluginOptions);

export const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser || mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
