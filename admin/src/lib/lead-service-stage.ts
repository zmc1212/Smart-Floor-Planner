export type LeadServiceStage =
  | 'closed'
  | 'converted'
  | 'design_published'
  | 'survey_completed'
  | 'survey_ready'
  | 'appointment_in_progress'
  | 'appointment_expired'
  | 'awaiting_rebooking'
  | 'appointment_confirmed'
  | 'measurer_assigned'
  | 'assignment_pending'
  | 'claimed';

export const LEAD_SERVICE_STAGE_LABELS: Record<LeadServiceStage, string> = {
  closed: '已关闭',
  converted: '已签约',
  design_published: '方案已发布',
  survey_completed: '量房完成',
  survey_ready: '待确认完成',
  appointment_in_progress: '上门量房中',
  appointment_expired: '预约已过期',
  awaiting_rebooking: '待重新预约',
  appointment_confirmed: '已预约上门量房',
  measurer_assigned: '已匹配测量员',
  assignment_pending: '待派单',
  claimed: '新线索',
};

export const LEAD_SERVICE_STAGE_NEXT_ACTIONS: Record<LeadServiceStage, string> = {
  closed: '该线索已关闭',
  converted: '已签约，无需继续推进',
  design_published: '沟通确认或标记签约',
  survey_completed: '生成并发布方案',
  survey_ready: '在预约详情确认完成量房',
  appointment_in_progress: '进入正式量房并提交',
  appointment_expired: '重新预约上门',
  awaiting_rebooking: '选择新的上门时段',
  appointment_confirmed: '按预约上门，窗口内可改期',
  measurer_assigned: '预约上门量房时间',
  assignment_pending: '补齐可用设计师或测量员后重试派单',
  claimed: '等待自动派单或联系客户',
};

export type AppointmentStageInput = {
  status: string;
  timeRange?: string | null;
} | null | undefined;

export function toIsoTimestamp(value: string) {
  const text = String(value || '').trim().replaceAll('"', '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!match) return text;
  const [, date, time, rawZone] = match;
  let zone = rawZone || 'Z';
  if (zone.toUpperCase() === 'Z') zone = 'Z';
  else if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return `${date}T${time}${zone}`;
}

export function parseAppointmentBounds(timeRange?: string | null) {
  if (!timeRange) return null;
  const match = String(timeRange).match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return null;
  const startAt = new Date(toIsoTimestamp(match[1]));
  const endAt = new Date(toIsoTimestamp(match[2]));
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return { startAt, endAt };
}

export function formatAppointmentTimeRangeIso(timeRange?: string | null) {
  const bounds = parseAppointmentBounds(timeRange);
  if (!bounds) return typeof timeRange === 'string' ? timeRange : '';
  return `[${bounds.startAt.toISOString()},${bounds.endAt.toISOString()})`;
}

export function isAppointmentPastEnd(appointment: AppointmentStageInput, now = new Date()) {
  if (!appointment || appointment.status !== 'confirmed') return false;
  const bounds = parseAppointmentBounds(appointment.timeRange);
  return Boolean(bounds && bounds.endAt.getTime() <= now.getTime());
}

export function isActiveConfirmedAppointment(appointment: AppointmentStageInput, now = new Date()) {
  return Boolean(appointment && appointment.status === 'confirmed' && !isAppointmentPastEnd(appointment, now));
}

type OperationalAppointment = AppointmentStageInput & {
  id?: string | bigint | number | null;
  createdAt?: Date | string | null;
};

function appointmentCreatedAtMs(appointment: OperationalAppointment) {
  if (!appointment?.createdAt) return 0;
  const value = appointment.createdAt instanceof Date
    ? appointment.createdAt.getTime()
    : new Date(appointment.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function selectOperationalAppointment<T extends OperationalAppointment>(
  appointments: T[],
  now = new Date()
): T | null {
  if (!appointments.length) return null;
  return [...appointments].sort((left, right) => {
    const rankDiff = Number(isActiveConfirmedAppointment(right, now)) - Number(isActiveConfirmedAppointment(left, now));
    if (rankDiff !== 0) return rankDiff;
    const createdDiff = appointmentCreatedAtMs(right) - appointmentCreatedAtMs(left);
    if (createdDiff !== 0) return createdDiff;
    return String(right.id ?? '').localeCompare(String(left.id ?? ''), undefined, { numeric: true });
  })[0] ?? null;
}

export function isAppointmentInProgress(appointment: AppointmentStageInput, now = new Date()) {
  if (!appointment || appointment.status !== 'confirmed') return false;
  const bounds = parseAppointmentBounds(appointment.timeRange);
  return Boolean(
    bounds &&
      bounds.startAt.getTime() <= now.getTime() &&
      bounds.endAt.getTime() > now.getTime()
  );
}

export function resolveLeadServiceStage(input: {
  leadStatus?: string | null;
  assignmentStatus?: string | null;
  measurerId?: string | number | bigint | null;
  appointment?: AppointmentStageInput;
  hasFormalFloorPlan?: boolean;
  publishedDesignCount?: number;
  now?: Date;
}): { key: LeadServiceStage; label: string; nextAction: string } {
  const now = input.now || new Date();
  const leadStatus = String(input.leadStatus || 'new');
  const appointment = input.appointment || null;
  const operationalAppointmentStatus =
    appointment?.status === 'confirmed' && isAppointmentPastEnd(appointment, now)
      ? 'expired'
      : appointment?.status || null;

  let key: LeadServiceStage = 'claimed';
  if (leadStatus === 'closed') key = 'closed';
  else if (leadStatus === 'converted' || Boolean(input.leadStatus === 'converted')) key = 'converted';
  else if (Number(input.publishedDesignCount || 0) > 0) key = 'design_published';
  else if (appointment?.status === 'completed') key = 'survey_completed';
  else if (input.hasFormalFloorPlan) key = 'survey_ready';
  else if (isAppointmentInProgress(appointment, now)) key = 'appointment_in_progress';
  else if (operationalAppointmentStatus === 'expired') key = 'appointment_expired';
  else if (appointment?.status === 'cancelled') key = 'awaiting_rebooking';
  else if (appointment?.status === 'confirmed') key = 'appointment_confirmed';
  else if (input.assignmentStatus === 'assigned' && input.measurerId) key = 'measurer_assigned';
  else if (input.assignmentStatus === 'assignment_pending') key = 'assignment_pending';
  else key = 'claimed';

  return {
    key,
    label: LEAD_SERVICE_STAGE_LABELS[key],
    nextAction: LEAD_SERVICE_STAGE_NEXT_ACTIONS[key],
  };
}

export function canRebookAppointment(input: {
  leadStatus?: string | null;
  assignmentStatus?: string | null;
  appointment?: AppointmentStageInput;
  hasFormalFloorPlan?: boolean;
  now?: Date;
}) {
  // Display stage (design_published) and lead.status designing do not close
  // makeup booking. Only a completed formal plan or a terminal lead does.
  if (['converted', 'closed'].includes(String(input.leadStatus || ''))) return false;
  if (input.hasFormalFloorPlan) return false;
  if (input.assignmentStatus === 'assignment_pending') return false;
  const appointment = input.appointment || null;
  if (!appointment) return true;
  if (appointment.status === 'cancelled' || appointment.status === 'expired') return true;
  return isAppointmentPastEnd(appointment, input.now);
}

export type CustomerHomeActionKind = 'book' | 'reschedule' | 'rebook' | 'view_project' | 'wait_designer' | 'none';

export const CUSTOMER_HOME_ACTION_LABELS: Record<CustomerHomeActionKind, string> = {
  book: '预约上门',
  reschedule: '改期',
  rebook: '重新预约',
  view_project: '我的服务档案',
  wait_designer: '等待派单',
  none: '我的服务档案',
};

export function canCustomerReschedule(input: {
  appointment?: AppointmentStageInput;
  customerRescheduleCutoffHours?: number | null;
  hasFormalFloorPlan?: boolean;
  now?: Date;
}) {
  const appointment = input.appointment || null;
  if (!appointment || appointment.status !== 'confirmed') return false;
  if (input.hasFormalFloorPlan) return false;
  if (isAppointmentInProgress(appointment, input.now) || isAppointmentPastEnd(appointment, input.now)) return false;
  const bounds = parseAppointmentBounds(appointment.timeRange);
  if (!bounds) return false;
  const cutoffHours = Number.isFinite(Number(input.customerRescheduleCutoffHours))
    ? Math.max(0, Number(input.customerRescheduleCutoffHours))
    : 2;
  const now = input.now || new Date();
  return now.getTime() < bounds.startAt.getTime() - cutoffHours * 3_600_000;
}

function formatCustomerAppointmentTime(timeRange?: string | null) {
  const bounds = parseAppointmentBounds(timeRange);
  if (!bounds) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(bounds.startAt);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${Number(read('month'))}月${Number(read('day'))}日 ${read('hour')}:${read('minute')} 上门量房`;
}

export function describeCustomerAppointment(input: {
  serviceStage: LeadServiceStage;
  appointment?: AppointmentStageInput;
  now?: Date;
}) {
  const appointment = input.appointment;
  const published = input.serviceStage === 'design_published';
  const confirmedVisit = appointment?.status === 'confirmed'
    && !isAppointmentPastEnd(appointment, input.now);
  if (input.serviceStage === 'appointment_expired'
    || (published && (appointment?.status === 'expired' || isAppointmentPastEnd(appointment, input.now)))) {
    return '预约已过期，请重新预约上门';
  }
  if (input.serviceStage === 'awaiting_rebooking'
    || (published && appointment?.status === 'cancelled')) {
    return '预约已取消，请选择新的上门时段';
  }
  if (input.serviceStage === 'appointment_in_progress' || input.serviceStage === 'survey_ready') {
    return '测量员正在上门量房';
  }
  if (input.serviceStage === 'appointment_confirmed' || (published && confirmedVisit)) {
    return formatCustomerAppointmentTime(appointment?.timeRange) || '已预约上门量房';
  }
  if (input.serviceStage === 'measurer_assigned') return '已匹配设计师和测量员，请预约上门量房时间';
  // Customer-facing status only — never reuse staff operational nextAction copy.
  if (input.serviceStage === 'claimed' || input.serviceStage === 'assignment_pending') {
    return '正在为您匹配设计师和测量员';
  }
  if (input.serviceStage === 'survey_completed') return '量房已完成，可在服务档案查看户型';
  if (published) return '方案已发布，可在服务档案查看';
  if (input.serviceStage === 'converted') return '服务已签约完成';
  if (input.serviceStage === 'closed') return '服务已结束';
  return '';
}

export function resolveCustomerHomeAction(input: {
  leadStatus?: string | null;
  assignmentStatus?: string | null;
  measurerId?: string | number | bigint | null;
  appointment?: AppointmentStageInput;
  hasFormalFloorPlan?: boolean;
  publishedDesignCount?: number;
  customerRescheduleCutoffHours?: number | null;
  now?: Date;
}) {
  const stage = resolveLeadServiceStage(input);
  const canReschedule = canCustomerReschedule(input);
  const canRebook = canRebookAppointment({
    leadStatus: input.leadStatus,
    assignmentStatus: input.assignmentStatus,
    appointment: input.appointment,
    hasFormalFloorPlan: input.hasFormalFloorPlan,
    now: input.now,
  });
  let kind: CustomerHomeActionKind = 'wait_designer';
  if (stage.key === 'closed') kind = 'none';
  else if (['converted', 'design_published', 'survey_completed', 'survey_ready', 'appointment_in_progress'].includes(stage.key)) {
    kind = 'view_project';
  } else if (stage.key === 'appointment_expired' || stage.key === 'awaiting_rebooking') kind = 'rebook';
  else if (stage.key === 'appointment_confirmed') kind = canReschedule ? 'reschedule' : 'view_project';
  else if (stage.key === 'measurer_assigned' && canRebook) kind = 'book';
  else if (['assignment_pending', 'claimed'].includes(stage.key)) kind = 'wait_designer';
  const appointmentSummary = describeCustomerAppointment({
    serviceStage: stage.key,
    appointment: input.appointment,
    now: input.now,
  });
  // Keep staff LEAD_SERVICE_STAGE_NEXT_ACTIONS off the customer DTO for pending match.
  const nextAction = stage.key === 'claimed' || stage.key === 'assignment_pending'
    ? '服务匹配完成后即可预约上门'
    : stage.nextAction;
  return {
    kind,
    label: CUSTOMER_HOME_ACTION_LABELS[kind],
    stageKey: stage.key,
    stageLabel: stage.label,
    nextAction,
    appointmentSummary,
    canReschedule,
    canRebook,
  };
}
