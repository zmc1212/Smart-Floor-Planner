import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  enterpriseRegistrationCodeImageResponse,
  loadActiveEnterpriseRegistrationCodeImage,
} from '@/lib/enterprise-registration-code-image';
import {
  enterpriseRegistrationCodePosterResponse,
  loadActiveEnterpriseRegistrationCodePoster,
} from '@/lib/enterprise-registration-code-poster';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

function parseVariant(request: Request) {
  const variant = new URL(request.url).searchParams.get('variant');
  return variant === 'raw' ? 'raw' : 'poster';
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const actorStaffId = parsePostgresId(context.userId, 'staffId');
        const variant = parseVariant(request);
        const result =
          variant === 'raw'
            ? await loadActiveEnterpriseRegistrationCodeImage({ actorStaffId })
            : await loadActiveEnterpriseRegistrationCodePoster({ actorStaffId });
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
          if (result.kind === 'template_background_missing') {
            return NextResponse.json(
              {
                success: false,
                code: 'template_background_missing',
                error: 'Enterprise registration poster template is missing',
              },
              { status: 500 }
            );
          }
          if (result.kind === 'poster_composition_failed') {
            console.error('[Enterprise registration poster]', result.error);
            return NextResponse.json(
              {
                success: false,
                code: 'poster_composition_failed',
                error: 'Unable to compose enterprise registration poster',
              },
              { status: 500 }
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
        return variant === 'raw'
          ? enterpriseRegistrationCodeImageResponse(result)
          : enterpriseRegistrationCodePosterResponse(result);
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
