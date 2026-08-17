import { NextResponse } from 'next/server';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import {
  enterpriseJoinCodeToDto,
  isEnterpriseJoinCodeType,
} from '@/lib/referrer-network-api';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    if (!isEnterpriseJoinCodeType(type)) {
      return NextResponse.json(
        { success: false, code: 'invalid_code_type', error: 'Invalid code type' },
        { status: 400 }
      );
    }
    return await withTenantRoute(
      request,
      {
        roles: ['super_admin', 'admin', 'enterprise_admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const result = await withTenantTransaction(
          context.enterpriseId!,
          (transaction) =>
            new ReferrerNetworkRepository(transaction).disableEnterpriseJoinCode({
              enterpriseId: parsePostgresId(context.enterpriseId, 'enterpriseId'),
              codeType: type,
              actorStaffId: parsePostgresId(context.userId, 'staffId'),
            })
        );
        if (!result) {
          return NextResponse.json(
            { success: false, code: 'active_code_not_found', error: 'No active code' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: enterpriseJoinCodeToDto(result),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to disable join code',
      },
      { status: 500 }
    );
  }
}
