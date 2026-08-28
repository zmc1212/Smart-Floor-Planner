import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository, AppointmentRepository, CustomerProjectRepository, LeadRepository, StaffNotificationRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  buildDesignerWechatProfileTodo,
  buildEnterpriseExpiredExceptionItem,
  buildEnterpriseOverviewSummary,
  buildEnterprisePendingExceptionItem,
  buildEnterpriseStaffingExceptionItem,
  buildStaffingGapItems,
  buildStaffLoadQuickNav,
  buildWorkbenchAppointmentItem,
  buildWorkbenchLeadItem,
  compareDesignerWorkbenchItems,
  countPendingSchemeDeliveries,
  indexWorkbenchRowsById,
  isAssignmentEligibleStaff,
  isMeasurerWorkbenchSurveyLead,
  loadOpsDashboard,
  resolveWorkbenchPeriod,
  selectMeasurerWorkbenchAppointments,
  shouldIncludeMeasurerWorkbenchAppointment,
  type WorkbenchPeriodRange,
} from '@/lib/miniprogram-workbench';

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
  action = 'lead',
  publishedDesignCount = 0
) {
  return buildWorkbenchLeadItem({ ...lead, publishedDesignCount }, action);
}

function appointmentItem(
  appointment: Awaited<ReturnType<AppointmentRepository['listByMeasurer']>>[number],
  lead?: Awaited<ReturnType<LeadRepository['findByIds']>>[number],
  options: { allowRebook?: boolean; publishedDesignCount?: number } = {}
) {
  return buildWorkbenchAppointmentItem(appointment, lead ? { ...lead, publishedDesignCount: options.publishedDesignCount || 0 } : lead, options);
}

function parsePeriod(request: Request) {
  const url = new URL(request.url);
  return resolveWorkbenchPeriod({
    period: url.searchParams.get('period'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
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

    let period: WorkbenchPeriodRange;
    try {
      period = parsePeriod(request);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : '周期参数无效',
      }, { status: 400 });
    }

    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const leads = new LeadRepository(transaction);
      const appointments = new AppointmentRepository(transaction);
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const staffId = parsePostgresId(context.staff!._id, 'staff id');
      const withdrawalNotices = (await new StaffNotificationRepository(transaction).list(staffId, true))
        .filter((notice) => ['lead_referrer_withdrawn', 'lead_referrer_withdrawal_reverted'].includes(notice.notificationType))
        .map((notice) => ({
          id: notice.id.toString(),
          leadId: notice.leadId?.toString() || null,
          title: notice.notificationType === 'lead_referrer_withdrawal_reverted' ? '撤销已撤回' : '推广人已撤销',
          message: notice.message || (notice.notificationType === 'lead_referrer_withdrawal_reverted' ? '该线索可继续跟进' : '该线索已撤销，无法继续推进'),
          recordCode: (notice.metadata as Record<string, unknown> | null)?.recordCode || null,
          createdAt: notice.createdAt,
        }));

      if (role === 'designer') {
        const scope = { staffId, staffVisibility: 'assigned' as const };
        const measurerScope = { staffId, staffVisibility: 'measurer' as const };
        const adminUsers = new AdminUserRepository(transaction);
        const [leadList, statusCounts, surveyList, expiredUnbooked, opsDashboard, selfStaff] = await Promise.all([
          leads.list({ ...scope, page: 1, limit: 6, orderBy: 'updatedAt' }),
          leads.countStatuses(scope, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
          leads.list({ ...measurerScope, page: 1, limit: 20, orderBy: 'updatedAt' }),
          appointments.listExpiredUnbooked(enterpriseId, 20),
          loadOpsDashboard(transaction, {
            enterpriseId,
            period,
            scope,
            includeContractAmount: false,
          }),
          adminUsers.findById(staffId),
        ]);
        const publicationLeadIds = [
          ...leadList.rows.map((row) => row.id),
          ...surveyList.rows.map((row) => row.id),
          ...expiredUnbooked.map((row) => row.lead.id),
        ];
        const publishedCounts = await new CustomerProjectRepository(transaction).countPublishedDesignsByLeadIds(
          enterpriseId,
          [...new Set(publicationLeadIds.map((id) => id.toString()))].map((id) => BigInt(id))
        );
        const publishedCountFor = (leadId: bigint | number | string) => publishedCounts.get(String(leadId)) || 0;
        const ownExpired = expiredUnbooked
          .filter((row) => row.lead.assignedTo === staffId)
          .map((row) => leadItem({
            ...row.lead,
            appointment: row.appointment,
            floorPlanRecords: [],
            primaryFloorPlanRecord: null,
            assignedUser: null,
            promoter: null,
            archivedUser: null,
            convertedUser: null,
          }, 'rebook', publishedCountFor(row.lead.id)));
        const surveyTasks = surveyList.rows
          .filter((lead) => ['new', 'measuring'].includes(lead.status || 'new'))
          .map((lead) => leadItem(lead, 'survey', publishedCountFor(lead.id)));
        const surveyIds = new Set(surveyTasks.map((item) => item.leadId));
        const expiredIds = new Set(ownExpired.map((item) => item.leadId));
        const followUps = [
          ...ownExpired,
          ...leadList.rows
            .filter((lead) => !expiredIds.has(lead.id.toString()))
            .filter((lead) => !['converted', 'closed'].includes(lead.status || 'new'))
            .map((lead) => leadItem(lead, surveyIds.has(lead.id.toString()) ? 'survey' : 'lead', publishedCountFor(lead.id))),
        ].sort(compareDesignerWorkbenchItems);
        const activeCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
        const profileTodo = selfStaff
          ? buildDesignerWechatProfileTodo({
              wechatId: selfStaff.wechatId,
              wechatQrAssetId: selfStaff.wechatQrAssetId,
            })
          : null;
        const primaryItems = profileTodo
          ? [profileTodo, ...followUps.slice(0, 7)]
          : followUps.slice(0, 8);
        return {
          role,
          title: '家装设计顾问工作台',
          subtitle: '优先处理过期未重约与本人待跟进客户',
          summary: [
            { key: 'expired', label: '过期未重约', value: ownExpired.length, detail: '需要重新预约上门', tone: 'orange' },
            { key: 'active', label: '待推进客户', value: activeCount, detail: '仅本人负责', tone: 'green' },
            { key: 'measuring', label: '待量房交接', value: Number(statusCounts.measuring || 0) + surveyTasks.length, detail: '可立即量房或等待正式量房', tone: 'blue' },
          ],
          primaryItems,
          tasks: [...ownExpired, ...surveyTasks],
          activityCode: { label: '出示活动码', target: 'activity-code' },
          secondary: { label: '查看全部客户', target: 'customers' },
          ...opsDashboard,
          withdrawalNotices,
        };
      }

      if (role === 'measurer') {
        const scope = { staffId, staffVisibility: 'measurer' as const };
        const [appointmentRows, surveyList, opsDashboard] = await Promise.all([
          appointments.listByMeasurer(enterpriseId, staffId, ['confirmed', 'expired']),
          leads.list({ ...scope, page: 1, limit: 20, orderBy: 'updatedAt' }),
          loadOpsDashboard(transaction, {
            enterpriseId,
            period,
            scope,
            includeContractAmount: false,
          }),
        ]);
        const currentAppointmentRows = selectMeasurerWorkbenchAppointments(appointmentRows);
        const leadRows = await leads.findByIds(currentAppointmentRows.map((item) => item.leadId), {
          includeArchived: true,
        });
        const leadMap = indexWorkbenchRowsById(leadRows);
        const publicationLeadIds = [
          ...surveyList.rows.map((row) => row.id),
          ...currentAppointmentRows.map((item) => item.leadId),
        ];
        const publishedCounts = await new CustomerProjectRepository(transaction).countPublishedDesignsByLeadIds(
          enterpriseId,
          [...new Set(publicationLeadIds.map((id) => id.toString()))].map((id) => BigInt(id))
        );
        const publishedCountFor = (leadId: bigint | number | string) => publishedCounts.get(String(leadId)) || 0;
        const withPublishedCount = (
          lead: (typeof leadRows)[number] | (typeof surveyList.rows)[number] | undefined
        ) => (lead ? { ...lead, publishedDesignCount: publishedCountFor(lead.id) } : lead);
        const confirmedRows = currentAppointmentRows
          .filter((item) => item.status === 'confirmed')
          .filter((item) => shouldIncludeMeasurerWorkbenchAppointment(
            withPublishedCount(leadMap.get(String(item.leadId))),
            item
          ));
        const expiredRows = currentAppointmentRows
          .filter((item) => item.status === 'expired')
          .filter((item) => shouldIncludeMeasurerWorkbenchAppointment(
            withPublishedCount(leadMap.get(String(item.leadId))),
            item
          ));
        const appointmentItems = confirmedRows.map((item) => appointmentItem(
          item,
          leadMap.get(String(item.leadId)),
          { publishedDesignCount: publishedCountFor(item.leadId) }
        ));
        const expiredItems = expiredRows.map((item) => appointmentItem(
          item,
          leadMap.get(String(item.leadId)),
          { publishedDesignCount: publishedCountFor(item.leadId) }
        ));
        const occupiedIds = new Set([
          ...confirmedRows.map((item) => item.leadId.toString()),
          ...expiredRows.map((item) => item.leadId.toString()),
        ]);
        const unscheduled = surveyList.rows
          .filter((lead) => isMeasurerWorkbenchSurveyLead(withPublishedCount(lead)!, occupiedIds))
          .map((lead) => leadItem(lead, 'survey', publishedCountFor(lead.id)));
        const items = [...expiredItems, ...unscheduled, ...appointmentItems];
        return {
          role,
          title: '今日测量台',
          subtitle: '过期待处理已离开已确认日程，量房只从已指派任务进入',
          summary: [
            { key: 'schedule', label: '已确认日程', value: appointmentItems.length, detail: '当前本人预约', tone: 'green' },
            { key: 'expired', label: '过期待处理', value: expiredItems.length, detail: '不再占用已确认档期', tone: 'orange' },
            { key: 'survey', label: '待量房任务', value: unscheduled.length, detail: '尚未完成正式量房的已派任务', tone: 'blue' },
          ],
          primaryItems: items.slice(0, 6),
          tasks: items,
          activityCode: { label: '出示活动码', target: 'activity-code' },
          secondary: { label: '查看量房日程', target: 'calendar' },
          ...opsDashboard,
          withdrawalNotices,
        };
      }

      const [pendingAssignments, expiredUnbooked, staffList, appointmentRows, opsDashboard] = await Promise.all([
        leads.list({ assignmentStatus: 'assignment_pending', page: 1, limit: 20, orderBy: 'updatedAt' }),
        appointments.listExpiredUnbooked(enterpriseId, 20),
        new AdminUserRepository(transaction).list({ roles: ['designer', 'measurer'], status: 'active', page: 1, limit: 200 }),
        appointments.listByEnterprise(enterpriseId, ['confirmed', 'expired'], 20),
        loadOpsDashboard(transaction, {
          enterpriseId,
          period,
          includeContractAmount: true,
        }),
      ]);
      const eligibleDesignerCount = staffList.rows.filter((member) => member.role === 'designer' && isAssignmentEligibleStaff(member)).length;
      const eligibleMeasurerCount = staffList.rows.filter((member) => member.role === 'measurer' && isAssignmentEligibleStaff(member)).length;
      const [
        appointmentLeads,
        measuringCount,
        assignedNewCount,
        pendingDeliveryCount,
      ] = await Promise.all([
        leads.findByIds(appointmentRows.map((item) => item.leadId), { includeArchived: true }),
        leads.count({ status: 'measuring' }),
        leads.count({ status: 'new', assignmentStatus: 'assigned' }),
        countPendingSchemeDeliveries(transaction),
      ]);
      const appointmentLeadMap = indexWorkbenchRowsById(appointmentLeads);
      const pendingItems = pendingAssignments.rows.map((lead) => buildEnterprisePendingExceptionItem(lead));
      const expiredItems = expiredUnbooked.map((row) => buildEnterpriseExpiredExceptionItem({
        ...row.lead,
        appointment: row.appointment,
        floorPlanRecords: [],
        primaryFloorPlanRecord: null,
      }, row.appointment));
      const staffingItems = buildStaffingGapItems({
        eligibleDesignerCount,
        eligibleMeasurerCount,
      }).map((item) => buildEnterpriseStaffingExceptionItem(item));
      const exceptionItems = [...staffingItems, ...pendingItems, ...expiredItems];
      const pendingSurveyCount = measuringCount + assignedNewCount;
      return {
        role,
        title: '门店经营与全盘调度',
        subtitle: '派单跟踪 · 测量调度 · 方案交付',
        summary: buildEnterpriseOverviewSummary({
          pendingAssignmentCount: pendingAssignments.total,
          pendingSurveyCount,
          pendingDeliveryCount,
        }),
        quickNav: [
          {
            key: 'pendingLeads',
            title: '待处理线索',
            desc: pendingAssignments.total > 0 ? `${pendingAssignments.total} 条待分派 →` : '暂无待分派 →',
            tone: pendingAssignments.total > 0 ? 'green' : 'green',
            target: 'customers',
          },
          buildStaffLoadQuickNav({ eligibleDesignerCount, eligibleMeasurerCount }),
        ],
        primaryItems: exceptionItems.slice(0, 8),
        appointments: appointmentRows.map((item) => appointmentItem(item, appointmentLeadMap.get(String(item.leadId)))),
        activityCode: { label: '分享活动码', detail: '发给客户 · 扫码留资', target: 'activity-code' },
        joinCode: { label: '邀请入驻', detail: '员工 · 推荐人', target: 'join-codes' },
        secondary: { label: '查看预约安排', target: 'appointments' },
        ...opsDashboard,
        withdrawalNotices,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '工作台加载失败';
    console.error('[MiniProgramWorkbench] Error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
