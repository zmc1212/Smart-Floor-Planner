import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadCommissionRepository } from '@/db/repositories';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramEnterpriseAdmin(context);
    const body = await request.json() as { commissionIds?: unknown };
    if (!Array.isArray(body.commissionIds)) {
      return NextResponse.json({ success: false, error: 'commissionIds 必须是数组' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
    const actorId = parsePostgresId(context.staff!._id, 'staff id');
    const commissionIds = body.commissionIds.map((id) => parsePostgresId(id, 'commission id'));
    const rows = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new LeadCommissionRepository(transaction).markPaid(enterpriseId, commissionIds, actorId)
    );
    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id.toString(),
        status: row.status,
        paidAt: row.paidAt,
        paidBy: row.paidBy?.toString() ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '标记提成已支付失败',
    }, { status: httpErrorStatus(error, 400) });
  }
}
