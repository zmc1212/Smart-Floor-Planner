import { parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository, AdminUserRepository } from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  assignmentCopy,
  buildLeadAssignmentPayload,
  buildNewLeadPayload,
  buildWorkflowTodoPayload,
  type SubscriptionMessagePayload,
} from '@/lib/miniprogram-subscription-messages';
import {
  getMiniProgramSubscriptionTemplate,
  type SubscriptionTemplateConfig,
  type SubscriptionTemplateKind,
} from '@/lib/platform-notification-config';
import { getWechatAccessToken } from '@/lib/wechat-access-token';

export interface SubscriptionMessageData {
  touser: string;
  template_id: string;
  page?: string;
  data: SubscriptionMessagePayload;
  miniprogram_state?: 'developer' | 'trial' | 'formal';
}

export async function sendSubscriptionMessage(params: SubscriptionMessageData) {
  try {
    const token = await getWechatAccessToken();
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          miniprogram_state: process.env.NODE_ENV === 'production' ? 'formal' : 'developer',
        }),
      }
    );
    const data = await response.json();
    if (data.errcode === 0) return { success: true };
    console.error('Failed to send subscription message:', data);
    return { success: false, error: data.errmsg, code: data.errcode };
  } catch (error) {
    console.error('Error sending subscription message:', error);
    return { success: false, error: 'Network error' };
  }
}

interface PromotionNotificationRecord {
  promotionStaffName?: string;
  enterpriseName?: string;
  contactPerson?: string;
  phone?: string;
}

interface LeadNotificationRecord {
  id?: bigint | string;
  enterpriseId?: bigint | string | null;
  name: string;
  phone: string;
  city?: string | null;
  communityName?: string | null;
  assignedAt?: Date | string | null;
  createdAt?: Date | string | null;
  assignedUser?: { displayName?: string | null; username?: string | null } | null;
  promoter?: { displayName?: string | null; username?: string | null } | null;
}

interface LeadNotificationRecipient {
  id: bigint;
  openid?: string | null;
  displayName?: string | null;
  username?: string | null;
}

type LeadDeliveryInput = {
  lead: LeadNotificationRecord;
  recipient: LeadNotificationRecipient;
  templateKind: SubscriptionTemplateKind;
  notificationType: string;
  message: string;
  dedupeKey: string;
  page: string;
  metadata?: Record<string, unknown>;
  buildData: (template: SubscriptionTemplateConfig) => SubscriptionMessagePayload;
};

function deliveryError(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown notification error');
}

async function deliverLeadNotification(input: LeadDeliveryInput) {
  try {
    if (!input.lead.enterpriseId || !input.lead.id) {
      return { success: false, error: 'Lead notification scope is incomplete' };
    }
    const enterpriseId = parsePostgresId(input.lead.enterpriseId, 'lead enterprise id');
    const leadId = parsePostgresId(input.lead.id, 'lead id');
    const metadata = { page: input.page, ...(input.metadata || {}) };
    await withTenantTransaction(enterpriseId, (transaction) =>
      new AcquisitionRepository(transaction).createNotification({
        enterpriseId,
        recipientStaffId: input.recipient.id,
        leadId,
        notificationType: input.notificationType,
        channel: 'in_app',
        status: 'unread',
        message: input.message,
        dedupeKey: input.dedupeKey,
        metadata,
      })
    );
    const wechatLog = await withTenantTransaction(enterpriseId, (transaction) =>
      new AcquisitionRepository(transaction).createNotification({
        enterpriseId,
        recipientStaffId: input.recipient.id,
        leadId,
        notificationType: input.notificationType,
        channel: 'wechat',
        status: 'pending',
        message: input.message,
        dedupeKey: input.dedupeKey,
        metadata,
      })
    );

    if (!wechatLog) return { success: true, deduped: true };

    let result: { success: boolean; error?: string; code?: number };
    try {
      if (!input.recipient.openid) {
        result = { success: false, error: 'openid unavailable' };
      } else {
        const template = await getMiniProgramSubscriptionTemplate(input.templateKind);
        result = template?.templateId
          ? await sendSubscriptionMessage({
              touser: input.recipient.openid,
              template_id: template.templateId,
              page: input.page,
              data: input.buildData(template),
            })
          : { success: false, error: 'Mini Program subscription template is not configured' };
      }
    } catch (error) {
      result = { success: false, error: deliveryError(error) };
    }

    const errorMessage = result.success
      ? null
      : [result.code, result.error].filter(Boolean).join(': ') || 'Subscription delivery failed';
    await withTenantTransaction(enterpriseId, (transaction) =>
      new AcquisitionRepository(transaction).markNotificationSent(
        wechatLog.id,
        result.success ? 'sent' : input.recipient.openid ? 'failed' : 'skipped',
        errorMessage
      )
    );
    return result;
  } catch (error) {
    console.error('Lead notification delivery failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

function leadOwnerName(lead: LeadNotificationRecord) {
  return (
    lead.assignedUser?.displayName ||
    lead.assignedUser?.username ||
    lead.promoter?.displayName ||
    lead.promoter?.username ||
    '待分配'
  );
}

export async function notifyPlatformAdminOfNewReport(record: PromotionNotificationRecord) {
  try {
    const [template, admins] = await Promise.all([
      getMiniProgramSubscriptionTemplate('workflow_todo'),
      withPlatformTransaction(async (transaction) =>
        (
          await new AdminUserRepository(transaction).list({
            roles: ['super_admin', 'admin'],
            status: 'active',
            page: 1,
            limit: 1000,
          })
        ).rows.filter((admin) => admin.openid)
      ),
    ]);
    for (const admin of admins) {
      if (!admin.openid || !template.templateId) continue;
      await sendSubscriptionMessage({
        touser: admin.openid,
        template_id: template.templateId,
        page: '/pages/index/index',
        data: buildWorkflowTodoPayload(template, {
          projectName: record.enterpriseName,
          owner: admin.displayName || admin.username,
          currentStatus: '待跟进',
          todo: '审核企业报备',
          note: record.contactPerson || record.promotionStaffName || '请及时处理',
        }),
      });
    }
  } catch (error) {
    console.error('Platform report notification failed:', error);
  }
}

export async function notifyEnterpriseAdminOfNewLead(lead: LeadNotificationRecord) {
  if (!lead.enterpriseId || !lead.id) return { success: false, error: 'Lead scope unavailable' };
  try {
    const admins = await withTenantTransaction(
      parsePostgresId(lead.enterpriseId, 'lead enterprise id'),
      async (transaction) =>
        (
          await new AdminUserRepository(transaction).list({
            roles: ['enterprise_admin'],
            status: 'active',
            page: 1,
            limit: 1000,
          })
        ).rows
    );
    const results = await Promise.all(
      admins.map((admin) =>
        deliverLeadNotification({
          lead,
          recipient: admin,
          templateKind: 'new_lead',
          notificationType: 'lead_created',
          message: `新增客户：${lead.name}，负责人：${leadOwnerName(lead)}`,
          dedupeKey: `lead_created:${String(lead.id)}:${admin.id.toString()}`,
          page: '/pages/leads-management/leads-management',
          buildData: (template) =>
            buildNewLeadPayload(template, {
              customerName: lead.name,
              addedAt: lead.createdAt,
              owner: leadOwnerName(lead),
              phone: lead.phone,
              selectedAt: lead.assignedAt || lead.createdAt,
            }),
        })
      )
    );
    return { success: results.every((item) => item.success), results };
  } catch (error) {
    console.error('Enterprise lead notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyEnterpriseAdminOfAssignmentPending(
  lead: LeadNotificationRecord,
  input: { reasonCode: string; eventKey: string }
) {
  if (!lead.enterpriseId || !lead.id) {
    return { success: false, error: 'Lead scope unavailable' };
  }
  try {
    const admins = await withTenantTransaction(
      parsePostgresId(lead.enterpriseId, 'lead enterprise id'),
      async (transaction) =>
        (
          await new AdminUserRepository(transaction).list({
            roles: ['enterprise_admin'],
            status: 'active',
            page: 1,
            limit: 1000,
          })
        ).rows
    );
    const results = await Promise.all(
      admins.map((admin) =>
        deliverLeadNotification({
          lead,
          recipient: admin,
          templateKind: 'workflow_todo',
          notificationType: 'lead_assignment_pending',
          message: `客户${lead.name}自动派单待处理，请补充可用人员`,
          dedupeKey: `lead_assignment_pending:${String(lead.id)}:${admin.id.toString()}:${input.eventKey}`,
          page: '/pages/leads-management/leads-management',
          metadata: { reasonCode: input.reasonCode },
          buildData: (template) =>
            buildWorkflowTodoPayload(template, {
              projectName: lead.communityName || lead.name,
              owner: admin.displayName || admin.username,
              currentStatus: '派单待处理',
              todo: '补充设计师或测量员',
              note: input.reasonCode,
            }),
        })
      )
    );
    return { success: results.every((item) => item.success), results };
  } catch (error) {
    console.error('Pending assignment notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

async function findNotificationRecipient(id: string, label: string) {
  try {
    return await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).findById(parsePostgresId(id, label))
    );
  } catch (error) {
    console.error(`Unable to resolve ${label} for notification:`, error);
    return null;
  }
}

export async function notifyDesignerOfAssignedLead(lead: LeadNotificationRecord, designerId: string) {
  const designer = await findNotificationRecipient(designerId, 'designer id');
  if (!designer) return { success: false, error: 'designer unavailable' };
  const copy = assignmentCopy('lead_assigned');
  return deliverLeadNotification({
    lead,
    recipient: designer,
    templateKind: 'lead_assignment',
    notificationType: 'lead_assigned',
    message: `客户${lead.name}已指派，请尽快跟进`,
    dedupeKey: `lead_assigned:${String(lead.id)}:${designer.id.toString()}`,
    page: '/pages/leads-management/leads-management',
    buildData: (template) => buildLeadAssignmentPayload(template, {
      customerName: lead.name,
      customerStatus: copy.status,
      note: copy.note,
      assignedAt: lead.assignedAt || lead.createdAt,
    }),
  });
}

export async function notifyDesignerOfPendingLead(lead: LeadNotificationRecord, designerId: string) {
  const designer = await findNotificationRecipient(designerId, 'designer id');
  if (!designer) return { success: false, error: 'designer unavailable' };
  const copy = assignmentCopy('lead_pending_acquisition');
  const page = `/packages/business/acquisition-center/acquisition-center?leadId=${encodeURIComponent(String(lead.id || ''))}`;
  return deliverLeadNotification({
    lead,
    recipient: designer,
    templateKind: 'lead_assignment',
    notificationType: 'lead_pending_acquisition',
    message: `收到客户线索：${lead.name}，待确认获客`,
    dedupeKey: `lead_pending_acquisition:${String(lead.id)}`,
    page,
    buildData: (template) => buildLeadAssignmentPayload(template, {
      customerName: lead.name,
      customerStatus: copy.status,
      note: copy.note,
      assignedAt: lead.assignedAt || lead.createdAt,
    }),
  });
}

export async function notifyMeasurerOfAcquiredLead(
  lead: LeadNotificationRecord,
  measurerId: string,
  commissionId?: string
) {
  const measurer = await findNotificationRecipient(measurerId, 'measurer id');
  if (!measurer) return { success: false, error: 'measurer unavailable' };
  const page = `/packages/business/acquisition-center/acquisition-center?leadId=${encodeURIComponent(String(lead.id || ''))}`;
  return deliverLeadNotification({
    lead,
    recipient: measurer,
    templateKind: 'workflow_todo',
    notificationType: 'lead_acquired_commission_pending',
    message: `设计师已确认${lead.name}获客，提成待结算`,
    dedupeKey: `lead_acquired_commission_pending:${String(lead.id)}`,
    page,
    metadata: { commissionId: commissionId || null },
    buildData: (template) => buildWorkflowTodoPayload(template, {
      projectName: lead.communityName || lead.name,
      owner: measurer.displayName || measurer.username,
      currentStatus: '待结算',
      todo: '查看获客提成',
      note: `客户：${lead.name}`,
    }),
  });
}
