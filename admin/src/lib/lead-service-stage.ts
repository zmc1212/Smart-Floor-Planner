export type LeadServiceStage =
  | 'closed'
  | 'converted'
  | 'design_published'
  | 'survey_completed'
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
  appointment_in_progress: '进入正式量房并提交',
  appointment_expired: '重新预约上门',
  awaiting_rebooking: '选择新的上门时段',
  appointment_confirmed: '按预约上门，窗口内可改期',
  measurer_assigned: '创建首次上门预约',
  assignment_pending: '补齐可用设计师或测量员后重试派单',
  claimed: '等待自动派单或联系客户',
};

export type AppointmentStageInput = {
  status: string;
  timeRange?: string | null;
} | null | undefined;

export function parseAppointmentBounds(timeRange?: string | null) {
  if (!timeRange) return null;
  const match = String(timeRange).match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return null;
  const startAt = new Date(match[1].replaceAll('"', '').trim());
  const endAt = new Date(match[2].replaceAll('"', '').trim());
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return { startAt, endAt };
}

export function isAppointmentPastEnd(appointment: AppointmentStageInput, now = new Date()) {
  if (!appointment || appointment.status !== 'confirmed') return false;
  const bounds = parseAppointmentBounds(appointment.timeRange);
  return Boolean(bounds && bounds.endAt.getTime() <= now.getTime());
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
  measurerId?: string | bigint | null;
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
  else if (input.hasFormalFloorPlan || leadStatus === 'designing' || leadStatus === 'quoting' || leadStatus === 'measured' || leadStatus === 'assigned') {
    key = 'survey_completed';
  } else if (isAppointmentInProgress(appointment, now)) key = 'appointment_in_progress';
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
  if (['converted', 'closed'].includes(String(input.leadStatus || ''))) return false;
  if (input.hasFormalFloorPlan) return false;
  if (input.assignmentStatus === 'assignment_pending') return false;
  const appointment = input.appointment || null;
  if (!appointment) return true;
  if (appointment.status === 'cancelled' || appointment.status === 'expired') return true;
  return isAppointmentPastEnd(appointment, input.now);
}

export type CustomerHomeActionKind = 'reschedule' | 'rebook' | 'view_project' | 'wait_designer' | 'none';

export const CUSTOMER_HOME_ACTION_LABELS: Record<CustomerHomeActionKind, string> = {
  reschedule: '改期',
  rebook: '重新预约',
  view_project: '看项目',
  wait_designer: '等待设计师',
  none: '查看项目',
};

export function canCustomerReschedule(input: {
  appointment?: AppointmentStageInput;
  customerRescheduleCutoffHours?: number | null;
  now?: Date;
}) {
  const appointment = input.appointment || null;
  if (!appointment || appointment.status !== 'confirmed') return false;
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
}) {
  if (input.serviceStage === 'appointment_expired') return '预约已过期，请重新预约上门';
  if (input.serviceStage === 'awaiting_rebooking') return '预约已取消，请选择新的上门时段';
  if (input.serviceStage === 'appointment_in_progress') return '测量员正在上门量房';
  if (input.serviceStage === 'appointment_confirmed') {
    return formatCustomerAppointmentTime(input.appointment?.timeRange) || '已预约上门量房';
  }
  return LEAD_SERVICE_STAGE_NEXT_ACTIONS[input.serviceStage];
}

export function resolveCustomerHomeAction(input: {
  leadStatus?: string | null;
  assignmentStatus?: string | null;
  measurerId?: string | bigint | null;
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
  else if (['converted', 'design_published', 'survey_completed', 'appointment_in_progress'].includes(stage.key)) {
    kind = 'view_project';
  } else if (stage.key === 'appointment_expired' || stage.key === 'awaiting_rebooking') kind = 'rebook';
  else if (stage.key === 'appointment_confirmed') kind = canReschedule ? 'reschedule' : 'view_project';
  else if (['measurer_assigned', 'assignment_pending', 'claimed'].includes(stage.key)) kind = 'wait_designer';
  return {
    kind,
    label: CUSTOMER_HOME_ACTION_LABELS[kind],
    stageKey: stage.key,
    stageLabel: stage.label,
    nextAction: stage.nextAction,
    appointmentSummary: describeCustomerAppointment({ serviceStage: stage.key, appointment: input.appointment }),
    canReschedule,
    canRebook,
  };
}
