import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentAddress, parseAppointmentDateTime, parseAppointmentId } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    const leadIdText = new URL(request.url).searchParams.get('leadId');
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      if (context.mode === 'customer') {
        const leadId = parseAppointmentId(leadIdText, '线索');
        const lead = await repository.findCustomerLeadForAccess(BigInt(context.user._id), leadId);
        return lead?.enterpriseId ? repository.listByLead(lead.enterpriseId, leadId) : null;
      }
      if (!context.enterpriseId) return null;
      const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
      if (context.mode === 'staff' && context.staff?.role === 'measurer' && !leadIdText) {
        return repository.listByMeasurer(enterpriseId, BigInt(context.staff._id));
      }
      const leadId = parseAppointmentId(leadIdText, '线索');
      const lead = await repository.findLeadForAccess(enterpriseId, leadId);
      if (!lead) return null;
      if (context.mode === 'staff' && context.staff?.role === 'designer' && lead.assignedTo !== BigInt(context.staff._id)) return null;
      if (context.mode === 'staff' && context.staff?.role === 'measurer' && lead.measurerId !== BigInt(context.staff._id)) return null;
      return repository.listByLead(enterpriseId, leadId);
    });
    if (!data) return NextResponse.json({ success: false, error: '无权查看该预约' }, { status: 403 });
    return NextResponse.json({ success: true, data: data.map(appointmentToDto) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'enterprise_admin'].includes(context.staff.role)) {
      return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可创建预约' }, { status: 403 });
    }
    const body = await request.json();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const leadId = parseAppointmentId(body.leadId, '线索');
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findLeadForAccess(enterpriseId, leadId);
      if (context.staff!.role === 'designer' && access?.assignedTo !== BigInt(context.staff!._id)) {
        return null;
      }
      return repository.create({
        enterpriseId, leadId,
        startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
        endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
        address: parseAppointmentAddress(body.address),
        actorUserId: BigInt(context.user._id),
        eventKey: `created:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该线索' }, { status: 403 });
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (!Number.isNaN(startAt.getTime())) {
      await Promise.allSettled([
        notifyAppointmentStaff({ enterpriseId, leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: appointment.id.toString(), eventType: 'created' }),
        notifyCustomerOfAppointment({ enterpriseId, leadId, address: appointment.address, startsAt: startAt, eventType: 'created' }),
      ]);
    }
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '创建预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}
