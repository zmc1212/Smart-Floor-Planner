import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const promoterId = searchParams.get('promoterId');

    // Handle Mini Program context
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;
      if (staff.role === 'salesperson') {
      } else if (staff.role === 'admin' || staff.role === 'super_admin') {
      } else {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      const commissions = await withMiniProgramPostgresTransaction(mpContext, (transaction) =>
        new CommercialRepository(transaction).listCommissions({ status: status || undefined, promoterId: staff.role === 'salesperson' ? parsePostgresId(staff._id, 'staff id') : undefined })
      );
      return NextResponse.json({ success: true, data: commissions.map(commissionToDto) });
    }
    const context = await getTenantContext(request);
    if (!context) throw new Error('Unauthorized');
    const b2b = getPlatformB2BTenantContext(context);
    const filterPromoterId = b2b.role === 'salesperson'
      ? parsePostgresId(b2b.userId, 'userId')
      : promoterId && ['admin', 'super_admin'].includes(b2b.role) ? parsePostgresId(promoterId, 'promoterId') : undefined;
    const result = await withAdminPostgresTransaction(b2b, async (transaction) => {
      const repository = new CommercialRepository(transaction);
      return Promise.all([repository.listCommissions({ status: status || undefined, promoterId: filterPromoterId }), repository.commissionSummary({ status: status || undefined, promoterId: filterPromoterId })]);
    });
    return NextResponse.json({ success: true, data: result[0].map(commissionToDto), summary: result[1] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
