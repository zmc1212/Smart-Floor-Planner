import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminUserRepository, AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentDateTime, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export const dynamic = 'force-dynamic';

function canInternalReschedule(role: string, designerId: bigint, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && designerId === staffId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Resolve Mini Program staff before Admin JWT so a designer Bearer token is
    // never treated as an Admin session (payload.id is users.id, not admin_users.id).
    const miniContext = await resolveMiniProgramContext(request);
    if (miniContext) {
      if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'enterprise_admin'].includes(miniContext.staff.role)) {
        return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可改期' }, { status: 403 });
      }
      const body = await request.json();
      const enterpriseId = parsePostgresId(miniContext.enterpriseId, 'enterprise id');
      const appointmentId = parsePostgresId((await params).id, 'appointment id');
      const staffId = BigInt(miniContext.staff._id);
      const appointment = await withMiniProgramPostgresTransaction(miniContext, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canInternalReschedule(miniContext.staff!.role, access.appointment.designerId, staffId)) return null;
        return repository.reschedule({
          enterpriseId,
          appointmentId,
          startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
          endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
          expectedVersion: parseAppointmentVersion(body.version),
          actorUserId: BigInt(miniContext.user._id),
          reason: typeof body.reason === 'string' ? body.reason : '',
          eventKey: `internal-rescheduled:${randomUUID()}`,
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

    const admin = await getTenantContext(request);
    if (!admin?.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) {
      return NextResponse.json({ success: false, error: '仅负责设计师或企业负责人可改期' }, { status: admin ? 403 : 401 });
    }
    const body = await request.json();
    const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
    const appointmentId = parsePostgresId((await params).id, 'appointment id');
    const staffId = parsePostgresId(admin.userId, 'user id');
    const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const actorUserId = await new AdminUserRepository(transaction).findLinkedUserId(staffId);
      if (actorUserId == null) return null;
      const access = await repository.findById(enterpriseId, appointmentId);
      if (!access || !canInternalReschedule(admin.role, access.appointment.designerId, staffId)) return null;
      return repository.reschedule({
        enterpriseId,
        appointmentId,
        startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
        endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
        expectedVersion: parseAppointmentVersion(body.version),
        actorUserId,
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
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '内部改期失败' }, { status: httpErrorStatus(error, 400) });
  }
}
