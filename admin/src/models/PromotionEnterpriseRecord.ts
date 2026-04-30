import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin, TenantPluginOptions } from '../lib/mongoose-tenant-plugin';

export type OwnershipStatus = 'auto_locked' | 'conflict_pending' | 'manually_locked';
export type BusinessStage = 'reported' | 'contacted' | 'measuring' | 'designing' | 'quoted' | 'paid' | 'closed_lost';
export type MeasureTaskStatus = 'unassigned' | 'assigned' | 'accepted' | 'submitted';
export type DesignTaskStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed';
export type PendingActionRole = 'salesperson' | 'measurer' | 'designer' | 'enterprise_admin' | 'none';

export interface IPromotionEnterpriseRecord extends Document {
  enterpriseName: string;
  creditCode?: string;
  contactPerson: string;
  phone: string;
  city?: string;
  address?: string;
  industry?: string;
  sourceChannel: 'ground_promotion';
  promoterId: mongoose.Types.ObjectId;
  enterpriseId?: mongoose.Types.ObjectId;
  ownershipStatus: OwnershipStatus;
  businessStage: BusinessStage;
  pendingActionRole?: PendingActionRole;
  notes?: string;
  nextFollowUpAt?: Date;
  lastActivityAt?: Date;
  followUpRecords: Array<{
    content: string;
    operator: string;
    operatorId?: mongoose.Types.ObjectId;
    createdAt: Date;
  }>;
  measureTask: {
    status: MeasureTaskStatus;
    assignedTo?: mongoose.Types.ObjectId;
    assignedAt?: Date;
    acceptedAt?: Date;
    submittedAt?: Date;
    dueAt?: Date;
    lastReminderAt?: Date;
    resultSummary?: string;
  };
  designTask: {
    status: DesignTaskStatus;
    assignedTo?: mongoose.Types.ObjectId;
    assignedAt?: Date;
    completedAt?: Date;
    dueAt?: Date;
    lastReminderAt?: Date;
    latestNote?: string;
  };
  conflictInfo?: {
    conflictReason?: string;
    conflictingRecordIds?: mongoose.Types.ObjectId[];
    reviewedBy?: mongoose.Types.ObjectId;
    reviewedAt?: Date;
    resolution?: string;
  };
  attachments: string[];
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PromotionEnterpriseRecordSchema = new Schema<IPromotionEnterpriseRecord>(
  {
    enterpriseName: { type: String, required: true, trim: true },
    creditCode: { type: String, trim: true, uppercase: true },
    contactPerson: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    city: { type: String, trim: true },
    address: { type: String, trim: true },
    industry: { type: String, trim: true },
    sourceChannel: { type: String, enum: ['ground_promotion'], default: 'ground_promotion' },
    promoterId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
    ownershipStatus: {
      type: String,
      enum: ['auto_locked', 'conflict_pending', 'manually_locked'],
      default: 'auto_locked',
    },
    businessStage: {
      type: String,
      enum: ['reported', 'contacted', 'measuring', 'designing', 'quoted', 'paid', 'closed_lost'],
      default: 'reported',
    },
    pendingActionRole: {
      type: String,
      enum: ['salesperson', 'measurer', 'designer', 'enterprise_admin', 'none'],
      default: 'none',
    },
    notes: { type: String, trim: true },
    nextFollowUpAt: { type: Date },
    lastActivityAt: { type: Date, default: Date.now },
    followUpRecords: [
      {
        content: { type: String, required: true },
        operator: { type: String, required: true },
        operatorId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    measureTask: {
      status: {
        type: String,
        enum: ['unassigned', 'assigned', 'accepted', 'submitted'],
        default: 'unassigned',
      },
      assignedTo: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
      assignedAt: { type: Date },
      acceptedAt: { type: Date },
      submittedAt: { type: Date },
      dueAt: { type: Date },
      lastReminderAt: { type: Date },
      resultSummary: { type: String, trim: true },
    },
    designTask: {
      status: {
        type: String,
        enum: ['unassigned', 'assigned', 'in_progress', 'completed'],
        default: 'unassigned',
      },
      assignedTo: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
      assignedAt: { type: Date },
      completedAt: { type: Date },
      dueAt: { type: Date },
      lastReminderAt: { type: Date },
      latestNote: { type: String, trim: true },
    },
    conflictInfo: {
      conflictReason: { type: String, trim: true },
      conflictingRecordIds: [{ type: Schema.Types.ObjectId, ref: 'PromotionEnterpriseRecord' }],
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
      reviewedAt: { type: Date },
      resolution: { type: String, trim: true },
    },
    attachments: [{ type: String }],
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
      name: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

PromotionEnterpriseRecordSchema.index({ enterpriseId: 1, createdAt: -1 });
PromotionEnterpriseRecordSchema.index({ promoterId: 1, createdAt: -1 });
PromotionEnterpriseRecordSchema.index({ 'measureTask.assignedTo': 1, createdAt: -1 });
PromotionEnterpriseRecordSchema.index({ 'designTask.assignedTo': 1, createdAt: -1 });
PromotionEnterpriseRecordSchema.index({ creditCode: 1 });
PromotionEnterpriseRecordSchema.index({ enterpriseName: 1, phone: 1 });
PromotionEnterpriseRecordSchema.index({ ownershipStatus: 1, businessStage: 1 });
PromotionEnterpriseRecordSchema.index({ pendingActionRole: 1, nextFollowUpAt: 1 });

const promotionRecordPluginOptions: TenantPluginOptions = {
  enableRoleBasedFiltering: true,
  customFilter: (store) => {
    if (store.role === 'salesperson') return { promoterId: store.userId };
    if (store.role === 'measurer') return { 'measureTask.assignedTo': store.userId };
    if (store.role === 'designer') return { 'designTask.assignedTo': store.userId };
    return {};
  },
};

PromotionEnterpriseRecordSchema.plugin(multiTenantPlugin, promotionRecordPluginOptions);

export const PromotionEnterpriseRecord: Model<IPromotionEnterpriseRecord> =
  mongoose.models.PromotionEnterpriseRecord ||
  mongoose.model<IPromotionEnterpriseRecord>('PromotionEnterpriseRecord', PromotionEnterpriseRecordSchema);
