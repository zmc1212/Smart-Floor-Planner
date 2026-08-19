import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentAddress, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type StaffRole = 'designer' | 'measurer' | 'enterprise_admin';

function canUpdate(role: StaffRole, appointment: { designerId: bigint; measurerId: bigint }, userId: bigint) {
  return role === 'enterprise_admin' ||
    (role === 'designer' && appointment.designerId === userId) ||
    (role === 'measurer' && appointment.measurerId === userId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const appointmentId = parsePostgresId((await params).id, 'appointment id');
    const address = parseAppointmentAddress(body.address);
    const version = parseAppointmentVersion(body.version);

    const admin = await getTenantContext(request);
    if (admin) {
      if (!admin.enterpriseId || !['designer', 'measurer', 'enterprise_admin'].includes(admin.role)) {
        return NextResponse.json({ success: false, error: '仅设计师、测量员或企业负责人可补充服务地址' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
      const userId = parsePostgresId(admin.userId, 'user id');
      const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canUpdate(admin.role as StaffRole, access.appointment, userId)) return null;
        return repository.updateAddress({
          enterpriseId,
          appointmentId,
          address,
          expectedVersion: version,
          actorUserId: userId,
          eventKey: `admin-address-updated:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权更新该预约地址' }, { status: 403 });
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
    }

    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'measurer', 'enterprise_admin'].includes(context.staff.role)) {
      return NextResponse.json({ success: false, error: '仅设计师、测量员或企业负责人可补充服务地址' }, { status: 403 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const userId = BigInt(context.staff._id);
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findById(enterpriseId, appointmentId);
      if (!access || !canUpdate(context.staff!.role as StaffRole, access.appointment, userId)) return null;
      return repository.updateAddress({
        enterpriseId,
        appointmentId,
        address,
        expectedVersion: version,
        actorUserId: BigInt(context.user._id),
        eventKey: `staff-address-updated:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权更新该预约地址' }, { status: 403 });
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '更新服务地址失败' }, { status: httpErrorStatus(error, 400) });
  }
}
