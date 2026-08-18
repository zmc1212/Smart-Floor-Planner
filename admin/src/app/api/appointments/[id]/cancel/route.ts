import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'enterprise_admin'].includes(context.staff.role)) return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可取消预约' }, { status: 403 });
    const body = await request.json();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const appointmentId = BigInt((await params).id);
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findById(enterpriseId, appointmentId);
      if (context.staff!.role === 'designer' && access?.appointment.designerId !== BigInt(context.staff!._id)) return null;
      return repository.updateStatus({ enterpriseId, appointmentId, expectedVersion: parseAppointmentVersion(body.version), actorUserId: BigInt(context.user._id), status: 'cancelled', reason: typeof body.reason === 'string' ? body.reason : '', eventKey: `cancelled:${randomUUID()}` });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (!Number.isNaN(startAt.getTime())) {
      await Promise.allSettled([
        notifyAppointmentStaff({ enterpriseId, leadId: appointment.leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: `${appointment.id.toString()}:${appointment.version}`, eventType: 'cancelled' }),
        notifyCustomerOfAppointment({ enterpriseId, leadId: appointment.leadId, address: appointment.address, startsAt: startAt, eventType: 'cancelled' }),
      ]);
    }
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '取消预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}
