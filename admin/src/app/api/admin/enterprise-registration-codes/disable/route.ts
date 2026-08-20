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
        const disabled = await withPlatformTransaction((transaction) =>
          new EnterpriseRegistrationCodeRepository(transaction).disable({
            actorStaffId: parsePostgresId(context.userId, 'staffId'),
          })
        );
        if (!disabled) {
          return NextResponse.json(
            {
              success: false,
              code: 'active_code_not_found',
              error: 'No active enterprise registration code',
            },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: enterpriseRegistrationCodeToDto(disabled),
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
            : 'Unable to disable enterprise registration code',
      },
      { status: 500 }
    );
  }
}
