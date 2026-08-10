import { NextResponse } from 'next/server';
import { acquisitionCommissionToDto, commissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository, CommercialRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;

      if (staff.role === 'measurer') {
        const items = await withMiniProgramPostgresTransaction(mpContext, (transaction) =>
          new AcquisitionRepository(transaction).listCommissions({ measurerId: parsePostgresId(staff._id, 'staff id') })
        );
        return NextResponse.json({ success: true, data: items.map(acquisitionCommissionToDto), type: 'lead_acquisition' });
      }

      const items = await withMiniProgramPostgresTransaction(mpContext, (transaction) =>
        new CommercialRepository(transaction).listCommissions({ promoterId: staff.role === 'salesperson' ? parsePostgresId(staff._id, 'staff id') : undefined })
      );
      return NextResponse.json({ success: true, data: items.map(commissionToDto) });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const b2b = getPlatformB2BTenantContext(context);
    const items = await withAdminPostgresTransaction(b2b, (transaction) =>
      new CommercialRepository(transaction).listCommissions({ promoterId: b2b.role === 'salesperson' ? parsePostgresId(b2b.userId, 'userId') : undefined })
    );
    return NextResponse.json({ success: true, data: items.map(commissionToDto) });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
