import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminUserRepository, AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentAddress, parseAppointmentLocation, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type StaffRole = 'designer' | 'measurer' | 'enterprise_admin';

function canUpdate(role: StaffRole, appointment: { designerId: bigint; measurerId: bigint }, staffId: bigint) {
  return role === 'enterprise_admin' ||
    (role === 'designer' && appointment.designerId === staffId) ||
    (role === 'measurer' && appointment.measurerId === staffId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const appointmentId = parsePostgresId((await params).id, 'appointment id');
    const address = parseAppointmentAddress(body.address);
    const location = parseAppointmentLocation(body.location);
    const version = parseAppointmentVersion(body.version);

    const miniContext = await resolveMiniProgramContext(request);
    if (miniContext) {
      if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'measurer', 'enterprise_admin'].includes(miniContext.staff.role)) {
        return NextResponse.json({ success: false, error: '仅设计师、测量员或企业负责人可补充服务地址' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(miniContext.enterpriseId, 'enterprise id');
      const staffId = BigInt(miniContext.staff._id);
      const appointment = await withMiniProgramPostgresTransaction(miniContext, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canUpdate(miniContext.staff!.role as StaffRole, access.appointment, staffId)) return null;
        return repository.updateAddress({
          enterpriseId,
          appointmentId,
          address,
          location,
          expectedVersion: version,
          actorUserId: BigInt(miniContext.user._id),
          eventKey: `staff-address-updated:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权更新该预约地址' }, { status: 403 });
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
    }

    const admin = await getTenantContext(request);
    if (admin) {
      if (!admin.enterpriseId || !['designer', 'measurer', 'enterprise_admin'].includes(admin.role)) {
        return NextResponse.json({ success: false, error: '仅设计师、测量员或企业负责人可补充服务地址' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
      const staffId = parsePostgresId(admin.userId, 'user id');
      const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const actorUserId = await new AdminUserRepository(transaction).findLinkedUserId(staffId);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canUpdate(admin.role as StaffRole, access.appointment, staffId)) return null;
        return repository.updateAddress({
          enterpriseId,
          appointmentId,
          address,
          location,
          expectedVersion: version,
          actorUserId,
          eventKey: `admin-address-updated:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权更新该预约地址' }, { status: 403 });
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
    }

    return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '更新服务地址失败' }, { status: httpErrorStatus(error, 400) });
  }
}
