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
        const actorStaffId = parsePostgresId(context.userId, 'staffId');
        const body = await request.json().catch(() => ({}));
        const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
        if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
          return NextResponse.json(
            { success: false, code: 'invalid_expiry', error: 'expiresAt must be in the future' },
            { status: 400 }
          );
        }
        const result = await withTenantTransaction(
          context.enterpriseId!,
          (transaction) =>
            new ReferrerNetworkRepository(transaction).rotateEnterpriseJoinCode({
              enterpriseId: parsePostgresId(context.enterpriseId, 'enterpriseId'),
              codeType: type,
              actorStaffId,
              // The legacy Admin endpoint manages the enterprise-wide code;
              // personal employee codes are owned by Mini Program routes.
              inviterStaffId: null,
              expiresAt,
            })
        );
        return NextResponse.json({
          success: true,
          data: enterpriseJoinCodeToDto(result.code),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to rotate join code',
      },
      { status: 500 }
    );
  }
}
