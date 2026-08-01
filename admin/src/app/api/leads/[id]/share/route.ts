import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const lead = await withAdminPostgresTransaction(context, (transaction) =>
      new LeadRepository(transaction).findById(
        parsePostgresId(id, 'lead id')
      )
    );
    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          'WeCom group sharing is unavailable until enterprise WeCom configuration is migrated to PostgreSQL',
      },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
