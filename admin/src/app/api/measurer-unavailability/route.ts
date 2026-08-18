import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import type { PostgresTransaction } from '@/db/transaction';
import { parseAppointmentDateTime, parseAppointmentId } from '@/lib/appointment-api';
import { getTenantContext } from '@/lib/auth';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

function dto(row: Awaited<ReturnType<AppointmentRepository['listUnavailability']>>[number]) {
  return { ...row, id: row.id.toString(), enterpriseId: row.enterpriseId.toString(), staffId: row.staffId.toString(), createdBy: row.createdBy?.toString() ?? null };
}

export async function GET(request: Request) {
  try {
    const mini = await resolveMiniProgramContext(request);
    const admin = mini ? null : await getTenantContext(request);
    const enterpriseId = mini?.enterpriseId || admin?.enterpriseId;
    if (!enterpriseId) return NextResponse.json({ success: false, error: '需要有效企业上下文' }, { status: 401 });
    if (mini && (mini.mode !== 'staff' || !mini.staff || !['measurer', 'enterprise_admin'].includes(mini.staff.role))) return NextResponse.json({ success: false, error: '无权查看不可用时间' }, { status: 403 });
    const targetStaffId = new URL(request.url).searchParams.get('staffId');
    const staffId = mini?.staff?.role === 'measurer' ? BigInt(mini.staff._id) : targetStaffId ? parseAppointmentId(targetStaffId, '测量员') : undefined;
    const read = (transaction: PostgresTransaction) => new AppointmentRepository(transaction).listUnavailability(parsePostgresId(enterpriseId, 'enterprise id'), staffId);
    const rows = mini ? await withMiniProgramPostgresTransaction(mini, read) : await withAdminPostgresTransaction(admin!, read);
    return NextResponse.json({ success: true, data: rows.map(dto) });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取不可用时间失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function POST(request: Request) {
  try {
    const mini = await resolveMiniProgramContext(request);
    if (!mini?.enterpriseId || mini.mode !== 'staff' || !mini.staff || !['measurer', 'enterprise_admin'].includes(mini.staff.role)) return NextResponse.json({ success: false, error: '仅测量员或企业负责人可设置不可用时间' }, { status: 403 });
    const body = await request.json();
    const staffId = mini.staff.role === 'measurer' ? BigInt(mini.staff._id) : parseAppointmentId(body.staffId, '测量员');
    const row = await withMiniProgramPostgresTransaction(mini, (transaction) => new AppointmentRepository(transaction).createUnavailability({
      enterpriseId: parsePostgresId(mini.enterpriseId!, 'enterprise id'), staffId,
      startAt: parseAppointmentDateTime(body.startAt, '开始时间'), endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
      reason: typeof body.reason === 'string' ? body.reason : null, createdBy: BigInt(mini.staff!._id),
    }));
    return NextResponse.json({ success: true, data: dto(row) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '设置不可用时间失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function DELETE(request: Request) {
  try {
    const mini = await resolveMiniProgramContext(request);
    if (!mini?.enterpriseId || mini.mode !== 'staff' || !mini.staff || !['measurer', 'enterprise_admin'].includes(mini.staff.role)) return NextResponse.json({ success: false, error: '仅测量员或企业负责人可删除不可用时间' }, { status: 403 });
    const id = parseAppointmentId(new URL(request.url).searchParams.get('id'), '不可用时间');
    const deleted = await withMiniProgramPostgresTransaction(mini, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      if (mini.staff!.role === 'measurer') {
        const own = (await repository.listUnavailability(parsePostgresId(mini.enterpriseId!, 'enterprise id'), BigInt(mini.staff!._id))).some((row) => row.id === id);
        if (!own) return false;
      }
      return repository.deleteUnavailability(parsePostgresId(mini.enterpriseId!, 'enterprise id'), id);
    });
    return NextResponse.json({ success: deleted, deleted });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '删除不可用时间失败' }, { status: httpErrorStatus(error, 400) });
  }
}
