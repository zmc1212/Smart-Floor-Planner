import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AppointmentRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type StaffRole = 'designer' | 'measurer';

function itemFromLead(lead: Awaited<ReturnType<LeadRepository['list']>>['rows'][number]) {
  const plan = lead.primaryFloorPlanRecord || lead.floorPlanRecords[0] || null;
  return {
    id: lead.id.toString(),
    leadId: lead.id.toString(),
    floorPlanId: plan?.id.toString() || null,
    title: lead.name || '未命名客户',
    subtitle: lead.communityName || '地址待确认',
    phone: lead.phone || null,
    status: lead.status || 'new',
    updatedAt: lead.updatedAt,
  };
}

function itemFromAppointment(
  appointment: Awaited<ReturnType<AppointmentRepository['listByMeasurer']>>[number],
  lead?: Awaited<ReturnType<LeadRepository['findByIds']>>[number]
) {
  const plan = lead?.primaryFloorPlanRecord || lead?.floorPlanRecords[0] || null;
  return {
    id: appointment.id.toString(),
    appointmentId: appointment.id.toString(),
    leadId: appointment.leadId.toString(),
    floorPlanId: plan?.id.toString() || null,
    title: lead?.name || '客户量房',
    subtitle: appointment.address || lead?.communityName || '地址待确认',
    timeRange: appointment.timeRange,
    status: appointment.status,
  };
}

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context || !['designer', 'measurer'].includes(context.role) || !context.enterpriseId) {
      return NextResponse.json({ success: false, error: '仅设计师或测量员可访问员工工作台' }, { status: 403 });
    }
    const role = context.role as StaffRole;
    const data = await withAdminPostgresTransaction(context, async (transaction) => {
      const leads = new LeadRepository(transaction);
      const appointments = new AppointmentRepository(transaction);
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const staffId = parsePostgresId(context.userId, 'user id');

      if (role === 'designer') {
        const scope = { staffId, staffVisibility: 'assigned' as const };
        const [leadList, statusCounts, appointmentRows] = await Promise.all([
          leads.list({ ...scope, page: 1, limit: 8, orderBy: 'updatedAt' }),
          leads.countStatuses(scope, ['new', 'contacted', 'measuring', 'measured', 'assigned', 'designing', 'quoting']),
          appointments.listByDesigner(enterpriseId, staffId),
        ]);
        const appointmentLeads = await leads.findByIds(appointmentRows.map((item) => item.leadId));
        const leadMap = new Map(appointmentLeads.map((item) => [item.id, item]));
        return {
          role,
          title: '设计师工作台',
          subtitle: '聚焦本人负责的客户、预约与方案交付',
          summary: [
            { key: 'active', label: '进行中客户', value: Object.values(statusCounts).reduce((sum, value) => sum + value, 0), tone: 'green' },
            { key: 'appointment', label: '待服务预约', value: appointmentRows.length, tone: 'blue' },
            { key: 'handoff', label: '待量房交接', value: Number(statusCounts.measuring || 0), tone: 'orange' },
            { key: 'design', label: '方案协作', value: Number(statusCounts.measured || 0) + Number(statusCounts.designing || 0), tone: 'purple' },
          ],
          leads: leadList.rows.map(itemFromLead),
          appointments: appointmentRows.slice(0, 8).map((item) => itemFromAppointment(item, leadMap.get(item.leadId))),
        };
      }

      const appointmentRows = await appointments.listByMeasurer(enterpriseId, staffId);
      const appointmentLeads = await leads.findByIds(appointmentRows.map((item) => item.leadId));
      const leadMap = new Map(appointmentLeads.map((item) => [item.id, item]));
      const taskItems = appointmentRows.map((item) => itemFromAppointment(item, leadMap.get(item.leadId)));
      return {
        role,
        title: '测量员工作台',
        subtitle: '查看本人预约与量房交接，正式 BLE 量房仍在小程序完成',
        summary: [
          { key: 'schedule', label: '已确认预约', value: taskItems.length, tone: 'green' },
          { key: 'survey', label: '待完成量房', value: taskItems.filter((item) => Boolean(item.floorPlanId)).length, tone: 'blue' },
        ],
        tasks: taskItems.slice(0, 12),
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取员工工作台失败' }, { status: 500 });
  }
}
