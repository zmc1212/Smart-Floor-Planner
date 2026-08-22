import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { aiGenerationPublications, aiGenerations, floorPlans } from '@/db/schema';
import { FloorPlanRepository } from '@/db/repositories/floor-plan-repository';
import { LeadRepository } from '@/db/repositories/lead-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { resolveLeadServiceStage, type LeadServiceStage } from '@/lib/lead-service-stage';

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

/** Designer workbench todo when self WeChat contact profile is incomplete. */
export function buildDesignerWechatProfileTodo(member: {
  wechatId?: string | null;
  wechatQrAssetId?: string | bigint | null;
}) {
  const hasWechatId = Boolean(String(member.wechatId || '').trim());
  const hasQr = Boolean(member.wechatQrAssetId);
  if (hasWechatId && hasQr) return null;
  const missing: string[] = [];
  if (!hasWechatId) missing.push('微信号');
  if (!hasQr) missing.push('个人二维码');
  return {
    id: 'designer-wechat-profile',
    title: '补齐微信联系方式',
    subtitle: `还差${missing.join('和')}，补齐后才能接客户与出示活动码`,
    metaLabel: '服务资料',
    meta: '服务资料',
    statusBadge: '待完善',
    action: 'profile',
    actionLabel: '去完善',
    serviceStage: 'assignment_pending',
    nextAction: '在「我的」补齐微信号和个人二维码',
  };
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
  publishedDesignCount?: number;
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

const COMPLETED_MEASURER_SURVEY_STAGES = new Set<LeadServiceStage>([
  'survey_completed',
  'design_published',
  'converted',
  'closed',
]);

export function isMeasurerWorkbenchSurveyLead(
  lead: WorkbenchLeadInput,
  occupiedLeadIds: Set<string>
) {
  if (occupiedLeadIds.has(String(lead.id))) return false;
  const status = lead.status || 'new';
  if (['converted', 'closed'].includes(status)) return false;
  const plan = selectWorkbenchFloorPlan(lead);
  const stage = resolveLeadServiceStage({
    leadStatus: status,
    assignmentStatus: lead.assignmentStatus,
    measurerId: lead.measurerId,
    appointment: lead.appointment,
    hasFormalFloorPlan: plan?.status === 'completed',
  });
  if (COMPLETED_MEASURER_SURVEY_STAGES.has(stage.key)) return false;
  return ['new', 'measuring'].includes(status) || Boolean(plan && plan.status !== 'completed');
}

/**
 * Confirmed visits stay visible even after a completed v4 plan.
 * Expired visits drop once survey is done.
 * Converted/closed leads are finished on the platform and leave the workbench queue.
 */
export function shouldIncludeMeasurerWorkbenchAppointment(
  lead: WorkbenchLeadInput | null | undefined,
  appointment: { status: string }
) {
  if (lead && ['converted', 'closed'].includes(lead.status || 'new')) return false;
  if (appointment.status === 'confirmed') return true;
  if (appointment.status !== 'expired') return false;
  if (!lead) return true;
  return isMeasurerWorkbenchSurveyLead(lead, new Set());
}

type MeasurerWorkbenchAppointment = {
  id: bigint | number | string;
  leadId: bigint | number | string;
  status: string;
  timeRange?: string | null;
};

function appointmentStartTime(appointment: MeasurerWorkbenchAppointment) {
  const start = appointment.timeRange?.match(/"([^"\n]+)"/)?.[1];
  const timestamp = start ? new Date(start).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** The workbench is lead-oriented; appointment history remains available in the calendar. */
export function selectMeasurerWorkbenchAppointments<T extends MeasurerWorkbenchAppointment>(appointments: T[]) {
  const selected = new Map<string, T>();
  for (const appointment of appointments) {
    const key = String(appointment.leadId);
    const current = selected.get(key);
    if (!current) {
      selected.set(key, appointment);
      continue;
    }
    const rank = appointment.status === 'confirmed' ? 2 : 1;
    const currentRank = current.status === 'confirmed' ? 2 : 1;
    if (rank > currentRank || (rank === currentRank && appointmentStartTime(appointment) > appointmentStartTime(current))) {
      selected.set(key, appointment);
    }
  }
  return [...selected.values()];
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
  const hasFormalFloorPlan = plan?.status === 'completed';
  const stage = resolveLeadServiceStage({
    leadStatus: lead?.status,
    assignmentStatus: lead?.assignmentStatus,
    measurerId: lead?.measurerId,
    appointment,
    hasFormalFloorPlan,
    publishedDesignCount: lead?.publishedDesignCount,
  });
  const terminalLead = stage.key === 'converted' || stage.key === 'closed';
  const allowRebook = Boolean(options.allowRebook && expired && !terminalLead);
  const canContinueSurvey = Boolean(planId) && !allowRebook && !terminalLead;
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
    metaLabel: terminalLead ? stage.label : expired ? '已过期' : stage.label,
    action: allowRebook ? 'rebook' : 'appointment',
    actionLabel: canContinueSurvey ? '继续量房' : undefined,
    statusBadge: terminalLead
      ? stage.label
      : expired
        ? ''
        : stage.key === 'design_published'
          ? '方案已发布'
          : hasFormalFloorPlan
            ? '户型已就绪'
            : '待上门',
    publishedDesignCount: Number(lead?.publishedDesignCount || 0),
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
    publishedDesignCount: lead.publishedDesignCount,
  });
  const canSurveyNow = surveyAction && !closed;
  const canContinueSurvey = canSurveyNow && Boolean(planId);
  const canStartNewSurvey = canContinueSurvey;
  const canBookAppointment = !planId && (surveyAction || action === 'rebook') && (
    stage.key === 'measurer_assigned'
    || stage.key === 'appointment_expired'
    || stage.key === 'awaiting_rebooking'
  );
  const statusBadge = closed
    ? stage.label
    : stage.key === 'design_published'
      ? '方案已发布'
      : hasFormalFloorPlan
        ? '户型已就绪'
        : planId
          ? '量房中'
          : surveyAction
            ? '待量房'
            : '';
  // Activity-code leads can keep measurerId while designer assignment is still
  // pending. On survey cards, do not pair enterprise「待派单」with「待量房」.
  const metaLabel = surveyAction && !closed && stage.key === 'assignment_pending' && lead.measurerId
    ? '未预约上门'
    : stage.label;

  return {
    id: String(lead.id),
    leadId: String(lead.id),
    floorPlanId: planId,
    floorPlanStatus: plan?.status || '',
    title: lead.name || '客户',
    subtitle: lead.communityName || '待补充服务地址',
    communityName: lead.communityName || '',
    meta: metaLabel,
    metaLabel,
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
    canRebook: !closed && !planId && (stage.key === 'appointment_expired' || stage.key === 'awaiting_rebooking'),
    publishedDesignCount: Number(lead.publishedDesignCount || 0),
  };
}

const DESIGNER_WORKBENCH_STAGE_PRIORITY: Partial<Record<LeadServiceStage, number>> = {
  appointment_expired: 0,
  awaiting_rebooking: 1,
  survey_completed: 2,
  design_published: 3,
  converted: 4,
  closed: 5,
};

export function compareDesignerWorkbenchItems(
  left: { serviceStage?: string | null; updatedAt?: Date | string | null },
  right: { serviceStage?: string | null; updatedAt?: Date | string | null }
) {
  const leftPriority = DESIGNER_WORKBENCH_STAGE_PRIORITY[left.serviceStage as LeadServiceStage] ?? 2;
  const rightPriority = DESIGNER_WORKBENCH_STAGE_PRIORITY[right.serviceStage as LeadServiceStage] ?? 2;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
  const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
  return rightTime - leftTime;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDateParts(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  })
    .formatToParts(now)
    .reduce<Record<string, string | number>>((values, part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        values[part.type] = Number(part.value);
      }
      if (part.type === 'weekday') values.weekday = part.value;
      return values;
    }, {});
}

function shanghaiStartOfDay(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS);
}

function addShanghaiCalendarDays(start: Date, days: number) {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export function shanghaiMonthRange(now = new Date()) {
  const parts = shanghaiDateParts(now);
  const year = Number(parts.year) || now.getUTCFullYear();
  const month = Number(parts.month) || now.getUTCMonth() + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: shanghaiStartOfDay(year, month, 1),
    end: shanghaiStartOfDay(nextYear, nextMonth, 1),
  };
}

export function previousMonthRange(now = new Date()) {
  const current = shanghaiMonthRange(now);
  const previousAnchor = new Date(current.start.getTime() - 24 * 60 * 60 * 1000);
  return shanghaiMonthRange(previousAnchor);
}

export function shanghaiWeekRange(now = new Date()) {
  const parts = shanghaiDateParts(now);
  const year = Number(parts.year) || now.getUTCFullYear();
  const month = Number(parts.month) || now.getUTCMonth() + 1;
  const day = Number(parts.day) || now.getUTCDate();
  const weekday = String(parts.weekday || 'Mon');
  const daysFromMonday = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[weekday] ?? 0;
  const start = addShanghaiCalendarDays(shanghaiStartOfDay(year, month, day), -daysFromMonday);
  return { start, end: addShanghaiCalendarDays(start, 7) };
}

export function shanghaiYearRange(now = new Date()) {
  const parts = shanghaiDateParts(now);
  const year = Number(parts.year) || now.getUTCFullYear();
  return {
    start: shanghaiStartOfDay(year, 1, 1),
    end: shanghaiStartOfDay(year + 1, 1, 1),
  };
}

export type WorkbenchPeriodKind = 'week' | 'month' | 'year' | 'custom';

export type WorkbenchPeriodRange = {
  kind: WorkbenchPeriodKind;
  label: string;
  start: Date;
  end: Date;
  fromDate?: string;
  toDate?: string;
};

function parseShanghaiDateInput(value?: string | null) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = shanghaiStartOfDay(year, month, day);
  const parts = shanghaiDateParts(start);
  if (Number(parts.year) !== year || Number(parts.month) !== month || Number(parts.day) !== day) return null;
  return { year, month, day, start };
}

export function resolveWorkbenchPeriod(input: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
} = {}): WorkbenchPeriodRange {
  const now = input.now || new Date();
  const kind = String(input.period || 'month').trim().toLowerCase();
  if (kind === 'week') {
    return { kind: 'week', label: '本周', ...shanghaiWeekRange(now) };
  }
  if (kind === 'year') {
    return { kind: 'year', label: '本年', ...shanghaiYearRange(now) };
  }
  if (kind === 'custom') {
    const from = parseShanghaiDateInput(input.from);
    const to = parseShanghaiDateInput(input.to);
    if (!from || !to || to.start < from.start) {
      throw new Error('自定义周期需要有效的起止日期');
    }
    return {
      kind: 'custom',
      label: '自定义',
      start: from.start,
      end: addShanghaiCalendarDays(to.start, 1),
      fromDate: `${from.year}-${String(from.month).padStart(2, '0')}-${String(from.day).padStart(2, '0')}`,
      toDate: `${to.year}-${String(to.month).padStart(2, '0')}-${String(to.day).padStart(2, '0')}`,
    };
  }
  return { kind: 'month', label: '本月', ...shanghaiMonthRange(now) };
}

export function previousComparablePeriodRange(range: Pick<WorkbenchPeriodRange, 'kind' | 'start' | 'end'>) {
  const durationMs = range.end.getTime() - range.start.getTime();
  if (range.kind === 'month') {
    return previousMonthRange(new Date(range.start.getTime() + 12 * 60 * 60 * 1000));
  }
  if (range.kind === 'year') {
    const year = shanghaiDateParts(new Date(range.start.getTime() + 12 * 60 * 60 * 1000)).year;
    const previousYear = Number(year) - 1;
    return {
      start: shanghaiStartOfDay(previousYear, 1, 1),
      end: shanghaiStartOfDay(previousYear + 1, 1, 1),
    };
  }
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: range.start,
  };
}

export function computeSigningRate(signedCount: number, newLeadCount: number) {
  if (newLeadCount <= 0) return null;
  return Math.round((signedCount / newLeadCount) * 1000) / 10;
}

export function formatSigningRateDetail(signedCount: number, newLeadCount: number) {
  if (newLeadCount <= 0) return '暂无新增线索';
  return `已签约 ÷ 新增线索`;
}

export function formatContractAmountDetail(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return '暂无签约金额';
  if (amount >= 10000) {
    const wan = Math.round((amount / 10000) * 10) / 10;
    return `签约金额 ¥${wan}万`;
  }
  return `签约金额 ¥${Math.round(amount).toLocaleString('zh-CN')}`;
}

export type OpsDashboardCard = {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  detail: string;
  tone: 'green' | 'orange' | 'blue';
};

export function buildOpsDashboardCards(input: {
  newLeadCount: number;
  previousLeadCount: number;
  completedSurveys: number;
  draftFormalPlans: number;
  schemeDeliveryRate: number;
  schemeDeliveryDetail: string;
  signedCount: number;
  contractAmountSum?: number | null;
  includeContractAmount?: boolean;
}): { cards: OpsDashboardCard[]; signingRate: number | null } {
  const closureDenominator = input.completedSurveys + input.draftFormalPlans;
  const closureRate = closureDenominator > 0
    ? Math.round((input.completedSurveys / closureDenominator) * 1000) / 10
    : 0;
  const signingRate = computeSigningRate(input.signedCount, input.newLeadCount);
  const cards: OpsDashboardCard[] = [
    {
      key: 'newLeads',
      label: '新增线索',
      value: input.newLeadCount,
      unit: '条',
      detail: formatGrowthDetail(input.newLeadCount, input.previousLeadCount),
      tone: 'green',
    },
    {
      key: 'completedSurveys',
      label: '已完成量房',
      value: input.completedSurveys,
      unit: '户',
      detail: closureDenominator > 0 ? `闭合率 ${closureRate}%` : '暂无闭合率',
      tone: 'green',
    },
    {
      key: 'schemeDelivery',
      label: '方案交付率',
      value: input.schemeDeliveryRate,
      unit: '%',
      detail: input.schemeDeliveryDetail,
      tone: 'green',
    },
    {
      key: 'signedCount',
      label: '已签约',
      value: input.signedCount,
      unit: '单',
      detail: input.includeContractAmount
        ? formatContractAmountDetail(Number(input.contractAmountSum || 0))
        : '本人周期签约',
      tone: 'green',
    },
    {
      key: 'signingRate',
      label: '签单率',
      value: signingRate == null ? '—' : signingRate,
      unit: signingRate == null ? '' : '%',
      detail: input.includeContractAmount
        ? formatSigningRateDetail(input.signedCount, input.newLeadCount)
        : input.newLeadCount > 0
          ? `周期新增线索 ${input.newLeadCount}`
          : formatSigningRateDetail(input.signedCount, input.newLeadCount),
      tone: 'green',
    },
  ];
  return { cards, signingRate };
}

export function buildOpsDashboardSubtitle(scope: 'enterprise' | 'personal', periodLabel: string) {
  return `${scope === 'enterprise' ? '全店' : '我的'} · ${periodLabel}`;
}

export type LoadOpsDashboardOptions = {
  enterpriseId: bigint;
  period: WorkbenchPeriodRange;
  scope?: { staffId: bigint; staffVisibility: 'assigned' | 'measurer' };
  includeContractAmount?: boolean;
};

export async function loadOpsDashboard(
  transaction: PostgresTransaction,
  options: LoadOpsDashboardOptions
) {
  const leads = new LeadRepository(transaction);
  const previous = previousComparablePeriodRange(options.period);
  const staffFilter = options.scope
    ? { staffId: options.scope.staffId, staffVisibility: options.scope.staffVisibility }
    : {};
  const [
    newLeadCount,
    previousLeadCount,
    signedCount,
    contractAmountSum,
    completedSurveys,
    draftFormalPlans,
    schemeFacts,
  ] = await Promise.all([
    leads.count({
      ...staffFilter,
      createdSince: options.period.start,
      createdBefore: options.period.end,
    }),
    leads.count({
      ...staffFilter,
      createdSince: previous.start,
      createdBefore: previous.end,
    }),
    leads.count({
      ...staffFilter,
      status: 'converted',
      convertedSince: options.period.start,
      convertedBefore: options.period.end,
    }),
    options.includeContractAmount
      ? leads.sumContractAmount({
          ...staffFilter,
          status: 'converted',
          convertedSince: options.period.start,
          convertedBefore: options.period.end,
        })
      : Promise.resolve(0),
    options.scope
      ? countScopedFormalFloorPlans(transaction, {
          status: 'completed',
          completedFrom: options.period.start,
          completedBefore: options.period.end,
          staffId: options.scope.staffId,
          staffVisibility: options.scope.staffVisibility,
        })
      : new FloorPlanRepository(transaction).count({
          formalOnly: true,
          status: 'completed',
          completedFrom: options.period.start,
          completedBefore: options.period.end,
        }),
    options.scope
      ? countScopedFormalFloorPlans(transaction, {
          status: 'draft',
          staffId: options.scope.staffId,
          staffVisibility: options.scope.staffVisibility,
        })
      : new FloorPlanRepository(transaction).count({ formalOnly: true, status: 'draft' }),
    queryEnterpriseSchemeDeliveryFacts(
      transaction,
      options.enterpriseId,
      options.period,
      options.scope
    ),
  ]);

  const schemeDeliveryRate = completedSurveys > 0
    ? Math.min(100, Math.round((schemeFacts.publishedLeadCount / completedSurveys) * 100))
    : 0;
  const schemeDeliveryDetail = schemeFacts.avgDeliveryDays == null
    ? '暂无交付用时'
    : `平均用时 ${schemeFacts.avgDeliveryDays} 天`;
  const { cards, signingRate } = buildOpsDashboardCards({
    newLeadCount,
    previousLeadCount,
    completedSurveys,
    draftFormalPlans,
    schemeDeliveryRate,
    schemeDeliveryDetail,
    signedCount,
    contractAmountSum,
    includeContractAmount: Boolean(options.includeContractAmount),
  });

  return {
    period: {
      kind: options.period.kind,
      label: options.period.label,
      from: options.period.fromDate || null,
      to: options.period.toDate || null,
      subtitle: buildOpsDashboardSubtitle(
        options.scope ? 'personal' : 'enterprise',
        options.period.kind === 'custom' && options.period.fromDate && options.period.toDate
          ? `${options.period.fromDate} ~ ${options.period.toDate}`
          : options.period.label
      ),
    },
    dashboard: cards,
    signedCount,
    signingRate,
  };
}

export function buildEnterpriseLeadLabel(lead: {
  communityName?: string | null;
  name?: string | null;
}) {
  return [lead.communityName, lead.name].filter(Boolean).join(' · ') || '客户';
}

export function formatGrowthDetail(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? '周期内新增' : '暂无环比';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return `↑ ${pct}% 较上期`;
  if (pct < 0) return `↓ ${Math.abs(pct)}% 较上期`;
  return '与上期持平';
}

export function formatExceptionTimestamp(value?: Date | string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const stamp = `${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`.replace(/\//g, '-');
  return stamp ? `${stamp} 产生` : '';
}

export function buildEnterprisePendingExceptionItem(
  lead: WorkbenchLeadInput & { assignmentErrorCode?: string | null }
) {
  return {
    ...buildWorkbenchLeadItem(lead, 'lead'),
    title: `自动派单失败 · ${buildEnterpriseLeadLabel(lead)}`,
    subtitle: lead.assignmentErrorCode || '目标区域暂无可用测量员',
    metaLabel: formatExceptionTimestamp(lead.updatedAt),
    action: 'lead',
    actionLabel: '去指派',
    exceptionTone: 'red',
  };
}

export function buildEnterpriseExpiredExceptionItem(
  lead: WorkbenchLeadInput,
  appointment: { id: bigint | number | string; leadId: bigint | number | string }
) {
  return {
    ...buildWorkbenchLeadItem({
      ...lead,
      appointment: { status: 'expired', timeRange: lead.appointment?.timeRange || null },
    }, 'rebook'),
    id: String(appointment.id),
    appointmentId: String(appointment.id),
    leadId: String(appointment.leadId),
    title: `预约过期未改期 · ${buildEnterpriseLeadLabel(lead)}`,
    subtitle: '客户超24小时未重选时段',
    metaLabel: formatExceptionTimestamp(lead.updatedAt),
    action: 'appointment',
    actionLabel: '查看详情',
    exceptionTone: 'orange',
    canBookAppointment: false,
    canRebook: false,
  };
}

export function buildEnterpriseStaffingExceptionItem(
  item: ReturnType<typeof buildStaffingGapItems>[number]
) {
  return {
    ...item,
    metaLabel: '人员缺口',
    actionLabel: '查看详情',
    exceptionTone: 'orange',
  };
}

const ROSTER_ROLES = ['designer', 'measurer'] as const;

export function parseEnterpriseStaffRosterRoles(value?: string | null) {
  const role = String(value || '').trim();
  if (!role) return [...ROSTER_ROLES];
  if (role === 'designer' || role === 'measurer') return [role];
  throw Object.assign(new Error('role 仅支持 designer 或 measurer'), { status: 400 });
}

type RosterStaffInput = {
  id: bigint | number | string;
  displayName?: string | null;
  phone?: string | null;
  role?: string | null;
  status?: string | null;
  assignmentPaused?: boolean | null;
  wechatId?: string | null;
  wechatQrAssetId?: string | bigint | null;
};

export function buildEnterpriseStaffRosterItem(member: RosterStaffInput) {
  const role = member.role === 'measurer' ? 'measurer' : 'designer';
  const assignmentPaused = Boolean(member.assignmentPaused);
  const assignmentEligible = isAssignmentEligibleStaff(member);
  const wechatIncomplete = role === 'designer'
    && !Boolean(String(member.wechatId || '').trim() && member.wechatQrAssetId);
  const ineligibleReason = assignmentPaused
    ? 'paused'
    : wechatIncomplete
      ? 'designer_wechat_incomplete'
      : null;
  const statusLabel = ineligibleReason === 'paused'
    ? '已暂停'
    : ineligibleReason === 'designer_wechat_incomplete'
      ? '待补微信资料'
      : '可派单';
  return {
    id: String(member.id),
    displayName: String(member.displayName || '').trim() || (role === 'measurer' ? '测量员' : '设计师'),
    phone: String(member.phone || '').trim() || null,
    role,
    roleLabel: role === 'measurer' ? '测量员' : '设计师',
    assignmentPaused,
    assignmentEligible,
    ineligibleReason,
    statusLabel,
    statusTone: assignmentEligible ? 'green' : 'orange',
    action: assignmentPaused ? 'resume' : ineligibleReason ? null : 'pause',
    actionLabel: assignmentPaused ? '恢复派单' : ineligibleReason ? '' : '暂停派单',
    helperText: ineligibleReason === 'designer_wechat_incomplete'
      ? '请本人在「我的」补齐微信号和个人二维码后再派单'
      : '',
  };
}

export function buildStaffLoadQuickNav(input: {
  eligibleDesignerCount: number;
  eligibleMeasurerCount: number;
}) {
  if (input.eligibleMeasurerCount <= 0) {
    return {
      key: 'staffLoad',
      title: '人员负荷',
      desc: '测量员紧缺 →',
      tone: 'orange',
      target: 'staffing',
    };
  }
  if (input.eligibleDesignerCount <= 0) {
    return {
      key: 'staffLoad',
      title: '人员负荷',
      desc: '设计师紧缺 →',
      tone: 'orange',
      target: 'staffing',
    };
  }
  return {
    key: 'staffLoad',
    title: '人员负荷',
    desc: '人员齐全 →',
    tone: 'green',
    target: 'staffing',
  };
}

export async function queryEnterpriseSchemeDeliveryFacts(
  transaction: PostgresTransaction,
  enterpriseId: bigint,
  period: { start: Date; end: Date },
  scope?: { staffId: bigint; staffVisibility: 'assigned' | 'measurer' }
) {
  const staffFilter = scope
    ? scope.staffVisibility === 'measurer'
      ? sql`exists (
          select 1 from app.leads scoped_leads
          where scoped_leads.id = ${aiGenerationPublications.leadId}
            and scoped_leads.enterprise_id = ${enterpriseId}
            and scoped_leads.measurer_id = ${scope.staffId}
            and scoped_leads.archived_at is null
        )`
      : sql`exists (
          select 1 from app.leads scoped_leads
          where scoped_leads.id = ${aiGenerationPublications.leadId}
            and scoped_leads.enterprise_id = ${enterpriseId}
            and scoped_leads.assigned_to = ${scope.staffId}
            and scoped_leads.archived_at is null
        )`
    : undefined;

  const [publishedLeadRows, avgDeliveryRow] = await Promise.all([
    transaction
      .select({ leadId: aiGenerationPublications.leadId })
      .from(aiGenerationPublications)
      .where(and(
        eq(aiGenerationPublications.enterpriseId, enterpriseId),
        isNull(aiGenerationPublications.withdrawnAt),
        ...(staffFilter ? [staffFilter] : [])
      )),
    transaction
      .select({
        avgDays: sql<number | null>`avg(extract(epoch from (${aiGenerationPublications.publishedAt} - ${floorPlans.completedAt})) / 86400.0)`,
      })
      .from(aiGenerationPublications)
      .innerJoin(aiGenerations, eq(aiGenerations.id, aiGenerationPublications.generationId))
      .innerJoin(floorPlans, eq(floorPlans.id, aiGenerations.floorPlanId))
      .where(and(
        eq(aiGenerationPublications.enterpriseId, enterpriseId),
        isNull(aiGenerationPublications.withdrawnAt),
        gte(aiGenerationPublications.publishedAt, period.start),
        lt(aiGenerationPublications.publishedAt, period.end),
        sql`${floorPlans.completedAt} is not null`,
        ...(staffFilter ? [staffFilter] : [])
      )),
  ]);
  const publishedLeadCount = new Set(publishedLeadRows.map((row) => row.leadId.toString())).size;
  const avgDeliveryDays = avgDeliveryRow[0]?.avgDays == null
    ? null
    : Math.round(Number(avgDeliveryRow[0].avgDays) * 10) / 10;
  return { publishedLeadCount, avgDeliveryDays };
}

export async function countScopedFormalFloorPlans(
  transaction: PostgresTransaction,
  options: {
    status: 'completed' | 'draft';
    completedFrom?: Date;
    completedBefore?: Date;
    staffId?: bigint;
    staffVisibility?: 'assigned' | 'measurer';
  }
) {
  const filters = [
    sql`${floorPlans.layoutData} ->> 'version' = '4'`,
    sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`,
    sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`,
    eq(floorPlans.status, options.status),
  ];
  if (options.status === 'completed') {
    if (options.completedFrom) filters.push(gte(floorPlans.completedAt, options.completedFrom));
    if (options.completedBefore) filters.push(lt(floorPlans.completedAt, options.completedBefore));
  }
  if (options.staffId && options.staffVisibility) {
    const staffColumn = options.staffVisibility === 'measurer'
      ? sql`leads.measurer_id`
      : sql`leads.assigned_to`;
    filters.push(sql`exists (
      select 1
      from app.lead_floor_plans lfp
      inner join app.leads leads on leads.id = lfp.lead_id
      where lfp.floor_plan_id = ${floorPlans.id}
        and ${staffColumn} = ${options.staffId}
        and leads.archived_at is null
    )`);
  }

  const rows = await transaction
    .select({ value: count() })
    .from(floorPlans)
    .where(and(...filters));
  return Number(rows[0]?.value ?? 0);
}

export async function countActiveEnterprisePublications(
  transaction: PostgresTransaction,
  enterpriseId: bigint
) {
  const rows = await transaction
    .select({ value: count() })
    .from(aiGenerationPublications)
    .where(and(
      eq(aiGenerationPublications.enterpriseId, enterpriseId),
      isNull(aiGenerationPublications.withdrawnAt)
    ));
  return Number(rows[0]?.value ?? 0);
}
