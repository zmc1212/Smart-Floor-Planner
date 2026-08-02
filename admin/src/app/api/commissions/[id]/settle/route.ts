import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

/**
 * 结算佣金
 * POST /api/commissions/[id]/settle
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    
    // 只有平台管理员或超级管理员可以操作结算
    if (!context || !['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const b2b = getPlatformB2BTenantContext(context);
    return await withAdminPostgresTransaction(b2b, async (transaction) => {
      const { id } = await params;

      const repository = new CommercialRepository(transaction);
      const commission = await repository.findCommissionById(parsePostgresId(id, 'commission id'));
      if (!commission) {
        return NextResponse.json({ success: false, error: 'Commission record not found' }, { status: 404 });
      }

      if (commission.status !== 'pending_settlement') {
        return NextResponse.json({ success: false, error: 'Commission already settled or voided' }, { status: 400 });
      }

      const settled = await repository.updateCommission(commission.id, { status: 'paid', settledAt: new Date(), settledBy: parsePostgresId(context.userId, 'userId') });
      return NextResponse.json({ success: true, data: settled ? commissionToDto(settled) : null });
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
