import { resolveLeadServiceStage } from '@/lib/lead-service-stage';

export function isAssignmentEligibleStaff(member: {
  role?: string | null;
  status?: string | null;
  assignmentPaused?: boolean | null;
  wechatId?: string | null;
  wechatQrAssetId?: string | bigint | null;
}) {
  if (member.status !== 'active' || member.assignmentPaused) return false;
  if (member.role === 'measurer') return true;
  if (member.role !== 'designer') return false;
  return Boolean(String(member.wechatId || '').trim() && member.wechatQrAssetId);
}

export function buildStaffingGapItems(input: {
  eligibleDesignerCount: number;
  eligibleMeasurerCount: number;
}) {
  const items = [];
  if (input.eligibleDesignerCount <= 0) {
    items.push({
      id: 'staffing-designer',
      title: '暂无可用设计师',
      subtitle: '补齐微信号、二维码或恢复派单后，再重试待派队列',
      metaLabel: '人员缺口',
      action: 'staffing',
      serviceStage: 'assignment_pending',
      nextAction: '补齐可用设计师或测量员后重试派单',
    });
  }
  if (input.eligibleMeasurerCount <= 0) {
    items.push({
      id: 'staffing-measurer',
      title: '暂无可用测量员',
      subtitle: '启用测量员或取消暂停派单后，再重试待派队列',
      metaLabel: '人员缺口',
      action: 'staffing',
      serviceStage: 'assignment_pending',
      nextAction: '补齐可用设计师或测量员后重试派单',
    });
  }
  return items;
}

type WorkbenchFloorPlan = {
  id: bigint | number | string;
  status?: string | null;
  updatedAt?: Date | string | null;
};

type WorkbenchLeadInput = {
  id: bigint | number | string;
  name?: string | null;
  communityName?: string | null;
  status?: string | null;
  assignmentStatus?: string | null;
  measurerId?: bigint | number | string | null;
  appointment?: { status: string; timeRange?: string | null } | null;
  primaryFloorPlanRecord?: WorkbenchFloorPlan | null;
  floorPlanRecords?: WorkbenchFloorPlan[] | null;
  updatedAt?: Date | string | null;
};

function floorPlanId(plan: WorkbenchFloorPlan | null | undefined) {
  return plan?.id == null ? '' : String(plan.id);
}

export function selectWorkbenchFloorPlan(lead: WorkbenchLeadInput) {
  const plans = [
    lead.primaryFloorPlanRecord,
    ...(lead.floorPlanRecords || []),
  ].filter((plan): plan is WorkbenchFloorPlan => Boolean(plan));
  if (!plans.length) return null;
  const primaryId = floorPlanId(lead.primaryFloorPlanRecord);
  if (primaryId) {
    const primary = plans.find((plan) => floorPlanId(plan) === primaryId);
    if (primary) return primary;
  }
  return [...plans].sort((left, right) => {
    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return floorPlanId(right).localeCompare(floorPlanId(left), undefined, { numeric: true });
  })[0] || null;
}

export function isMeasurerWorkbenchSurveyLead(
  lead: WorkbenchLeadInput,
  occupiedLeadIds: Set<string>
) {
  if (occupiedLeadIds.has(String(lead.id))) return false;
  const status = lead.status || 'new';
  if (['converted', 'closed'].includes(status)) return false;
  const pending = ['new', 'measuring'].includes(status);
  const hasPlan = Boolean(selectWorkbenchFloorPlan(lead));
  return pending || hasPlan;
}

export function buildWorkbenchAppointmentItem(
  appointment: {
    id: bigint | number | string;
    leadId: bigint | number | string;
    address?: string | null;
    timeRange?: string | null;
    status: string;
  },
  lead?: WorkbenchLeadInput | null,
  options: { allowRebook?: boolean } = {}
) {
  const plan = lead ? selectWorkbenchFloorPlan(lead) : null;
  const planId = floorPlanId(plan);
  const expired = appointment.status === 'expired';
  const allowRebook = Boolean(options.allowRebook && expired);
  const hasFormalFloorPlan = plan?.status === 'completed';
  const stage = resolveLeadServiceStage({
    leadStatus: lead?.status,
    assignmentStatus: lead?.assignmentStatus,
    measurerId: lead?.measurerId,
    appointment,
    hasFormalFloorPlan,
  });
  const canContinueSurvey = Boolean(planId) && !allowRebook;
  return {
    id: String(appointment.id),
    appointmentId: String(appointment.id),
    leadId: String(appointment.leadId),
    floorPlanId: planId,
    floorPlanStatus: plan?.status || '',
    title: lead?.name || '客户量房',
    subtitle: appointment.address || lead?.communityName || '地址待确认',
    communityName: lead?.communityName || '',
    meta: appointment.timeRange,
    timeRange: appointment.timeRange,
    status: appointment.status,
    serviceStage: stage.key,
    nextAction: stage.nextAction,
    metaLabel: expired ? '已过期' : stage.label,
    action: allowRebook ? 'rebook' : 'appointment',
    actionLabel: canContinueSurvey ? '继续量房' : undefined,
    statusBadge: expired ? '' : hasFormalFloorPlan ? '户型已就绪' : '待上门',
    canSurveyNow: false,
    canContinueSurvey,
    canStartNewSurvey: canContinueSurvey,
    canBookAppointment: allowRebook,
    canRebook: allowRebook,
  };
}

export function buildWorkbenchLeadItem(lead: WorkbenchLeadInput, action = 'lead') {
  const plan = selectWorkbenchFloorPlan(lead);
  const planId = floorPlanId(plan);
  const leadStatus = lead.status || 'new';
  const surveyAction = action === 'survey';
  const closed = ['converted', 'closed'].includes(leadStatus);
  const hasFormalFloorPlan = plan?.status === 'completed';
  const stage = resolveLeadServiceStage({
    leadStatus,
    assignmentStatus: lead.assignmentStatus,
    measurerId: lead.measurerId,
    appointment: lead.appointment,
    hasFormalFloorPlan,
  });
  const canSurveyNow = surveyAction && !closed;
  const canContinueSurvey = canSurveyNow && Boolean(planId);
  const canStartNewSurvey = canContinueSurvey;
  const canBookAppointment = !planId && (surveyAction || action === 'rebook') && (
    stage.key === 'measurer_assigned'
    || stage.key === 'appointment_expired'
    || stage.key === 'awaiting_rebooking'
  );
  const statusBadge = hasFormalFloorPlan
    ? '户型已就绪'
    : planId
      ? '量房中'
      : surveyAction
        ? '待量房'
        : '';

  return {
    id: String(lead.id),
    leadId: String(lead.id),
    floorPlanId: planId,
    floorPlanStatus: plan?.status || '',
    title: lead.name || '客户',
    subtitle: lead.communityName || '待补充服务地址',
    communityName: lead.communityName || '',
    meta: stage.label,
    metaLabel: stage.label,
    status: leadStatus,
    serviceStage: stage.key,
    nextAction: stage.nextAction,
    updatedAt: lead.updatedAt,
    action: surveyAction ? 'survey' : action,
    actionLabel: canContinueSurvey ? '继续量房' : surveyAction ? '立即量房' : undefined,
    statusBadge,
    canSurveyNow,
    canContinueSurvey,
    canStartNewSurvey,
    canBookAppointment,
    canRebook: !planId && (stage.key === 'appointment_expired' || stage.key === 'awaiting_rebooking'),
  };
}
