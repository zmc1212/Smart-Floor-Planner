import {
  eq,
  inArray,
  lte,
  notInArray,
} from 'drizzle-orm';
import {
  AdminUserRepository,
  EnterpriseRepository,
  PromotionRecordRepository,
  WorkflowNotificationRepository,
  type PromotionRecord,
  type PromotionRecordWithRelations,
} from '@/db/repositories';
import {
  enterprises,
  promotionEnterpriseRecords,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import { sendSubscriptionMessage } from '@/lib/wechat-notification';
import {
  getMiniProgramSubscriptionTemplate,
} from '@/lib/platform-notification-config';
import {
  buildWorkflowNotificationPayload,
  resolveWorkflowTemplateKind,
} from '@/lib/miniprogram-subscription-messages';
import { expireOverdueAppointmentsAndNotify } from '@/lib/appointment-expiry';
import type { PromotionNotificationJob } from '@/lib/postgres-promotion-workflow';

export const DEFAULT_AUTOMATION_CONFIG = {
  followUpSlaHours: 24,
  measureTaskSlaHours: 48,
  designTaskSlaHours: 72,
  reminderIntervalHours: 24,
  maxReminderTimes: 3,
  miniprogramNotificationEnabled: true,
};

export type WorkflowNotificationChannel = 'station' | 'miniprogram_sub';
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

export function getEnterpriseAutomationConfig(enterprise?: {
  automationConfig?: Record<string, unknown> | null;
} | null) {
  return {
    ...DEFAULT_AUTOMATION_CONFIG,
    ...(enterprise?.automationConfig || {}),
  };
}

function isRecordClosed(record: PromotionRecord) {
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
  record: PromotionRecord,
  role: string,
  type: string,
  title: string,
  summary: string,
  dueAt?: Date
): WorkbenchTodoItem {
  const overdue = !!(dueAt && dueAt.getTime() < Date.now());
  return {
    key: `${record.id.toString()}:${role}:${type}`,
    recordId: record.id.toString(),
    enterpriseId: record.enterpriseId?.toString(),
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

export function buildTodoItemsForRecord(
  record: PromotionRecord,
  role: string,
  enterprise?: { automationConfig?: Record<string, unknown> | null } | null
) {
  if (!record || isRecordClosed(record)) return [];
  const automation = getEnterpriseAutomationConfig(enterprise);
  const recordCreatedAt = toDate(record.createdAt) || new Date();
  const lastActivityAt =
    toDate(record.lastActivityAt) || toDate(record.updatedAt) || recordCreatedAt;
  const nextFollowUpAt = toDate(record.nextFollowUpAt);
  const measureDueAt = toDate(record.measureDueAt);
  const designDueAt = toDate(record.designDueAt);
  const items: WorkbenchTodoItem[] = [];

  if (role === 'salesperson') {
    if (record.ownershipStatus === 'conflict_pending') return items;
    if (record.pendingActionRole === 'salesperson' || record.businessStage === 'quoted') {
      const dueAt = nextFollowUpAt || addHours(lastActivityAt, Number(automation.followUpSlaHours));
      items.push(
        buildTodo(
          record,
          role,
          record.businessStage === 'quoted' ? 'quote_follow_up' : 'follow_up',
          record.businessStage === 'quoted' ? 'Quotation follow-up' : 'Customer follow-up',
          `${record.contactPerson} / ${record.phone}`,
          dueAt
        )
      );
    }
    const protectionExpires = toDate(record.protectionExpiresAt);
    if (protectionExpires && record.poolStatus === 'protected') {
      const daysLeft = Math.ceil(
        (protectionExpires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );
      if (daysLeft > 0 && daysLeft <= 7) {
        items.push(
          buildTodo(
            record,
            role,
            'protection_expiring',
            `Protection expires in ${daysLeft} day(s)`,
            `${record.enterpriseName} requires follow-up`,
            protectionExpires
          )
        );
      }
    }
    return items;
  }

  if (role === 'measurer') {
    if (['assigned', 'accepted'].includes(record.measureTaskStatus)) {
      items.push(
        buildTodo(
          record,
          role,
          'measure_task',
          record.measureTaskStatus === 'assigned' ? 'Accept measurement task' : 'Measurement in progress',
          `${record.enterpriseName} / ${record.contactPerson}`,
          measureDueAt
        )
      );
    }
    return items;
  }

  if (role === 'designer') {
    if (['assigned', 'in_progress'].includes(record.designTaskStatus)) {
      items.push(
        buildTodo(
          record,
          role,
          'design_task',
          record.designTaskStatus === 'assigned' ? 'Start design task' : 'Design in progress',
          `${record.enterpriseName} / ${record.contactPerson}`,
          designDueAt
        )
      );
    }
    return items;
  }

  if (['enterprise_admin', 'admin', 'super_admin'].includes(role)) {
    if (record.ownershipStatus === 'conflict_pending') {
      items.push(
        buildTodo(
          record,
          role,
          'conflict_pending',
          'Resolve ownership conflict',
          `${record.enterpriseName} has duplicate reports`,
          addHours(recordCreatedAt, Number(automation.followUpSlaHours))
        )
      );
    }
    if (record.businessStage === 'measuring' && record.measureTaskStatus === 'unassigned') {
      items.push(
        buildTodo(
          record,
          role,
          'assign_measurer',
          'Assign measurer',
          `${record.enterpriseName} has no measurer`,
          addHours(lastActivityAt, Number(automation.followUpSlaHours))
        )
      );
    }
    if (record.measureTaskStatus === 'submitted' && record.designTaskStatus === 'unassigned') {
      items.push(
        buildTodo(
          record,
          role,
          'assign_designer',
          'Assign designer',
          `${record.enterpriseName} measurement result is ready`,
          addHours(toDate(record.measureSubmittedAt) || lastActivityAt, Number(automation.followUpSlaHours))
        )
      );
    }
    if (record.businessStage === 'quoted') {
      items.push(
        buildTodo(
          record,
          role,
          'quote_follow_up',
          'Quotation follow-up',
          `${record.enterpriseName} design is complete`,
          nextFollowUpAt || addHours(toDate(record.designCompletedAt) || lastActivityAt, Number(automation.followUpSlaHours))
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
    return !!todo.dueAt && sameDay(new Date(todo.dueAt), new Date());
  }
  return true;
}

async function withRecordScope<T>(
  record: { enterpriseId?: bigint | null } | { enterpriseId: bigint | null },
  callback: (transaction: PostgresTransaction) => Promise<T>
) {
  return record.enterpriseId
    ? withTenantTransaction(record.enterpriseId, callback)
    : withPlatformTransaction(callback);
}

async function enterpriseConfigMap(
  transaction: PostgresTransaction,
  records: PromotionRecord[]
) {
  const ids = Array.from(
    new Set(
      records
        .map((record) => record.enterpriseId)
        .filter((id): id is bigint => id !== null)
    )
  );
  if (ids.length === 0) return new Map<bigint, { automationConfig: Record<string, unknown> | null }>();
  const rows = await transaction
    .select({ id: enterprises.id, automationConfig: enterprises.automationConfig })
    .from(enterprises)
    .where(inArray(enterprises.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listWorkbenchTodos(input: {
  role: string;
  userId?: string | null;
  enterpriseId?: string | null;
  view?: WorkbenchTodoView;
}) {
  const enterpriseId = input.enterpriseId ? parsePostgresId(input.enterpriseId, 'enterpriseId') : null;
  const execute = async (transaction: PostgresTransaction) => {
    const actor =
      input.userId && ['salesperson', 'measurer', 'designer'].includes(input.role)
        ? { id: parsePostgresId(input.userId, 'userId'), role: input.role }
        : undefined;
    const { rows } = await new PromotionRecordRepository(transaction).list({ actor, limit: 200 });
    const configs = await enterpriseConfigMap(transaction, rows);
    return rows
      .flatMap((record) =>
        buildTodoItemsForRecord(record, input.role, record.enterpriseId ? configs.get(record.enterpriseId) : null)
      )
      .filter((todo) => matchesTodoView(todo, input.view || 'mine'))
      .sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
  };
  return enterpriseId ? withTenantTransaction(enterpriseId, execute) : withPlatformTransaction(execute);
}

export async function createWorkflowNotificationLog(input: {
  enterpriseId?: unknown;
  recordId: unknown;
  recipientRole: string;
  recipientStaffId?: unknown;
  channel: WorkflowNotificationChannel;
  notificationType: WorkflowNotificationType;
  status: WorkflowNotificationStatus;
  dedupeKey?: string;
  message?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  const enterpriseId =
    input.enterpriseId === undefined || input.enterpriseId === null || input.enterpriseId === ''
      ? null
      : parsePostgresId(input.enterpriseId, 'enterpriseId');
  const execute = (transaction: PostgresTransaction) =>
    new WorkflowNotificationRepository(transaction).create({
      enterpriseId,
      recordId: parsePostgresId(input.recordId, 'recordId'),
      recipientRole: input.recipientRole,
      recipientStaffId:
        input.recipientStaffId === undefined || input.recipientStaffId === null || input.recipientStaffId === ''
          ? null
          : parsePostgresId(input.recipientStaffId, 'recipientStaffId'),
      channel: input.channel,
      notificationType: input.notificationType,
      status: input.status,
      dedupeKey: input.dedupeKey,
      message: input.message,
      errorMessage: input.errorMessage,
      metadata: input.metadata,
      sentAt: input.status === 'sent' ? new Date() : null,
    });
  return enterpriseId ? withTenantTransaction(enterpriseId, execute) : withPlatformTransaction(execute);
}

async function resolveRecipientsForRole(record: PromotionRecord, role: string) {
  const execute = async (transaction: PostgresTransaction) => {
    const users = new AdminUserRepository(transaction);
    if (role === 'salesperson' && record.promoterId) {
      const user = await users.findById(record.promoterId);
      return user && user.status === 'active' ? [user] : [];
    }
    if (role === 'measurer' && record.measureAssignedTo) {
      const user = await users.findById(record.measureAssignedTo);
      return user && user.status === 'active' ? [user] : [];
    }
    if (role === 'designer' && record.designAssignedTo) {
      const user = await users.findById(record.designAssignedTo);
      return user && user.status === 'active' ? [user] : [];
    }
    if (role === 'admin' || role === 'super_admin') {
      const result = await users.list({ roles: [role], status: 'active', limit: 1000 });
      return result.rows;
    }
    if (role === 'enterprise_admin' && record.enterpriseId) {
      const result = await users.list({ roles: ['enterprise_admin'], status: 'active', limit: 1000 });
      return result.rows;
    }
    return [];
  };
  return role === 'admin' || role === 'super_admin'
    ? withPlatformTransaction(execute)
    : withRecordScope(record, execute);
}

function notificationLabel(type: WorkflowNotificationType) {
  const labels: Record<WorkflowNotificationType, string> = {
    follow_up_created: 'New follow-up',
    follow_up_overdue: 'Follow-up overdue',
    conflict_pending: 'Ownership conflict',
    measure_assigned: 'Measurement assigned',
    measure_overdue: 'Measurement overdue',
    measure_submitted: 'Measurement submitted',
    design_assigned: 'Design assigned',
    design_overdue: 'Design overdue',
    design_completed: 'Design completed',
    record_closed: 'Workflow closed',
  };
  return labels[type];
}

async function recordAutomationConfig(record: PromotionRecord) {
  if (!record.enterpriseId) return getEnterpriseAutomationConfig();
  return withTenantTransaction(record.enterpriseId, async (transaction) => {
    const enterprise = await new EnterpriseRepository(transaction).findById(record.enterpriseId!);
    return getEnterpriseAutomationConfig(enterprise);
  });
}

export async function dispatchWorkflowNotifications(input: {
  record: PromotionRecord | PromotionRecordWithRelations;
  notificationType: WorkflowNotificationType;
  recipientRoles: string[];
  message: string;
  dedupeSuffix?: string;
}) {
  const record = input.record as PromotionRecord;
  const automation = await recordAutomationConfig(record);
  const template = automation.miniprogramNotificationEnabled
    ? await getMiniProgramSubscriptionTemplate(
        resolveWorkflowTemplateKind(input.notificationType)
      )
    : null;
  for (const role of input.recipientRoles) {
    const recipients = await resolveRecipientsForRole(record, role);
    if (recipients.length === 0) {
      await createWorkflowNotificationLog({
        enterpriseId: record.enterpriseId,
        recordId: record.id,
        recipientRole: role,
        channel: 'station',
        notificationType: input.notificationType,
        status: 'skipped',
        dedupeKey: `${record.id}:${input.notificationType}:${role}:station:${input.dedupeSuffix || 'default'}`,
        message: input.message,
        errorMessage: 'No recipients found',
      });
      continue;
    }
    for (const recipient of recipients) {
      const dedupeBase = `${record.id}:${input.notificationType}:${role}:${recipient.id}:${input.dedupeSuffix || 'default'}`;
      await createWorkflowNotificationLog({
        enterpriseId: record.enterpriseId,
        recordId: record.id,
        recipientRole: role,
        recipientStaffId: recipient.id,
        channel: 'station',
        notificationType: input.notificationType,
        status: 'sent',
        dedupeKey: `${dedupeBase}:station`,
        message: input.message,
        metadata: {
          enterpriseName: record.enterpriseName,
          notificationLabel: notificationLabel(input.notificationType),
        },
      });
      if (!recipient.openid) {
        await createWorkflowNotificationLog({
          enterpriseId: record.enterpriseId,
          recordId: record.id,
          recipientRole: role,
          recipientStaffId: recipient.id,
          channel: 'miniprogram_sub',
          notificationType: input.notificationType,
          status: 'skipped',
          dedupeKey: `${dedupeBase}:miniprogram_sub`,
          message: input.message,
          errorMessage: 'openid unavailable',
        });
        continue;
      }
      if (!automation.miniprogramNotificationEnabled) {
        await createWorkflowNotificationLog({
          enterpriseId: record.enterpriseId,
          recordId: record.id,
          recipientRole: role,
          recipientStaffId: recipient.id,
          channel: 'miniprogram_sub',
          notificationType: input.notificationType,
          status: 'skipped',
          dedupeKey: `${dedupeBase}:miniprogram_sub`,
          message: input.message,
          errorMessage: 'Mini Program notifications disabled',
        });
        continue;
      }
      if (!template?.templateId) {
        await createWorkflowNotificationLog({
          enterpriseId: record.enterpriseId,
          recordId: record.id,
          recipientRole: role,
          recipientStaffId: recipient.id,
          channel: 'miniprogram_sub',
          notificationType: input.notificationType,
          status: 'skipped',
          dedupeKey: `${dedupeBase}:miniprogram_sub`,
          message: input.message,
          errorMessage: 'Mini Program subscription template is not configured',
        });
        continue;
      }
      const subResult = await sendSubscriptionMessage({
        touser: recipient.openid,
        template_id: template.templateId,
        page: '/pages/leads-management/leads-management',
        data: buildWorkflowNotificationPayload({
          template,
          notificationType: input.notificationType,
          record,
          recipientName: recipient.displayName || recipient.username,
          message: input.message,
        }),
      });
      await createWorkflowNotificationLog({
        enterpriseId: record.enterpriseId,
        recordId: record.id,
        recipientRole: role,
        recipientStaffId: recipient.id,
        channel: 'miniprogram_sub',
        notificationType: input.notificationType,
        status: subResult.success ? 'sent' : 'failed',
        dedupeKey: `${dedupeBase}:miniprogram_sub`,
        message: input.message,
        errorMessage: subResult.success ? undefined : subResult.error,
      });
    }
  }
}

export async function runWorkflowReminderScan() {
  const now = new Date();
  // Current referrer-network matrix: only appointment expiry belongs in this cron.
  // Legacy promotion follow-up / measureDueAt / designDueAt / protection-pool nudges are retired.
  const appointments = await expireOverdueAppointmentsAndNotify({ now });
  return {
    scanned: 0,
    processed: 0,
    protectionReleased: 0,
    expiredAppointments: appointments.expired,
  };
}

export async function runProtectionExpiryScan() {
  const now = new Date();
  const { rows } = await withPlatformTransaction((transaction) =>
    new PromotionRecordRepository(transaction).list({ poolStatuses: ['protected'], limit: 200 })
  );
  let released = 0;
  for (const record of rows) {
    if (
      !record.protectionExpiresAt ||
      record.protectionExpiresAt.getTime() > now.getTime() ||
      isRecordClosed(record)
    ) {
      continue;
    }
    const updated = await withRecordScope(record, (transaction) =>
      new PromotionRecordRepository(transaction).updateWhere(
        record.id,
        [
          eq(promotionEnterpriseRecords.poolStatus, 'protected'),
          lte(promotionEnterpriseRecords.protectionExpiresAt, now),
          notInArray(promotionEnterpriseRecords.businessStage, ['paid', 'closed_lost']),
        ],
        {
          promoterId: null,
          poolStatus: 'in_pool',
          ownershipStatus: 'unassigned',
          pendingActionRole: 'none',
          lastActivityAt: now,
          protectionExpiresAt: null,
          protectionExtendedCount: 0,
          nextFollowUpAt: null,
          claimStatus: null,
          claimRequestedBy: null,
          claimRequestedAt: null,
          claimReviewedBy: null,
          claimReviewedAt: null,
          claimRejectReason: null,
        },
        [
          {
            type: 'pool_auto_released',
            content: 'Automatically released to pool',
            operator: 'System',
            operatorRole: 'system',
            metadata: record.promoterId
              ? { previousPromoterId: record.promoterId.toString() }
              : undefined,
            createdAt: now,
          },
        ]
      )
    );
    if (!updated) continue;
    released += 1;
  }
  return { scanned: rows.length, released };
}

export function buildNextFollowUpAt(base: Date, enterprise?: { automationConfig?: Record<string, unknown> | null }) {
  return addHours(base, Number(getEnterpriseAutomationConfig(enterprise).followUpSlaHours));
}

export function buildMeasureDueAt(base: Date, enterprise?: { automationConfig?: Record<string, unknown> | null }) {
  return addHours(base, Number(getEnterpriseAutomationConfig(enterprise).measureTaskSlaHours));
}

export function buildDesignDueAt(base: Date, enterprise?: { automationConfig?: Record<string, unknown> | null }) {
  return addHours(base, Number(getEnterpriseAutomationConfig(enterprise).designTaskSlaHours));
}

export function isPromotionNotificationJob(value: unknown): value is PromotionNotificationJob {
  return !!value && typeof value === 'object';
}
