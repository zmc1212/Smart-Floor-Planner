import type { SubscriptionTemplateConfig, SubscriptionTemplateKind } from '@/lib/platform-notification-config';

export type SubscriptionMessagePayload = Record<string, { value: string }>;

type WorkflowNotificationRecord = {
  enterpriseName?: string | null;
  contactPerson?: string | null;
  measureAssignedAt?: Date | string | null;
  designAssignedAt?: Date | string | null;
};

const WORKFLOW_COPY: Record<string, { status: string; todo: string; note?: string }> = {
  follow_up_created: { status: '待跟进', todo: '跟进客户' },
  follow_up_overdue: { status: '已逾期', todo: '处理逾期跟进' },
  conflict_pending: { status: '待复核', todo: '复核客户归属' },
  measure_overdue: { status: '已逾期', todo: '处理逾期量房' },
  measure_submitted: { status: '已提交', todo: '审核量房结果' },
  design_overdue: { status: '已逾期', todo: '处理逾期设计' },
  design_completed: { status: '已完成', todo: '跟进报价签约' },
  record_closed: { status: '已关闭', todo: '查看关闭记录' },
  lead_acquired_commission_pending: { status: '待结算', todo: '查看获客提成' },
  platform_report_created: { status: '待跟进', todo: '审核企业报备' },
};

const ASSIGNMENT_COPY: Record<string, { status: string; note: string }> = {
  measure_assigned: { status: '待量房', note: '请按时完成量房' },
  design_assigned: { status: '待设计', note: '请开始方案设计' },
  lead_assigned: { status: '待跟进', note: '请尽快联系客户' },
};

function cleanText(value: unknown, fallback: string) {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : '';
  return text || fallback;
}

export function truncateWeChatText(value: unknown, maxLength: number, fallback = '-') {
  return Array.from(cleanText(value, fallback)).slice(0, maxLength).join('');
}

export function formatWeChatDateTime(value?: Date | string | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const normalized = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(normalized);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function payloadEntry(
  payload: SubscriptionMessagePayload,
  key: string | undefined,
  value: string
) {
  if (key) payload[key] = { value };
}

export function buildWorkflowTodoPayload(
  template: SubscriptionTemplateConfig,
  input: {
    projectName?: unknown;
    owner?: unknown;
    currentStatus?: unknown;
    todo?: unknown;
    note?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.projectName, truncateWeChatText(input.projectName, 20, '客户项目'));
  payloadEntry(payload, keys.owner, truncateWeChatText(input.owner, 20, '待处理人员'));
  payloadEntry(payload, keys.currentStatus, truncateWeChatText(input.currentStatus, 5, '待处理'));
  payloadEntry(payload, keys.todo, truncateWeChatText(input.todo, 20, '查看工作任务'));
  payloadEntry(payload, keys.note, truncateWeChatText(input.note, 20, '请及时处理'));
  return payload;
}

export function buildLeadAssignmentPayload(
  template: SubscriptionTemplateConfig,
  input: {
    customerName?: unknown;
    customerStatus?: unknown;
    note?: unknown;
    assignedAt?: Date | string | null;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.customerName, truncateWeChatText(input.customerName, 20, '客户'));
  payloadEntry(payload, keys.customerStatus, truncateWeChatText(input.customerStatus, 5, '待跟进'));
  payloadEntry(payload, keys.note, truncateWeChatText(input.note, 20, '请尽快联系客户'));
  payloadEntry(payload, keys.assignedAt, formatWeChatDateTime(input.assignedAt));
  return payload;
}

export function buildNewLeadPayload(
  template: SubscriptionTemplateConfig,
  input: {
    customerName?: unknown;
    addedAt?: Date | string | null;
    owner?: unknown;
    phone?: unknown;
    selectedAt?: Date | string | null;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.customerName, truncateWeChatText(input.customerName, 10, '客户'));
  payloadEntry(payload, keys.addedAt, formatWeChatDateTime(input.addedAt));
  payloadEntry(payload, keys.owner, truncateWeChatText(input.owner, 10, '待分配'));
  payloadEntry(payload, keys.phone, truncateWeChatText(input.phone, 17, '未填写'));
  payloadEntry(payload, keys.selectedAt, formatWeChatDateTime(input.selectedAt || input.addedAt));
  return payload;
}

export function buildMeasurementAppointmentPayload(
  template: SubscriptionTemplateConfig,
  input: {
    customerName?: unknown;
    phone?: unknown;
    community?: unknown;
    measurementAt?: Date | string | null;
    reminder?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.customerName, truncateWeChatText(input.customerName, 20, '客户'));
  payloadEntry(payload, keys.phone, truncateWeChatText(input.phone, 17, '未填写'));
  payloadEntry(payload, keys.community, truncateWeChatText(input.community, 20, '上门地址'));
  payloadEntry(payload, keys.measurementAt, formatWeChatDateTime(input.measurementAt));
  payloadEntry(payload, keys.reminder, truncateWeChatText(input.reminder, 20, '请按时到场'));
  return payload;
}

export function buildDesignPublishedPayload(
  template: SubscriptionTemplateConfig,
  input: {
    content?: unknown;
    publishedAt?: Date | string | null;
    note?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.content, truncateWeChatText(input.content, 20, '设计方案'));
  payloadEntry(payload, keys.publishedAt, formatWeChatDateTime(input.publishedAt));
  payloadEntry(payload, keys.note, truncateWeChatText(input.note, 20, '请到项目页查看效果图'));
  return payload;
}

export function buildEnterpriseJoinResultPayload(
  template: SubscriptionTemplateConfig,
  input: {
    notifiedAt?: Date | string | null;
    result?: unknown;
    contactPerson?: unknown;
    appliedAt?: Date | string | null;
    storeName?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.notifiedAt, formatWeChatDateTime(input.notifiedAt));
  payloadEntry(payload, keys.result, truncateWeChatText(input.result, 5, '已处理'));
  payloadEntry(payload, keys.contactPerson, truncateWeChatText(input.contactPerson, 20, '联系人'));
  payloadEntry(payload, keys.appliedAt, formatWeChatDateTime(input.appliedAt));
  payloadEntry(payload, keys.storeName, truncateWeChatText(input.storeName, 20, '装修公司'));
  return payload;
}

export function formatWeChatAmount(value: unknown, fallback = '¥0.00') {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim().replace(/,/g, ''))
      : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return `¥${numeric.toFixed(2)}`;
}

export function buildSigningCommissionPayload(
  template: SubscriptionTemplateConfig,
  input: {
    rewardType?: unknown;
    note?: unknown;
    amount?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.rewardType, truncateWeChatText(input.rewardType, 20, '签单提成'));
  payloadEntry(payload, keys.note, truncateWeChatText(input.note, 20, '已签约，提成待结算'));
  payloadEntry(payload, keys.amount, formatWeChatAmount(input.amount));
  return payload;
}

export function buildLeadConvertedPayload(
  template: SubscriptionTemplateConfig,
  input: {
    notifiedAt?: Date | string | null;
    tip?: unknown;
  }
) {
  const keys = template.keywordKeys;
  const payload: SubscriptionMessagePayload = {};
  payloadEntry(payload, keys.notifiedAt, formatWeChatDateTime(input.notifiedAt));
  payloadEntry(payload, keys.tip, truncateWeChatText(input.tip, 20, '客户已签约'));
  return payload;
}

export function resolveWorkflowTemplateKind(notificationType: string): SubscriptionTemplateKind {
  return notificationType === 'measure_assigned' || notificationType === 'design_assigned'
    ? 'lead_assignment'
    : 'workflow_todo';
}

export function buildWorkflowNotificationPayload(input: {
  template: SubscriptionTemplateConfig;
  notificationType: string;
  record: WorkflowNotificationRecord;
  recipientName?: string | null;
  message?: string;
}) {
  if (resolveWorkflowTemplateKind(input.notificationType) === 'lead_assignment') {
    const copy = ASSIGNMENT_COPY[input.notificationType] || ASSIGNMENT_COPY.lead_assigned;
    const assignedAt = input.notificationType === 'measure_assigned'
      ? input.record.measureAssignedAt
      : input.record.designAssignedAt;
    return buildLeadAssignmentPayload(input.template, {
      customerName: input.record.contactPerson,
      customerStatus: copy.status,
      note: copy.note,
      assignedAt,
    });
  }
  const copy = WORKFLOW_COPY[input.notificationType] || {
    status: '待处理',
    todo: '查看工作任务',
  };
  return buildWorkflowTodoPayload(input.template, {
    projectName: input.record.enterpriseName,
    owner: input.recipientName,
    currentStatus: copy.status,
    todo: copy.todo,
    note: input.message || copy.note || '请及时处理',
  });
}

export function assignmentCopy(type: 'lead_assigned') {
  return ASSIGNMENT_COPY[type];
}
