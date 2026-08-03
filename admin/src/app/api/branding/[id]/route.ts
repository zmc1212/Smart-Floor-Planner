import { NextResponse } from 'next/server';
import { EnterpriseRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[1-9]\d*$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
    }
    const enterprise = await withPlatformTransaction((transaction) =>
      new EnterpriseRepository(transaction).findById(parsePostgresId(id, 'enterpriseId'))
    );

    if (!enterprise) {
      return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
    }

    if (enterprise.status !== 'active') {
      return NextResponse.json({ success: false, error: 'Enterprise is not active' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: {
        name: enterprise.name,
        logo: enterprise.logo,
        branding: Object.keys(enterprise.branding || {}).length ? enterprise.branding : {
          primaryColor: '#171717',
          accentColor: '#0070f3'
        }
      }
    });
  } catch (error: unknown) {
    console.error(`[API] Branding GET error:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
