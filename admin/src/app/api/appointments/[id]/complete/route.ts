import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentVersion } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || !context.staff || !['measurer', 'enterprise_admin'].includes(context.staff.role)) return NextResponse.json({ success: false, error: '仅测量员或企业负责人可完成预约' }, { status: 403 });
    const body = await request.json();
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
    const appointmentId = BigInt((await params).id);
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = await repository.findById(enterpriseId, appointmentId);
      if (context.staff!.role === 'measurer' && access?.appointment.measurerId !== BigInt(context.staff!._id)) return null;
      return repository.updateStatus({ enterpriseId, appointmentId, expectedVersion: parseAppointmentVersion(body.version), actorUserId: BigInt(context.user._id), status: 'completed', eventKey: `completed:${randomUUID()}` });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该预约' }, { status: 403 });
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '完成预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}
