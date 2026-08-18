import { NextResponse } from 'next/server';
import { LeadCommissionRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const actorId = parsePostgresId(context.userId, 'actor id');
      const body = await request.json() as { commissionIds?: unknown };
      if (!Array.isArray(body.commissionIds)) {
        return NextResponse.json({ success: false, error: 'commissionIds 必须是数组' }, { status: 400 });
      }
      const commissionIds = body.commissionIds.map((id) => parsePostgresId(id, 'commission id'));
      const rows = await withTenantTransaction(enterpriseId, (transaction) =>
        new LeadCommissionRepository(transaction).markPaid(enterpriseId, commissionIds, actorId)
      );
      return NextResponse.json({ success: true, data: rows.map((row) => ({
        id: row.id.toString(), status: row.status, paidAt: row.paidAt, paidBy: row.paidBy?.toString() ?? null,
      })) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '标记提成已支付失败' }, { status: httpErrorStatus(error, 400) });
  }
}
