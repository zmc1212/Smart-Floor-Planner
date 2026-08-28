import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  enterpriseRegistrationCodeImageResponse,
  loadActiveEnterpriseRegistrationCodeImage,
} from '@/lib/enterprise-registration-code-image';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const result = await loadActiveEnterpriseRegistrationCodeImage({
          actorStaffId: parsePostgresId(context.userId, 'staffId'),
        });
        if (!result.ok) {
          if (result.kind === 'active_code_not_found') {
            return NextResponse.json(
              {
                success: false,
                code: 'active_code_not_found',
                error: 'No active enterprise registration code',
              },
              { status: 404 }
            );
          }
          console.error('[Enterprise registration code provider]', result.error);
          return NextResponse.json(
            {
              success: false,
              code: 'wechat_code_unavailable',
              error: 'The WeChat Mini Program code is temporarily unavailable',
            },
            { status: 502 }
          );
        }
        return enterpriseRegistrationCodeImageResponse(result);
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to generate enterprise registration code',
      },
      { status: 500 }
    );
  }
}
