import mongoose from 'mongoose';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { WorkflowNotificationLog, WorkflowNotificationType } from '@/models/WorkflowNotificationLog';
import { WeComService } from '@/lib/wecom';

export const DEFAULT_AUTOMATION_CONFIG = {
  followUpSlaHours: 24,
  measureTaskSlaHours: 48,
  designTaskSlaHours: 72,
  wecomReminderEnabled: true,
  reminderIntervalHours: 24,
  maxReminderTimes: 3,
};

export type WorkbenchTodoView = 'mine' | 'overdue' | 'today';

export interface WorkbenchTodoItem {
  key: string;
  recordId: string;
  enterpriseId?: string;
  enterpriseName: string;
  contactPerson: string;
  phone: string;
  role: string;
  type: string;
  title: string;
  summary: string;
  dueAt?: string;
  dueLabel?: string;
  overdue: boolean;
  businessStage: string;
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function addHours(base: Date, hours: number) {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

export function getEnterpriseAutomationConfig(enterprise?: any) {
  return {
    ...DEFAULT_AUTOMATION_CONFIG,
    ...(enterprise?.automationConfig || {}),
  };
}

function isRecordClosed(record: any) {
  return ['paid', 'closed_lost'].includes(record.businessStage);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildTodo(
  record: any,
  role: string,
  type: string,
  title: string,
  summary: string,
  dueAt?: Date
): WorkbenchTodoItem {
  const overdue = !!(dueAt && dueAt.getTime() < Date.now());
  return {
    key: `${record._id}:${role}:${type}`,
    recordId: String(record._id),
    enterpriseId: record.enterpriseId ? String(record.enterpriseId) : undefined,
    enterpriseName: record.enterpriseName,
    contactPerson: record.contactPerson,
    phone: record.phone,
    role,
    type,
    title,
    summary,
    dueAt: dueAt?.toISOString(),
    dueLabel: dueAt
      ? dueAt.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : undefined,
    overdue,
    businessStage: record.businessStage,
  };
}

export function buildTodoItemsForRecord(record: any, role: string, config?: any): WorkbenchTodoItem[] {
  if (!record || isRecordClosed(record)) return [];

  const automation = getEnterpriseAutomationConfig(config);
  const recordCreatedAt = toDate(record.createdAt) || new Date();
  const lastActivityAt = toDate(record.lastActivityAt) || toDate(record.updatedAt) || recordCreatedAt;
  const nextFollowUpAt = toDate(record.nextFollowUpAt);
  const measureDueAt = toDate(record.measureTask?.dueAt);
  const designDueAt = toDate(record.designTask?.dueAt);
  const items: WorkbenchTodoItem[] = [];

  if (role === 'salesperson') {
    if (record.ownershipStatus === 'conflict_pending') return items;
    if (record.pendingActionRole === 'salesperson' || record.businessStage === 'quoted') {
      const dueAt = nextFollowUpAt || addHours(lastActivityAt, automation.followUpSlaHours);
      const title = record.businessStage === 'quoted' ? '待报价/成交跟进' : '待客户跟进';
      items.push(
        buildTodo(record, role, record.businessStage === 'quoted' ? 'quote_follow_up' : 'follow_up', title, `${record.contactPerson} / ${record.phone}`, dueAt)
      );
    }
    return items;
  }

  if (role === 'measurer') {
    if (['assigned', 'accepted'].includes(record.measureTask?.status)) {
      items.push(
        buildTodo(
          record,
          role,
          'measure_task',
          record.measureTask?.status === 'assigned' ? '待接收测量任务' : '测量任务进行中',
          `${record.enterpriseName} / ${record.contactPerson}`,
          measureDueAt
        )
      );
    }
    return items;
  }

  if (role === 'designer') {
    if (['assigned', 'in_progress'].includes(record.designTask?.status)) {
      items.push(
        buildTodo(
          record,
          role,
          'design_task',
          record.designTask?.status === 'assigned' ? '待开始设计任务' : '设计任务进行中',
          `${record.enterpriseName} / ${record.contactPerson}`,
          designDueAt
        )
      );
    }
    return items;
  }

  if (role === 'enterprise_admin' || role === 'admin' || role === 'super_admin') {
    if (record.ownershipStatus === 'conflict_pending') {
      items.push(
        buildTodo(
          record,
          role,
          'conflict_pending',
          '待处理归属冲突',
          `${record.enterpriseName} 存在重复报备`,
          addHours(recordCreatedAt, automation.followUpSlaHours)
        )
      );
    }

    if (record.businessStage === 'measuring' && record.measureTask?.status === 'unassigned') {
      items.push(
        buildTodo(
          record,
          role,
          'assign_measurer',
          '待分配测量员',
          `${record.enterpriseName} 还未分配测量任务`,
          addHours(lastActivityAt, automation.followUpSlaHours)
        )
      );
    }

    if (record.measureTask?.status === 'submitted' && record.designTask?.status === 'unassigned') {
      items.push(
        buildTodo(
          record,
          role,
          'assign_designer',
          '待分配设计师',
          `${record.enterpriseName} 已提交测量结果`,
          addHours(toDate(record.measureTask?.submittedAt) || lastActivityAt, automation.followUpSlaHours)
        )
      );
    }

    if (record.businessStage === 'quoted') {
      items.push(
        buildTodo(
          record,
          role,
          'quote_follow_up',
          '待报价成交跟进',
          `${record.enterpriseName} 已完成设计，待推进成交`,
          nextFollowUpAt || addHours(toDate(record.designTask?.completedAt) || lastActivityAt, automation.followUpSlaHours)
        )
      );
    }
  }

  return items;
}

function matchesTodoView(todo: WorkbenchTodoItem, view: WorkbenchTodoView) {
  if (view === 'mine') return true;
  if (view === 'overdue') return todo.overdue;
  if (view === 'today') {
    if (!todo.dueAt) return false;
    return sameDay(new Date(todo.dueAt), new Date());
  }
  return true;
}

export async function listWorkbenchTodos(input: {
  role: string;
  userId?: string | null;
  enterpriseId?: string | null;
  view?: WorkbenchTodoView;
}) {
  const query: Record<string, unknown> = {};
  const role = input.role;

  if (input.enterpriseId) {
    query.enterpriseId = input.enterpriseId;
  }

  if (role === 'salesperson' && input.userId) {
    query.promoterId = input.userId;
  } else if (role === 'measurer' && input.userId) {
    query['measureTask.assignedTo'] = input.userId;
  } else if (role === 'designer' && input.userId) {
    query['designTask.assignedTo'] = input.userId;
  }

  const records = await PromotionEnterpriseRecord.find(query).sort({ updatedAt: -1 }).lean();
  const enterpriseIds = Array.from(
    new Set(records.map((item) => (item.enterpriseId ? String(item.enterpriseId) : '')).filter(Boolean))
  );
  const enterprises = await Enterprise.find({ _id: { $in: enterpriseIds } })
    .select('automationConfig')
    .lean();
  const enterpriseMap = new Map(enterprises.map((item: any) => [String(item._id), item]));

  const todos = records.flatMap((record) =>
    buildTodoItemsForRecord(record, role, enterpriseMap.get(record.enterpriseId ? String(record.enterpriseId) : ''))
  );

  return todos
    .filter((todo) => matchesTodoView(todo, (input.view || 'mine') as WorkbenchTodoView))
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
}

function getNotificationTypeLabel(type: WorkflowNotificationType) {
  const labels: Record<WorkflowNotificationType, string> = {
    follow_up_created: '新跟进待办',
    follow_up_overdue: '跟进已超时',
    conflict_pending: '归属冲突待处理',
    measure_assigned: '测量任务已分配',
    measure_overdue: '测量任务已超时',
    measure_submitted: '测量结果待处理',
    design_assigned: '设计任务已分配',
    design_overdue: '设计任务已超时',
    design_completed: '设计完成待报价',
    record_closed: '流程已关闭',
  };

  return labels[type];
}

export async function createWorkflowNotificationLog(input: {
  enterpriseId?: unknown;
  recordId: unknown;
  recipientRole: string;
  recipientStaffId?: unknown;
  channel: 'station' | 'wecom';
  notificationType: WorkflowNotificationType;
  status: 'sent' | 'failed' | 'skipped';
  dedupeKey?: string;
  message?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    return await WorkflowNotificationLog.create({
      enterpriseId: input.enterpriseId as any,
      recordId: input.recordId as any,
      recipientRole: input.recipientRole,
      recipientStaffId: input.recipientStaffId as any,
      channel: input.channel,
      notificationType: input.notificationType,
      status: input.status,
      dedupeKey: input.dedupeKey,
      message: input.message,
      errorMessage: input.errorMessage,
      metadata: input.metadata,
      sentAt: new Date(),
    });
  } catch (error: any) {
    if (error?.code === 11000 && input.dedupeKey) {
      return WorkflowNotificationLog.findOne({ dedupeKey: input.dedupeKey, channel: input.channel });
    }
    throw error;
  }
}

async function resolveRecipientsForRole(record: any, role: string) {
  if (role === 'salesperson' && record.promoterId) {
    const user = await AdminUser.findById(record.promoterId)
      .select('displayName username role wecomUserId enterpriseId')
      .lean();
    return user ? [user] : [];
  }

  if (role === 'measurer' && record.measureTask?.assignedTo) {
    const user = await AdminUser.findById(record.measureTask.assignedTo)
      .select('displayName username role wecomUserId enterpriseId')
      .lean();
    return user ? [user] : [];
  }

  if (role === 'designer' && record.designTask?.assignedTo) {
    const user = await AdminUser.findById(record.designTask.assignedTo)
      .select('displayName username role wecomUserId enterpriseId')
      .lean();
    return user ? [user] : [];
  }

  if ((role === 'enterprise_admin' || role === 'admin' || role === 'super_admin') && record.enterpriseId) {
    return AdminUser.find({
      enterpriseId: record.enterpriseId,
      role: 'enterprise_admin',
      status: 'active',
    })
      .select('displayName username role wecomUserId enterpriseId')
      .lean();
  }

  return [];
}

export async function dispatchWorkflowNotifications(input: {
  record: any;
  notificationType: WorkflowNotificationType;
  recipientRoles: string[];
  message: string;
  dedupeSuffix?: string;
}) {
  const enterprise = input.record.enterpriseId ? await Enterprise.findById(input.record.enterpriseId).lean() : null;
  const automationConfig = getEnterpriseAutomationConfig(enterprise);

  for (const role of input.recipientRoles) {
    const recipients = await resolveRecipientsForRole(input.record, role);
    if (recipients.length === 0) {
      await createWorkflowNotificationLog({
        enterpriseId: input.record.enterpriseId,
        recordId: input.record._id,
        recipientRole: role,
        channel: 'station',
        notificationType: input.notificationType,
        status: 'skipped',
        dedupeKey: `${input.record._id}:${input.notificationType}:${role}:station:${input.dedupeSuffix || 'default'}`,
        message: input.message,
        errorMessage: 'No recipients found',
      });
      continue;
    }

    for (const recipient of recipients) {
      const dedupeBase = `${input.record._id}:${input.notificationType}:${role}:${recipient._id}:${input.dedupeSuffix || 'default'}`;

      await createWorkflowNotificationLog({
        enterpriseId: input.record.enterpriseId,
        recordId: input.record._id,
        recipientRole: role,
        recipientStaffId: recipient._id,
        channel: 'station',
        notificationType: input.notificationType,
        status: 'sent',
        dedupeKey: `${dedupeBase}:station`,
        message: input.message,
        metadata: {
          enterpriseName: input.record.enterpriseName,
          notificationLabel: getNotificationTypeLabel(input.notificationType),
        },
      });

      if (!automationConfig.wecomReminderEnabled) {
        await createWorkflowNotificationLog({
          enterpriseId: input.record.enterpriseId,
          recordId: input.record._id,
          recipientRole: role,
          recipientStaffId: recipient._id,
          channel: 'wecom',
          notificationType: input.notificationType,
          status: 'skipped',
          dedupeKey: `${dedupeBase}:wecom`,
          message: input.message,
          errorMessage: 'WeCom reminders disabled',
        });
        continue;
      }

      const sendResult = await WeComService.sendAppMessageToUsers(
        enterprise,
        [recipient.wecomUserId].filter(Boolean) as string[],
        input.message
      );

      await createWorkflowNotificationLog({
        enterpriseId: input.record.enterpriseId,
        recordId: input.record._id,
        recipientRole: role,
        recipientStaffId: recipient._id,
        channel: 'wecom',
        notificationType: input.notificationType,
        status: sendResult.success ? 'sent' : sendResult.reason === 'missing_config' || sendResult.reason === 'no_recipients' ? 'skipped' : 'failed',
        dedupeKey: `${dedupeBase}:wecom`,
        message: input.message,
        errorMessage: sendResult.success ? undefined : sendResult.reason,
      });
    }
  }
}

async function getReminderState(
  recordId: unknown,
  notificationType: WorkflowNotificationType,
  recipientRole: string,
  recipientStaffId?: unknown
) {
  const logs = await WorkflowNotificationLog.find({
    recordId: recordId as any,
    notificationType,
    recipientRole,
    ...(recipientStaffId ? { recipientStaffId: recipientStaffId as any } : {}),
    channel: 'station',
    status: 'sent',
  })
    .sort({ sentAt: -1 })
    .lean();

  return {
    count: logs.length,
    lastSentAt: logs[0]?.sentAt ? new Date(logs[0].sentAt) : undefined,
  };
}

export async function runWorkflowReminderScan() {
  const now = new Date();
  const records = await PromotionEnterpriseRecord.find({
    businessStage: { $nin: ['paid', 'closed_lost'] },
  }).lean();

  const enterpriseIds = Array.from(
    new Set(records.map((item) => (item.enterpriseId ? String(item.enterpriseId) : '')).filter(Boolean))
  );
  const enterprises = await Enterprise.find({ _id: { $in: enterpriseIds } })
    .select('automationConfig wecomConfig name')
    .lean();
  const enterpriseMap = new Map(enterprises.map((item: any) => [String(item._id), item]));

  let processed = 0;

  for (const record of records) {
    const enterprise = enterpriseMap.get(record.enterpriseId ? String(record.enterpriseId) : '');
    const config = getEnterpriseAutomationConfig(enterprise);

    const followUpDueAt = toDate(record.nextFollowUpAt);
    if (
      record.pendingActionRole === 'salesperson' &&
      record.ownershipStatus !== 'conflict_pending' &&
      followUpDueAt &&
      followUpDueAt.getTime() <= now.getTime()
    ) {
      const state = await getReminderState(record._id, 'follow_up_overdue', 'salesperson', record.promoterId);
      if (
        state.count < config.maxReminderTimes &&
        (!state.lastSentAt || addHours(state.lastSentAt, config.reminderIntervalHours).getTime() <= now.getTime())
      ) {
        await dispatchWorkflowNotifications({
          record,
          notificationType: 'follow_up_overdue',
          recipientRoles: ['salesperson'],
          message: `【跟进超时提醒】${record.enterpriseName} 需要尽快联系，联系人 ${record.contactPerson}，电话 ${record.phone}。`,
          dedupeSuffix: `followup-${state.count + 1}`,
        });
        processed += 1;
      }
    }

    const measureDueAt = toDate(record.measureTask?.dueAt);
    if (
      ['assigned', 'accepted'].includes(record.measureTask?.status) &&
      measureDueAt &&
      measureDueAt.getTime() <= now.getTime()
    ) {
      const state = await getReminderState(record._id, 'measure_overdue', 'measurer', record.measureTask?.assignedTo);
      if (
        state.count < config.maxReminderTimes &&
        (!state.lastSentAt || addHours(state.lastSentAt, config.reminderIntervalHours).getTime() <= now.getTime())
      ) {
        await dispatchWorkflowNotifications({
          record,
          notificationType: 'measure_overdue',
          recipientRoles: ['measurer'],
          message: `【测量任务超时】${record.enterpriseName} 的测量任务已超时，请尽快处理。`,
          dedupeSuffix: `measure-${state.count + 1}`,
        });
        await PromotionEnterpriseRecord.findByIdAndUpdate(record._id, {
          $set: { 'measureTask.lastReminderAt': now },
        });
        processed += 1;
      }
    }

    const designDueAt = toDate(record.designTask?.dueAt);
    if (
      ['assigned', 'in_progress'].includes(record.designTask?.status) &&
      designDueAt &&
      designDueAt.getTime() <= now.getTime()
    ) {
      const state = await getReminderState(record._id, 'design_overdue', 'designer', record.designTask?.assignedTo);
      if (
        state.count < config.maxReminderTimes &&
        (!state.lastSentAt || addHours(state.lastSentAt, config.reminderIntervalHours).getTime() <= now.getTime())
      ) {
        await dispatchWorkflowNotifications({
          record,
          notificationType: 'design_overdue',
          recipientRoles: ['designer'],
          message: `【设计任务超时】${record.enterpriseName} 的设计任务已超时，请尽快推进。`,
          dedupeSuffix: `design-${state.count + 1}`,
        });
        await PromotionEnterpriseRecord.findByIdAndUpdate(record._id, {
          $set: { 'designTask.lastReminderAt': now },
        });
        processed += 1;
      }
    }
  }

  return {
    scanned: records.length,
    processed,
  };
}

export function buildNextFollowUpAt(base: Date, enterprise?: any) {
  return addHours(base, getEnterpriseAutomationConfig(enterprise).followUpSlaHours);
}

export function buildMeasureDueAt(base: Date, enterprise?: any) {
  return addHours(base, getEnterpriseAutomationConfig(enterprise).measureTaskSlaHours);
}

export function buildDesignDueAt(base: Date, enterprise?: any) {
  return addHours(base, getEnterpriseAutomationConfig(enterprise).designTaskSlaHours);
}

export function asObjectId(value?: string | null) {
  return value && mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : undefined;
}
