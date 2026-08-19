import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository, AppointmentRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { resolveLeadServiceStage } from '@/lib/lead-service-stage';
import { buildStaffingGapItems, isAssignmentEligibleStaff } from '@/lib/miniprogram-workbench';

export const dynamic = 'force-dynamic';

type WorkbenchRole = 'designer' | 'measurer' | 'enterprise_admin';

function currentRole(context: Awaited<ReturnType<typeof resolveMiniProgramContext>>): WorkbenchRole | null {
  const role = context?.staff?.role;
  return role === 'designer' || role === 'measurer' || role === 'enterprise_admin'
    ? role
    : null;
}

function leadItem(
  lead: Awaited<ReturnType<LeadRepository['list']>>['rows'][number],
  action = 'lead'
) {
  const plan = lead.primaryFloorPlanRecord || lead.floorPlanRecords?.[0] || null;
  const pendingSurvey = ['new', 'measuring'].includes(lead.status || 'new');
  const surveyAction = action === 'survey';
  const stage = resolveLeadServiceStage({
    leadStatus: lead.status,
    assignmentStatus: lead.assignmentStatus,
    measurerId: lead.measurerId,
    appointment: lead.appointment,
    hasFormalFloorPlan: Boolean(plan && plan.status === 'completed'),
  });
  return {
    id: lead.id.toString(),
    leadId: lead.id.toString(),
    floorPlanId: plan?.id.toString() || '',
    title: lead.name || '客户',
    subtitle: lead.communityName || '待补充服务地址',
    meta: stage.label,
    metaLabel: stage.label,
    status: lead.status || 'new',
    serviceStage: stage.key,
    nextAction: stage.nextAction,
    updatedAt: lead.updatedAt,
    action: surveyAction ? 'survey' : action,
    canSurveyNow: surveyAction && pendingSurvey,
    canBookAppointment: (surveyAction || action === 'rebook') && (
      stage.key === 'measurer_assigned'
      || stage.key === 'appointment_expired'
      || stage.key === 'awaiting_rebooking'
    ),
    canRebook: stage.key === 'appointment_expired' || stage.key === 'awaiting_rebooking',
  };
}

function appointmentItem(
  appointment: Awaited<ReturnType<AppointmentRepository['listByMeasurer']>>[number],
  lead?: Awaited<ReturnType<LeadRepository['findByIds']>>[number],
  options: { allowRebook?: boolean } = {}
) {
  const plan = lead?.primaryFloorPlanRecord || lead?.floorPlanRecords[0] || null;
  const expired = appointment.status === 'expired';
  const allowRebook = Boolean(options.allowRebook && expired);
  const stage = resolveLeadServiceStage({
    leadStatus: lead?.status,
    assignmentStatus: lead?.assignmentStatus,
    measurerId: lead?.measurerId,
    appointment,
    hasFormalFloorPlan: Boolean(plan && plan.status === 'completed'),
  });
  return {
    id: appointment.id.toString(),
    appointmentId: appointment.id.toString(),
    leadId: appointment.leadId.toString(),
    floorPlanId: plan?.id.toString() || '',
    title: lead?.name || '客户量房',
    subtitle: appointment.address || lead?.communityName || '地址待确认',
    meta: appointment.timeRange,
    timeRange: appointment.timeRange,
    status: appointment.status,
    serviceStage: stage.key,
    nextAction: stage.nextAction,
    metaLabel: expired ? '已过期' : stage.label,
    action: allowRebook ? 'rebook' : 'appointment',
    canBookAppointment: allowRebook,
    canRebook: allowRebook,
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    const role = currentRole(context);
    if (!role || !context.enterpriseId || !context.staff) {
      return NextResponse.json({ success: false, error: '当前身份没有此工作台权限' }, { status: 403 });
    }

    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const leads = new LeadRepository(transaction);
      const appointments = new AppointmentRepository(transaction);
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const staffId = parsePostgresId(context.staff!._id, 'staff id');

      if (role === 'designer') {
        const scope = { staffId, staffVisibility: 'assigned' as const };
        const measurerScope = { staffId, staffVisibility: 'measurer' as const };
        const [leadList, statusCounts, surveyList, expiredUnbooked] = await Promise.all([
          leads.list({ ...scope, page: 1, limit: 6, orderBy: 'updatedAt' }),
          leads.countStatuses(scope, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
          leads.list({ ...measurerScope, page: 1, limit: 20, orderBy: 'updatedAt' }),
          appointments.listExpiredUnbooked(enterpriseId, 20),
        ]);
        const ownExpired = expiredUnbooked
          .filter((row) => row.lead.assignedTo === staffId)
          .map((row) => leadItem({ ...row.lead, appointment: row.appointment, floorPlanRecords: [], primaryFloorPlanRecord: null, assignedUser: null, promoter: null, archivedUser: null, convertedUser: null }, 'rebook'));
        const surveyTasks = surveyList.rows
          .filter((lead) => ['new', 'measuring'].includes(lead.status || 'new'))
          .map((lead) => leadItem(lead, 'survey'));
        const surveyIds = new Set(surveyTasks.map((item) => item.leadId));
        const expiredIds = new Set(ownExpired.map((item) => item.leadId));
        const followUps = [
          ...ownExpired,
          ...leadList.rows
            .filter((lead) => !expiredIds.has(lead.id.toString()))
            .map((lead) => leadItem(lead, surveyIds.has(lead.id.toString()) ? 'survey' : 'lead')),
        ];
        const activeCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
        return {
          role,
          title: '设计师工作台',
          subtitle: '优先处理过期未重约与本人待跟进客户',
          summary: [
            { key: 'expired', label: '过期未重约', value: ownExpired.length, detail: '需要重新预约上门', tone: 'orange' },
            { key: 'active', label: '待推进客户', value: activeCount, detail: '仅本人负责', tone: 'green' },
            { key: 'measuring', label: '待量房交接', value: Number(statusCounts.measuring || 0) + surveyTasks.length, detail: '可立即量房或等待正式量房', tone: 'blue' },
          ],
          primaryItems: followUps.slice(0, 8),
          tasks: [...ownExpired, ...surveyTasks],
          activityCode: { label: '出示活动码', target: 'activity-code' },
          secondary: { label: '查看全部客户', target: 'customers' },
        };
      }

      if (role === 'measurer') {
        const [appointmentRows, surveyList] = await Promise.all([
          appointments.listByMeasurer(enterpriseId, staffId, ['confirmed', 'expired']),
          leads.list({ staffId, staffVisibility: 'measurer', page: 1, limit: 20, orderBy: 'updatedAt' }),
        ]);
        const confirmedRows = appointmentRows.filter((item) => item.status === 'confirmed');
        const expiredRows = appointmentRows.filter((item) => item.status === 'expired');
        const leadRows = await leads.findByIds(appointmentRows.map((item) => item.leadId));
        const leadMap = new Map(leadRows.map((item) => [item.id, item]));
        const appointmentItems = confirmedRows.map((item) => appointmentItem(item, leadMap.get(item.leadId)));
        const expiredItems = expiredRows.map((item) => appointmentItem(item, leadMap.get(item.leadId)));
        const scheduledIds = new Set(confirmedRows.map((item) => item.leadId.toString()));
        const unscheduled = surveyList.rows
          .filter((lead) => ['new', 'measuring'].includes(lead.status || 'new') && !scheduledIds.has(lead.id.toString()))
          .map((lead) => leadItem(lead, 'survey'));
        const items = [...expiredItems, ...unscheduled, ...appointmentItems];
        return {
          role,
          title: '今日测量台',
          subtitle: '过期待处理已离开已确认日程，量房只从已指派任务进入',
          summary: [
            { key: 'schedule', label: '已确认日程', value: appointmentItems.length, detail: '当前本人预约', tone: 'green' },
            { key: 'expired', label: '过期待处理', value: expiredItems.length, detail: '不再占用已确认档期', tone: 'orange' },
            { key: 'survey', label: '待量房任务', value: unscheduled.length + appointmentItems.length, detail: '可立即量房或查看预约', tone: 'blue' },
          ],
          primaryItems: items.slice(0, 6),
          tasks: items,
          activityCode: { label: '出示活动码', target: 'activity-code' },
          secondary: { label: '查看量房日程', target: 'calendar' },
        };
      }

      const [pendingAssignments, expiredUnbooked, staffList, appointmentRows] = await Promise.all([
        leads.list({ assignmentStatus: 'assignment_pending', page: 1, limit: 20, orderBy: 'updatedAt' }),
        appointments.listExpiredUnbooked(enterpriseId, 20),
        new AdminUserRepository(transaction).list({ roles: ['designer', 'measurer'], status: 'active', page: 1, limit: 200 }),
        appointments.listByEnterprise(enterpriseId, ['confirmed', 'expired'], 20),
      ]);
      const appointmentLeads = await leads.findByIds(appointmentRows.map((item) => item.leadId));
      const appointmentLeadMap = new Map(appointmentLeads.map((item) => [item.id, item]));
      const pendingItems = pendingAssignments.rows.map((lead) => ({
        ...leadItem(lead, 'lead'),
        subtitle: lead.assignmentErrorCode || '补齐可用设计师或测量员后重试',
        metaLabel: '待派失败',
      }));
      const expiredItems = expiredUnbooked.map((row) => ({
        ...leadItem({
          ...row.lead,
          appointment: row.appointment,
          floorPlanRecords: [],
          primaryFloorPlanRecord: null,
          assignedUser: null,
          promoter: null,
          archivedUser: null,
          convertedUser: null,
        }, 'rebook'),
        appointmentId: row.appointment.id.toString(),
        action: 'appointment',
        canBookAppointment: false,
        canRebook: false,
        metaLabel: '过期未重约',
      }));
      const staffingItems = buildStaffingGapItems({
        eligibleDesignerCount: staffList.rows.filter((member) => member.role === 'designer' && isAssignmentEligibleStaff(member)).length,
        eligibleMeasurerCount: staffList.rows.filter((member) => member.role === 'measurer' && isAssignmentEligibleStaff(member)).length,
      });
      const exceptionItems = [...staffingItems, ...pendingItems, ...expiredItems];
      return {
        role,
        title: '企业经营异常台',
        subtitle: '只处理待派失败、过期未重约和人员缺口；实操请切到设计师或测量员身份',
        summary: [
          { key: 'pending', label: '待派失败', value: pendingItems.length, detail: '需要补人后重试', tone: 'orange' },
          { key: 'expired', label: '过期未重约', value: expiredItems.length, detail: '预约结束仍未新建', tone: 'orange' },
          { key: 'staffing', label: '人员缺口', value: staffingItems.length, detail: staffingItems.length ? '无可用设计师或测量员' : '派单人员齐全', tone: staffingItems.length ? 'orange' : 'green' },
        ],
        primaryItems: exceptionItems.slice(0, 8),
        appointments: appointmentRows.map((item) => appointmentItem(item, appointmentLeadMap.get(item.leadId))),
        secondary: { label: '查看预约安排', target: 'appointments' },
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '工作台加载失败';
    console.error('[MiniProgramWorkbench] Error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
