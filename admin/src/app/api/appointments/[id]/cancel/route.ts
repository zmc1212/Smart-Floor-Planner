import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminUserRepository, AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

function canCancel(role: string, designerId: bigint, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && designerId === staffId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const appointmentId = parsePostgresId((await params).id, 'appointment id');
    const version = parseAppointmentVersion(body.version);
    const reason = typeof body.reason === 'string' ? body.reason : '';
    // parseAppointmentVersion throws on invalid values, so `version` is always a valid integer number here.
    const expectedVersion = version;

    const miniContext = await resolveMiniProgramContext(request);
    if (miniContext) {
      if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'enterprise_admin'].includes(miniContext.staff.role)) {
        return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可取消预约' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(miniContext.enterpriseId, 'enterprise id');
      const staffId = BigInt(miniContext.staff._id);
      const appointment = await withMiniProgramPostgresTransaction(miniContext, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canCancel(miniContext.staff!.role, access.appointment.designerId, staffId)) return null;
        return repository.updateStatus({
          enterpriseId, appointmentId, expectedVersion, actorUserId: BigInt(miniContext.user._id),
          status: 'cancelled', reason, eventKey: `cancelled:${randomUUID()}`,
        });
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
    }

    const admin = await getTenantContext(request);
    if (!admin?.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) {
      return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可取消预约' }, { status: admin ? 403 : 401 });
    }
    const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
    const staffId = parsePostgresId(admin.userId, 'user id');
    const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const actorUserId = await new AdminUserRepository(transaction).findLinkedUserId(staffId);
      if (actorUserId == null) return null;
      const access = await repository.findById(enterpriseId, appointmentId);
      if (!access || !canCancel(admin.role, access.appointment.designerId, staffId)) return null;
      return repository.updateStatus({
        enterpriseId, appointmentId, expectedVersion, actorUserId,
        status: 'cancelled', reason, eventKey: `admin-cancelled:${randomUUID()}`,
      });
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
