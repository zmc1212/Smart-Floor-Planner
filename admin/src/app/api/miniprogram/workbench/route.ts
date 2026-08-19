import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AppointmentRepository, LeadRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type WorkbenchRole = 'designer' | 'measurer' | 'enterprise_admin';

function currentRole(context: Awaited<ReturnType<typeof resolveMiniProgramContext>>): WorkbenchRole | null {
  const role = context?.staff?.role;
  return role === 'designer' || role === 'measurer' || role === 'enterprise_admin'
    ? role
    : null;
}

function leadItem(lead: Awaited<ReturnType<LeadRepository['list']>>['rows'][number]) {
  const plan = lead.primaryFloorPlanRecord || lead.floorPlanRecords[0] || null;
  return {
    id: lead.id.toString(),
    leadId: lead.id.toString(),
    floorPlanId: plan?.id.toString() || '',
    title: lead.name || '客户',
    subtitle: lead.communityName || '待补充服务地址',
    meta: lead.status || 'new',
    status: lead.status || 'new',
    updatedAt: lead.updatedAt,
    action: 'lead',
  };
}

function appointmentItem(
  appointment: Awaited<ReturnType<AppointmentRepository['listByMeasurer']>>[number],
  lead?: Awaited<ReturnType<LeadRepository['findByIds']>>[number]
) {
  const plan = lead?.primaryFloorPlanRecord || lead?.floorPlanRecords[0] || null;
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
    action: 'appointment',
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
        const [leadList, statusCounts] = await Promise.all([
          leads.list({ ...scope, page: 1, limit: 6, orderBy: 'updatedAt' }),
          leads.countStatuses(scope, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
        ]);
        const activeCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
        return {
          role,
          title: '设计师工作台',
          subtitle: '优先推进本人负责的客户与方案',
          summary: [
            { key: 'active', label: '待推进客户', value: activeCount, detail: '仅本人负责', tone: 'green' },
            { key: 'measuring', label: '待量房交接', value: Number(statusCounts.measuring || 0), detail: '等待正式量房', tone: 'blue' },
            { key: 'design', label: '方案协作', value: Number(statusCounts.measured || 0) + Number(statusCounts.designing || 0), detail: '可继续方案工作', tone: 'orange' },
          ],
          primaryItems: leadList.rows.map(leadItem),
          secondary: { label: '查看全部客户', target: 'customers' },
        };
      }

      if (role === 'measurer') {
        const appointmentRows = await appointments.listByMeasurer(enterpriseId, staffId);
        const leadRows = await leads.findByIds(appointmentRows.map((item) => item.leadId));
        const leadMap = new Map(leadRows.map((item) => [item.id, item]));
        const items = appointmentRows.map((item) => appointmentItem(item, leadMap.get(item.leadId)));
        return {
          role,
          title: '今日测量台',
          subtitle: '只显示已指派的日程与量房任务',
          summary: [
            { key: 'schedule', label: '已确认日程', value: items.length, detail: '当前本人预约', tone: 'green' },
            { key: 'survey', label: '待量房任务', value: items.filter((item) => Boolean(item.floorPlanId)).length, detail: '从任务进入正式量房', tone: 'blue' },
          ],
          primaryItems: items.slice(0, 6),
          tasks: items,
          secondary: { label: '维护不可用时间', target: 'unavailability' },
        };
      }

      const [leadList, statusCounts, appointmentRows] = await Promise.all([
        leads.list({ page: 1, limit: 6, orderBy: 'updatedAt' }),
        leads.countStatuses({}, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
        appointments.listConfirmedByEnterprise(enterpriseId, 6),
      ]);
      const appointmentLeads = await leads.findByIds(appointmentRows.map((item) => item.leadId));
      const appointmentLeadMap = new Map(appointmentLeads.map((item) => [item.id, item]));
      const activeCount = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
      return {
        role,
        title: '企业经营台',
        subtitle: '查看本企业需要协调的服务事实',
        summary: [
          { key: 'active', label: '进行中客户', value: activeCount, detail: '当前租户范围', tone: 'green' },
          { key: 'new', label: '待跟进线索', value: Number(statusCounts.new || 0) + Number(statusCounts.contacted || 0), detail: '优先处理新服务', tone: 'orange' },
          { key: 'appointments', label: '已确认预约', value: appointmentRows.length, detail: '近期服务安排', tone: 'blue' },
        ],
        primaryItems: leadList.rows.map(leadItem),
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
