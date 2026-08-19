import { NextResponse } from 'next/server';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
  enterpriseJoinCodeEventToDto,
  enterpriseJoinCodeToDto,
} from '@/lib/referrer-network-api';
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
        const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
        const { codes, events } = await withTenantTransaction(
          context.enterpriseId!,
          async (transaction) => {
            const network = new ReferrerNetworkRepository(transaction);
            const [codeRows, eventRows] = await Promise.all([
              network.listEnterpriseJoinCodes(enterpriseId),
              network.listEnterpriseJoinCodeEvents(enterpriseId),
            ]);
            return { codes: codeRows, events: eventRows };
          }
        );
        return NextResponse.json({
          success: true,
          data: {
            codes: codes.map(enterpriseJoinCodeToDto),
            events: events.map(enterpriseJoinCodeEventToDto),
          },
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
