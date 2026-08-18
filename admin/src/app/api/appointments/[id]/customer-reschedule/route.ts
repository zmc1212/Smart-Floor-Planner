import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { appointmentToDto, parseAppointmentDateTime, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context || context.mode !== 'customer') return NextResponse.json({ success: false, error: '仅客户本人可改期' }, { status: 403 });
    const body = await request.json();
    const appointmentId = BigInt((await params).id);
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findCustomerAppointmentForAccess(BigInt(context.user._id), appointmentId);
      if (!access?.appointment.enterpriseId) return null;
      return repository.reschedule({
        enterpriseId: access.appointment.enterpriseId,
        appointmentId,
        startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
        endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
        expectedVersion: parseAppointmentVersion(body.version),
        actorUserId: BigInt(context.user._id),
        customerUserId: BigInt(context.user._id),
        eventKey: `customer-rescheduled:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '预约不存在或无权改期' }, { status: 403 });
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (!Number.isNaN(startAt.getTime())) {
      const enterpriseId = appointment.enterpriseId;
      await Promise.allSettled([
        notifyAppointmentStaff({ enterpriseId, leadId: appointment.leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: `${appointment.id.toString()}:${appointment.version}`, eventType: 'customer_rescheduled' }),
        notifyCustomerOfAppointment({ enterpriseId, leadId: appointment.leadId, address: appointment.address, startsAt: startAt, eventType: 'customer_rescheduled' }),
      ]);
    }
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '客户改期失败' }, { status: httpErrorStatus(error, 400) });
  }
}
