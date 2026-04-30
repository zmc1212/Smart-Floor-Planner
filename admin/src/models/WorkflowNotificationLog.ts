import mongoose, { Document, Model, Schema } from 'mongoose';

export type WorkflowNotificationChannel = 'station' | 'wecom';
export type WorkflowNotificationStatus = 'sent' | 'failed' | 'skipped';
export type WorkflowNotificationType =
  | 'follow_up_created'
  | 'follow_up_overdue'
  | 'conflict_pending'
  | 'measure_assigned'
  | 'measure_overdue'
  | 'measure_submitted'
  | 'design_assigned'
  | 'design_overdue'
  | 'design_completed'
  | 'record_closed';

export interface IWorkflowNotificationLog extends Document {
  enterpriseId?: mongoose.Types.ObjectId;
  recordId: mongoose.Types.ObjectId;
  recipientRole: string;
  recipientStaffId?: mongoose.Types.ObjectId;
  channel: WorkflowNotificationChannel;
  notificationType: WorkflowNotificationType;
  status: WorkflowNotificationStatus;
  dedupeKey?: string;
  message?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowNotificationLogSchema = new Schema<IWorkflowNotificationLog>(
  {
    enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
    recordId: { type: Schema.Types.ObjectId, ref: 'PromotionEnterpriseRecord', required: true, index: true },
    recipientRole: { type: String, required: true, trim: true },
    recipientStaffId: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    channel: { type: String, enum: ['station', 'wecom'], required: true },
    notificationType: {
      type: String,
      enum: [
        'follow_up_created',
        'follow_up_overdue',
        'conflict_pending',
        'measure_assigned',
        'measure_overdue',
        'measure_submitted',
        'design_assigned',
        'design_overdue',
        'design_completed',
        'record_closed',
      ],
      required: true,
    },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    dedupeKey: { type: String, trim: true, index: true },
    message: { type: String, trim: true },
    errorMessage: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

WorkflowNotificationLogSchema.index({ dedupeKey: 1, channel: 1 }, { unique: true, sparse: true });
WorkflowNotificationLogSchema.index({ recipientRole: 1, createdAt: -1 });

export const WorkflowNotificationLog: Model<IWorkflowNotificationLog> =
  mongoose.models.WorkflowNotificationLog ||
  mongoose.model<IWorkflowNotificationLog>('WorkflowNotificationLog', WorkflowNotificationLogSchema);
