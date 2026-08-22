import { parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  LeadCommissionRepository,
  LeadRepository,
  MiniProgramIdentityRepository,
  StaffNotificationRepository,
  UserRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  assignmentCopy,
  buildDesignPublishedPayload,
  buildEnterpriseJoinResultPayload,
  buildLeadAssignmentPayload,
  buildLeadConvertedPayload,
  buildMeasurementAppointmentPayload,
  buildNewLeadPayload,
  buildSigningCommissionPayload,
  buildWorkflowTodoPayload,
  formatWeChatAmount,
  type SubscriptionMessagePayload,
} from '@/lib/miniprogram-subscription-messages';
import {
  getMiniProgramSubscriptionTemplate,
  getPlatformNotificationConfig,
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
    const config = await getPlatformNotificationConfig();
    if (!config.subscriptionMessagesEnabled) {
      return { success: false, skipped: true, error: 'subscription messages disabled' };
    }
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

/** Staff deep link into the lead detail page (designer / measurer / enterprise admin). */
function staffLeadDetailPage(leadId: bigint | string) {
  return `/packages/business/lead-detail/lead-detail?id=${encodeURIComponent(String(leadId))}`;
}

/** Customer deep link into the owned project archive. */
function customerProjectPage(leadId: bigint | string) {
  return `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(String(leadId))}`;
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
      new StaffNotificationRepository(transaction).create({
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
      new StaffNotificationRepository(transaction).create({
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
      new StaffNotificationRepository(transaction).markSent(
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
      admins.map(async (admin) => {
        const recipient = await enrichRecipientOpenid(admin);
        return deliverLeadNotification({
          lead,
          recipient,
          templateKind: 'new_lead',
          notificationType: 'lead_created',
          message: `新增客户：${lead.name}，负责人：${leadOwnerName(lead)}`,
          dedupeKey: `lead_created:${String(lead.id)}:${admin.id.toString()}`,
          page: staffLeadDetailPage(lead.id!),
          buildData: (template) =>
            buildNewLeadPayload(template, {
              customerName: lead.name,
              addedAt: lead.createdAt,
              owner: leadOwnerName(lead),
              phone: lead.phone,
              selectedAt: lead.assignedAt || lead.createdAt,
            }),
        });
      })
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
      admins.map(async (admin) => {
        const recipient = await enrichRecipientOpenid(admin);
        return deliverLeadNotification({
          lead,
          recipient,
          templateKind: 'workflow_todo',
          notificationType: 'lead_assignment_pending',
          message: `客户${lead.name}自动派单待处理，请补充可用人员`,
          dedupeKey: `lead_assignment_pending:${String(lead.id)}:${admin.id.toString()}:${input.eventKey}`,
          page: staffLeadDetailPage(lead.id!),
          metadata: { reasonCode: input.reasonCode },
          buildData: (template) =>
            buildWorkflowTodoPayload(template, {
              projectName: lead.communityName || lead.name,
              owner: admin.displayName || admin.username,
              currentStatus: '派单待处理',
              todo: '补充设计师或测量员',
              note: input.reasonCode,
            }),
        });
      })
    );
    return { success: results.every((item) => item.success), results };
  } catch (error) {
    console.error('Pending assignment notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

async function enrichRecipientOpenid(
  recipient: LeadNotificationRecipient & { userId?: bigint | null; openid?: string | null }
): Promise<LeadNotificationRecipient> {
  if (recipient.openid) {
    return {
      id: recipient.id,
      openid: recipient.openid,
      displayName: recipient.displayName,
      username: recipient.username,
    };
  }
  if (!recipient.userId) {
    return {
      id: recipient.id,
      openid: recipient.openid ?? null,
      displayName: recipient.displayName,
      username: recipient.username,
    };
  }
  try {
    const identity = await withPlatformTransaction((transaction) =>
      new MiniProgramIdentityRepository(transaction).findWechatIdentityByUserId(recipient.userId!)
    );
    return {
      id: recipient.id,
      openid: identity?.openid ?? null,
      displayName: recipient.displayName,
      username: recipient.username,
    };
  } catch (error) {
    console.error('Unable to resolve wechat identity for notification recipient:', error);
    return {
      id: recipient.id,
      openid: null,
      displayName: recipient.displayName,
      username: recipient.username,
    };
  }
}

async function findNotificationRecipient(id: string, label: string) {
  try {
    const staff = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).findById(parsePostgresId(id, label))
    );
    if (!staff) return null;
    return enrichRecipientOpenid(staff);
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
    page: staffLeadDetailPage(lead.id!),
    buildData: (template) => buildLeadAssignmentPayload(template, {
      customerName: lead.name,
      customerStatus: copy.status,
      note: copy.note,
      assignedAt: lead.assignedAt || lead.createdAt,
    }),
  });
}

export async function notifyAppointmentStaff(input: {
  enterpriseId: bigint;
  leadId: bigint;
  designerId: bigint;
  measurerId: bigint;
  address: string;
  startsAt: Date;
  eventKey: string;
  eventType: 'created' | 'customer_rescheduled' | 'internal_rescheduled' | 'cancelled' | 'expired';
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead) return { success: false, error: 'lead unavailable' };
    const recipients = await Promise.all([
      findNotificationRecipient(input.designerId.toString(), 'designer id'),
      findNotificationRecipient(input.measurerId.toString(), 'measurer id'),
    ]);
    const action = input.eventType === 'cancelled'
      ? '预约已取消'
      : input.eventType === 'expired'
        ? '预约已过期，请重新预约'
        : input.eventType === 'created' ? '已创建上门预约' : '预约时间已更新';
    const recipientIds = new Set<string>();
    const uniqueRecipients: LeadNotificationRecipient[] = [];
    for (const recipient of recipients) {
      if (!recipient) continue;
      const key = recipient.id.toString();
      if (recipientIds.has(key)) continue;
      recipientIds.add(key);
      uniqueRecipients.push(recipient);
    }
    const results = await Promise.all(uniqueRecipients.map((recipient) =>
      deliverLeadNotification({
        lead: { ...lead, id: lead.id, enterpriseId: lead.enterpriseId?.toString() },
        recipient, templateKind: 'measurement_appointment', notificationType: `measurement_appointment_${input.eventType}`,
        message: `客户${lead.name}${action}`,
        dedupeKey: `measurement_appointment:${input.eventKey}:${recipient.id.toString()}`,
        page: staffLeadDetailPage(input.leadId),
        metadata: { appointmentEvent: input.eventType },
        buildData: (template) => buildMeasurementAppointmentPayload(template, {
          customerName: lead.name, phone: lead.phone, community: input.address,
          measurementAt: input.startsAt, reminder: input.eventType === 'cancelled' ? '预约已取消' : input.eventType === 'expired' ? '请重新预约上门' : '请按时到场',
        }),
      })
    ));
    return { success: results.every((result) => result.success), results };
  } catch (error) {
    console.error('Appointment notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyCustomerOfAppointment(input: {
  enterpriseId: bigint;
  leadId: bigint;
  address: string;
  startsAt: Date;
  eventType: 'created' | 'customer_rescheduled' | 'internal_rescheduled' | 'cancelled' | 'expired';
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead?.customerUserId) return { success: false, skipped: true, error: 'customer unavailable' };

    const identity = await withPlatformTransaction((transaction) =>
      new MiniProgramIdentityRepository(transaction).findWechatIdentityByUserId(lead.customerUserId!)
    );
    if (!identity?.openid) return { success: false, skipped: true, error: 'customer openid unavailable' };

    const template = await getMiniProgramSubscriptionTemplate('measurement_appointment');
    if (!template?.templateId) return { success: false, skipped: true, error: 'subscription template unavailable' };

    const action = input.eventType === 'cancelled'
      ? '预约已取消'
      : input.eventType === 'expired'
        ? '预约已过期，请重新预约'
        : input.eventType === 'created'
        ? '上门量房已预约'
        : '预约时间已更新';
    return await sendSubscriptionMessage({
      touser: identity.openid,
      template_id: template.templateId,
      page: customerProjectPage(input.leadId),
      data: buildMeasurementAppointmentPayload(template, {
        customerName: lead.name,
        phone: lead.phone,
        community: input.address,
        measurementAt: input.startsAt,
        reminder: action,
      }),
    });
  } catch (error) {
    console.error('Customer appointment notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyCustomerOfDesignPublished(input: {
  enterpriseId: bigint;
  leadId: bigint;
  generationIds: Array<bigint | string>;
  title?: string | null;
  publishedAt?: Date | string | null;
}) {
  try {
    const generationIds = input.generationIds
      .map((id) => String(id))
      .filter(Boolean);
    if (!generationIds.length) {
      return { success: false, skipped: true, error: 'generation unavailable' };
    }

    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead?.customerUserId) {
      return { success: false, skipped: true, error: 'customer unavailable' };
    }

    const identity = await withPlatformTransaction((transaction) =>
      new MiniProgramIdentityRepository(transaction).findWechatIdentityByUserId(lead.customerUserId!)
    );
    if (!identity?.openid) {
      return { success: false, skipped: true, error: 'customer openid unavailable' };
    }

    const template = await getMiniProgramSubscriptionTemplate('design_published');
    if (!template?.templateId) {
      return { success: false, skipped: true, error: 'subscription template unavailable' };
    }

    const page = customerProjectPage(input.leadId);
    return await sendSubscriptionMessage({
      touser: identity.openid,
      template_id: template.templateId,
      page,
      data: buildDesignPublishedPayload(template, {
        content: input.title || '设计方案',
        publishedAt: input.publishedAt || new Date(),
        note: '请到项目页查看效果图',
      }),
    });
  } catch (error) {
    console.error('Customer design publication notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyDesignerOfSurveyCompleted(input: {
  enterpriseId: bigint;
  leadId: bigint;
  designerId: bigint | string;
  floorPlanId: bigint | string;
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead) return { success: false, error: 'lead unavailable' };
    const designer = await findNotificationRecipient(String(input.designerId), 'designer id');
    if (!designer) return { success: false, error: 'designer unavailable' };
    return deliverLeadNotification({
      lead: { ...lead, id: lead.id, enterpriseId: lead.enterpriseId?.toString() },
      recipient: designer,
      templateKind: 'workflow_todo',
      notificationType: 'survey_completed',
      message: `客户${lead.name}量房已完成，请生成并发布方案`,
      dedupeKey: `survey_completed:${input.leadId.toString()}:${String(input.floorPlanId)}`,
      page: staffLeadDetailPage(input.leadId),
      metadata: { floorPlanId: String(input.floorPlanId) },
      buildData: (template) =>
        buildWorkflowTodoPayload(template, {
          projectName: lead.communityName || lead.name,
          owner: designer.displayName || designer.username,
          currentStatus: '量房完成',
          todo: '生成并发布方案',
          note: '正式户型已提交',
        }),
    });
  } catch (error) {
    console.error('Survey completed notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyEnterpriseContactOfJoinResult(input: {
  enterpriseName: string;
  contactPerson?: { name?: unknown; phone?: unknown } | null;
  appliedAt?: Date | string | null;
  result: 'approved' | 'rejected';
}) {
  try {
    const phone =
      typeof input.contactPerson?.phone === 'string'
        ? input.contactPerson.phone.trim()
        : '';
    if (!phone) {
      return { success: false, skipped: true, error: 'contact phone unavailable' };
    }

    const user = await withPlatformTransaction((transaction) =>
      new UserRepository(transaction).findByPhone(phone)
    );
    if (!user?.openid) {
      return { success: false, skipped: true, error: 'contact openid unavailable' };
    }

    const template = await getMiniProgramSubscriptionTemplate('enterprise_join_result');
    if (!template?.templateId) {
      return { success: false, skipped: true, error: 'subscription template unavailable' };
    }

    const contactName =
      typeof input.contactPerson?.name === 'string'
        ? input.contactPerson.name.trim()
        : '';
    return await sendSubscriptionMessage({
      touser: user.openid,
      template_id: template.templateId,
      page: '/pages/mine/mine',
      data: buildEnterpriseJoinResultPayload(template, {
        notifiedAt: new Date(),
        result: input.result === 'approved' ? '审核通过' : '审核不通过',
        contactPerson: contactName || '联系人',
        appliedAt: input.appliedAt,
        storeName: input.enterpriseName,
      }),
    });
  } catch (error) {
    console.error('Enterprise join result notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyReferrerOfSigningCommission(input: {
  enterpriseId: bigint;
  leadId: bigint;
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead) return { success: false, skipped: true, error: 'lead unavailable' };

    const commissions = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadCommissionRepository(transaction).list(input.enterpriseId, {
        leadId: input.leadId,
        role: 'referrer',
      })
    );
    const referrerRow = commissions.find((row) => row.role === 'referrer');
    if (!referrerRow) {
      return { success: false, skipped: true, error: 'referrer commission unavailable' };
    }

    const beneficiaryUserId = referrerRow.beneficiaryUserId;
    const identity = await withPlatformTransaction((transaction) =>
      new MiniProgramIdentityRepository(transaction).findWechatIdentityByUserId(beneficiaryUserId)
    );
    if (!identity?.openid) {
      return { success: false, skipped: true, error: 'referrer openid unavailable' };
    }

    const template = await getMiniProgramSubscriptionTemplate('signing_commission');
    if (!template?.templateId) {
      return { success: false, skipped: true, error: 'subscription template unavailable' };
    }

    const customerLabel = lead.name || '客户';
    return await sendSubscriptionMessage({
      touser: identity.openid,
      template_id: template.templateId,
      page: '/packages/business/referrer-earnings/referrer-earnings',
      data: buildSigningCommissionPayload(template, {
        rewardType: '签单提成',
        note: `${customerLabel}已签约`,
        amount: referrerRow.payableAmount,
      }),
    });
  } catch (error) {
    console.error('Referrer signing commission notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyEnterpriseAdminOfLeadConverted(input: {
  enterpriseId: bigint;
  leadId: bigint;
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead) return { success: false, error: 'lead unavailable' };

    const admins = await withTenantTransaction(input.enterpriseId, async (transaction) =>
      (
        await new AdminUserRepository(transaction).list({
          roles: ['enterprise_admin'],
          status: 'active',
          page: 1,
          limit: 1000,
        })
      ).rows
    );

    const tip = lead.communityName
      ? `${lead.name}已签约·${lead.communityName}`
      : `${lead.name}已签约`;
    const notifiedAt = lead.convertedAt || new Date();
    const results = await Promise.all(
      admins.map(async (admin) => {
        const recipient = await enrichRecipientOpenid(admin);
        return deliverLeadNotification({
          lead: { ...lead, id: lead.id, enterpriseId: lead.enterpriseId?.toString() },
          recipient,
          templateKind: 'lead_converted',
          notificationType: 'lead_converted',
          message: `客户${lead.name}已签约`,
          dedupeKey: `lead_converted:${input.leadId.toString()}:${admin.id.toString()}`,
          page: '/packages/business/enterprise-commissions/enterprise-commissions',
          buildData: (template) =>
            buildLeadConvertedPayload(template, {
              notifiedAt,
              tip,
            }),
        });
      })
    );
    return { success: results.every((item) => item.success), results };
  } catch (error) {
    console.error('Enterprise lead converted notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

/**
 * Staff designer/measurer signing earnings reuse `workflow_todo` so the role
 * still only authorizes three templates. Referrer money stays on
 * `signing_commission`.
 */
export async function notifyStaffOfSigningCommission(input: {
  enterpriseId: bigint;
  leadId: bigint;
}) {
  try {
    const lead = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadRepository(transaction).findById(input.leadId)
    );
    if (!lead) return { success: false, skipped: true, error: 'lead unavailable' };

    const commissions = await withTenantTransaction(input.enterpriseId, (transaction) =>
      new LeadCommissionRepository(transaction).list(input.enterpriseId, {
        leadId: input.leadId,
      })
    );
    const staffRows = commissions.filter(
      (row) =>
        (row.role === 'designer' || row.role === 'measurer') &&
        row.status === 'payable' &&
        row.beneficiaryUserId
    );
    if (!staffRows.length) {
      return { success: false, skipped: true, error: 'staff commission unavailable' };
    }

    const byBeneficiary = new Map<
      string,
      { beneficiaryUserId: bigint; payableAmount: number; roles: string[] }
    >();
    for (const row of staffRows) {
      const key = row.beneficiaryUserId.toString();
      const amount = Number(row.payableAmount);
      const current = byBeneficiary.get(key);
      if (!current) {
        byBeneficiary.set(key, {
          beneficiaryUserId: row.beneficiaryUserId,
          payableAmount: Number.isFinite(amount) ? amount : 0,
          roles: [row.role],
        });
        continue;
      }
      if (Number.isFinite(amount)) current.payableAmount += amount;
      if (!current.roles.includes(row.role)) current.roles.push(row.role);
    }

    const results = await Promise.all(
      [...byBeneficiary.values()].map(async (entry) => {
        const staff = await withTenantTransaction(input.enterpriseId, (transaction) =>
          new AdminUserRepository(transaction).findActiveStaffByUserId(
            input.enterpriseId,
            entry.beneficiaryUserId,
            ['designer', 'measurer']
          )
        );
        if (!staff) {
          return { success: false, skipped: true, error: 'staff beneficiary unavailable' };
        }
        const recipient = await enrichRecipientOpenid(staff);
        const amountText = formatWeChatAmount(entry.payableAmount);
        const roleLabel =
          entry.roles.includes('designer') && entry.roles.includes('measurer')
            ? '设计测量提成'
            : entry.roles.includes('designer')
              ? '设计提成'
              : '测量提成';
        return deliverLeadNotification({
          lead: { ...lead, id: lead.id, enterpriseId: lead.enterpriseId?.toString() },
          recipient,
          templateKind: 'workflow_todo',
          notificationType: 'staff_signing_commission',
          message: `客户${lead.name}已签约，${roleLabel} ${amountText}`,
          dedupeKey: `staff_signing_commission:${input.leadId.toString()}:${staff.id.toString()}`,
          page: '/packages/business/commission-records/commission-records',
          metadata: {
            roles: entry.roles,
            payableAmount: entry.payableAmount.toFixed(2),
          },
          buildData: (template) =>
            buildWorkflowTodoPayload(template, {
              projectName: lead.communityName || lead.name,
              owner: recipient.displayName || recipient.username || '员工',
              currentStatus: '已签约',
              todo: '查看签单提成',
              note: `${roleLabel}${amountText}`,
            }),
        });
      })
    );
    return { success: results.every((item) => item.success), results };
  } catch (error) {
    console.error('Staff signing commission notification failed:', error);
    return { success: false, error: deliveryError(error) };
  }
}

export async function notifyConvertedLeadParties(input: {
  enterpriseId: bigint;
  leadId: bigint;
}) {
  const results = await Promise.allSettled([
    notifyReferrerOfSigningCommission(input),
    notifyStaffOfSigningCommission(input),
    notifyEnterpriseAdminOfLeadConverted(input),
  ]);
  return results;
}
