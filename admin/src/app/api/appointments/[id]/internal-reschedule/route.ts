import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentDateTime, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getTenantContext(request);
    if (admin) {
      if (!admin.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可改期' }, { status: 403 });
      const body = await request.json();
      const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
      const appointmentId = BigInt((await params).id);
      const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (admin.role === 'designer' && access?.appointment.designerId !== parsePostgresId(admin.userId, 'user id')) return null;
        return repository.reschedule({
          enterpriseId,
          appointmentId,
          startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
          endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
          expectedVersion: parseAppointmentVersion(body.version),
          actorUserId: parsePostgresId(admin.userId, 'user id'),
          reason: typeof body.reason === 'string' ? body.reason : '',
          eventKey: `admin-internal-rescheduled:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
      const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
      if (!Number.isNaN(startAt.getTime())) {
        await Promise.allSettled([
          notifyAppointmentStaff({ enterpriseId, leadId: appointment.leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: `${appointment.id.toString()}:${appointment.version}`, eventType: 'internal_rescheduled' }),
          notifyCustomerOfAppointment({ enterpriseId, leadId: appointment.leadId, address: appointment.address, startsAt: startAt, eventType: 'internal_rescheduled' }),
        ]);
      }
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
    }
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'enterprise_admin'].includes(context.staff.role)) return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可改期' }, { status: 403 });
    const body = await request.json();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const appointmentId = BigInt((await params).id);
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findById(enterpriseId, appointmentId);
      if (context.staff!.role === 'designer' && access?.appointment.designerId !== BigInt(context.staff!._id)) return null;
      return repository.reschedule({
        enterpriseId, appointmentId,
        startAt: parseAppointmentDateTime(body.startAt, '开始时间'), endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
        expectedVersion: parseAppointmentVersion(body.version), actorUserId: BigInt(context.user._id),
        reason: typeof body.reason === 'string' ? body.reason : '', eventKey: `internal-rescheduled:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (!Number.isNaN(startAt.getTime())) {
      await Promise.allSettled([
        notifyAppointmentStaff({ enterpriseId, leadId: appointment.leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: `${appointment.id.toString()}:${appointment.version}`, eventType: 'internal_rescheduled' }),
        notifyCustomerOfAppointment({ enterpriseId, leadId: appointment.leadId, address: appointment.address, startsAt: startAt, eventType: 'internal_rescheduled' }),
      ]);
    }
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '内部改期失败' }, { status: httpErrorStatus(error, 400) });
  }
}
