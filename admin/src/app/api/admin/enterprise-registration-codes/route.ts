import { NextResponse } from 'next/server';
import { EnterpriseRegistrationCodeRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  enterpriseRegistrationCodeEventToDto,
  enterpriseRegistrationCodeToDto,
} from '@/lib/enterprise-registration-api';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['super_admin', 'admin'],
        requireEnterprise: false,
      },
      async () => {
        const { code, events } = await withPlatformTransaction(
          async (transaction) => {
            const repository = new EnterpriseRegistrationCodeRepository(
              transaction
            );
            const [active, eventRows] = await Promise.all([
              repository.getActiveCode(),
              repository.listEvents(),
            ]);
            return { code: active, events: eventRows };
          }
        );
        return NextResponse.json({
          success: true,
          data: {
            code: code ? enterpriseRegistrationCodeToDto(code) : null,
            events: events.map(enterpriseRegistrationCodeEventToDto),
          },
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
            : 'Unable to list enterprise registration codes',
      },
      { status: 500 }
    );
  }
}
