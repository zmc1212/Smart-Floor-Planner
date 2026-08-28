import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

function monthStart() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function listCommissionPage(
  repository: CommercialRepository,
  promoterId: bigint | undefined,
  status: string | undefined,
  page: number,
  limit: number
) {
  const [items, total, summary, monthCount] = await Promise.all([
    repository.listCommissions({ promoterId, status, page, limit }),
    repository.countCommissions({ promoterId, status }),
    repository.commissionSummary({ promoterId }),
    repository.countCommissionsGeneratedSince({ promoterId, since: monthStart() }),
  ]);
  return {
    items: items.map(commissionToDto),
    summary: {
      pending: summary.pending_settlement || { amount: 0, count: 0 },
      paid: summary.paid || { amount: 0, count: 0 },
      monthCount,
    },
    pagination: createPaginationMetadata(total, page, limit),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { page, limit } = getPaginationParams(url);
    const status = url.searchParams.get('status')?.trim() || undefined;

    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;
      const promoterId = staff.role === 'salesperson' ? parsePostgresId(staff._id, 'staff id') : undefined;
      const payload = await withMiniProgramPostgresTransaction(mpContext, (transaction) =>
        listCommissionPage(new CommercialRepository(transaction), promoterId, status, page, limit)
      );
      return NextResponse.json({ success: true, data: payload.items, summary: payload.summary, pagination: payload.pagination });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const b2b = getPlatformB2BTenantContext(context);
    const promoterId = b2b.role === 'salesperson' ? parsePostgresId(b2b.userId, 'userId') : undefined;
    const payload = await withAdminPostgresTransaction(b2b, (transaction) =>
      listCommissionPage(new CommercialRepository(transaction), promoterId, status, page, limit)
    );
    return NextResponse.json({ success: true, data: payload.items, summary: payload.summary, pagination: payload.pagination });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
