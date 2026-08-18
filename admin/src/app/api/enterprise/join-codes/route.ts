import { NextResponse } from 'next/server';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { enterpriseJoinCodeToDto } from '@/lib/referrer-network-api';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['super_admin', 'admin', 'enterprise_admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const rows = await withTenantTransaction(
          context.enterpriseId!,
          (transaction) =>
            new ReferrerNetworkRepository(
              transaction
            ).listEnterpriseJoinCodes(
              parsePostgresId(context.enterpriseId, 'enterpriseId')
            )
        );
        return NextResponse.json({
          success: true,
          data: rows.map(enterpriseJoinCodeToDto),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to list join codes',
      },
      { status: 500 }
    );
  }
}
