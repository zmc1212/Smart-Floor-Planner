import { NextResponse } from 'next/server';
import { EnterpriseRegistrationCodeRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { enterpriseRegistrationCodeToDto } from '@/lib/enterprise-registration-api';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const body = await request.json().catch(() => ({}));
        const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
        if (
          expiresAt &&
          (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
        ) {
          return NextResponse.json(
            {
              success: false,
              code: 'invalid_expiry',
              error: 'expiresAt must be in the future',
            },
            { status: 400 }
          );
        }
        const result = await withPlatformTransaction((transaction) =>
          new EnterpriseRegistrationCodeRepository(transaction).rotate({
            actorStaffId: parsePostgresId(context.userId, 'staffId'),
            expiresAt,
          })
        );
        return NextResponse.json({
          success: true,
          data: enterpriseRegistrationCodeToDto(result.code),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to rotate enterprise registration code',
      },
      { status: 500 }
    );
  }
}
