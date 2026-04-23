import mongoose, { Schema, Document } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';

export interface IFollowUp {
  content: string;
  operator: string;
  createdAt: Date;
}

export interface ILead extends Document {
  name: string;
  phone: string;
  area?: number;
  stylePreference?: string;
  city?: string;
  source: string; 
  status: 'new' | 'contacted' | 'measuring' | 'designing' | 'quoting' | 'converted' | 'closed';
  notes?: string;
  enterpriseId?: mongoose.Types.ObjectId;
  floorPlanIds?: mongoose.Types.ObjectId[];
  promoterId?: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId; // Designer/Consultant (AdminUser)
  assignedAt?: Date;
  followUpRecords: IFollowUp[];
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema: Schema = new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  communityName: { type: String },
  area: { type: Number },
  stylePreference: { type: String },
  city: { type: String },
  source: { type: String, default: 'unknown' },
  status: { type: String, enum: ['new', 'contacted', 'measuring', 'designing', 'quoting', 'converted', 'closed'], default: 'new' },
  notes: { type: String },
  enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
  floorPlanIds: [{ type: Schema.Types.ObjectId, ref: 'FloorPlan' }],
  promoterId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  wecomGroupId: { type: String },
  assignedAt: { type: Date },
  followUpRecords: [{
    content: { type: String, required: true },
    operator: { type: String, default: 'System' },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

LeadSchema.index({ enterpriseId: 1, createdAt: -1 });
LeadSchema.index({ promoterId: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, createdAt: -1 });
LeadSchema.index({ phone: 1 });

// 应用多租户插件 - 配置角色级隔离
LeadSchema.plugin(multiTenantPlugin, {
  enableRoleBasedFiltering: true,
  roleFilterFields: {
    designer: 'assignedTo',     // 设计师只能看到分配给自己的线索
    salesperson: 'promoterId'  // 销售只能看到自己推广的线索
  }
});

const LeadModel = mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);

// 调试：检查模型是否有插件
console.log('[Lead Model] 模型已注册，检查插件钩子...');
console.log('[Lead Model] find 前置钩子数量:', LeadSchema.listeners('find').length);

export default LeadModel;
