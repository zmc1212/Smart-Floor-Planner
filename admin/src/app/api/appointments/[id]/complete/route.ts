import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminUserRepository, AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

function canComplete(role: string, measurerId: bigint, staffId: bigint) {
  return role === 'enterprise_admin' || (['designer', 'measurer'].includes(role) && measurerId === staffId);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const appointmentId = parsePostgresId((await params).id, 'appointment id');
    const version = parseAppointmentVersion(body.version);
    // parseAppointmentVersion throws on invalid values, so `version` is always a valid integer number here.
    const expectedVersion = version;

    const miniContext = await resolveMiniProgramContext(request);
    if (miniContext) {
      if (!miniContext.enterpriseId || miniContext.mode !== 'staff' || !miniContext.staff || !['designer', 'measurer', 'enterprise_admin'].includes(miniContext.staff.role)) {
        return NextResponse.json({ success: false, error: '仅已派测量员或企业负责人可完成预约' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(miniContext.enterpriseId, 'enterprise id');
      const staffId = BigInt(miniContext.staff._id);
      const appointment = await withMiniProgramPostgresTransaction(miniContext, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const access = await repository.findById(enterpriseId, appointmentId);
        if (!access || !canComplete(miniContext.staff!.role, access.appointment.measurerId, staffId)) return null;
        if (!(await repository.hasCompletedFormalSurveyForLead(enterpriseId, access.appointment.leadId))) {
          throw Object.assign(new Error('请先完成并保存正式量房数据'), { code: 'appointment_survey_required', status: 409 });
        }
        return repository.updateStatus({
          enterpriseId, appointmentId, expectedVersion, actorUserId: BigInt(miniContext.user._id),
          status: 'completed', eventKey: `completed:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
    }

    const admin = await getTenantContext(request);
    if (!admin?.enterpriseId || !['designer', 'measurer', 'enterprise_admin'].includes(admin.role)) {
      return NextResponse.json({ success: false, error: '仅已派测量员或企业负责人可完成预约' }, { status: admin ? 403 : 401 });
    }
    const enterpriseId = parsePostgresId(admin.enterpriseId, 'enterprise id');
    const staffId = parsePostgresId(admin.userId, 'user id');
    const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const actorUserId = await new AdminUserRepository(transaction).findLinkedUserId(staffId);
      if (actorUserId == null) return null;
      const access = await repository.findById(enterpriseId, appointmentId);
      if (!access || !canComplete(admin.role, access.appointment.measurerId, staffId)) return null;
      if (!(await repository.hasCompletedFormalSurveyForLead(enterpriseId, access.appointment.leadId))) {
        throw Object.assign(new Error('请先完成并保存正式量房数据'), { code: 'appointment_survey_required', status: 409 });
      }
      return repository.updateStatus({
        enterpriseId, appointmentId, expectedVersion, actorUserId,
        status: 'completed', eventKey: `admin-completed:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '完成预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}
