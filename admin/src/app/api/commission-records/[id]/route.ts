import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { CommercialRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const b2b = getPlatformB2BTenantContext(context);
    return await withAdminPostgresTransaction(b2b, async (transaction) => {
      const body = await request.json();
      const { id } = await params;
      const status = body.status;

      if (!['pending_settlement', 'paid', 'voided'].includes(status)) {
        return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
      }

      const updateData: { status: string; settledAt?: Date; settledBy?: bigint } = { status };
      if (status === 'paid' || status === 'voided') {
        updateData.settledAt = new Date();
        updateData.settledBy = parsePostgresId(context.userId, 'userId');
      }

      const record = await new CommercialRepository(transaction).updateCommission(parsePostgresId(id, 'commission id'), updateData);
      if (!record) {
        return NextResponse.json({ success: false, error: 'Commission not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: commissionToDto(record) });
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
