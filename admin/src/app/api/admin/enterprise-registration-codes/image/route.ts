import { NextResponse } from 'next/server';
import { EnterpriseRegistrationCodeRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  createEnterpriseRegistrationCode,
  getMiniProgramCodeContentType,
} from '@/lib/wechat-miniprogram-code';
import { getPlatformMiniProgramCodeConfig } from '@/lib/platform-mini-program-code-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const revealed = await withPlatformTransaction((transaction) =>
          new EnterpriseRegistrationCodeRepository(transaction).revealActive({
            actorStaffId: parsePostgresId(context.userId, 'staffId'),
          })
        );
        if (!revealed) {
          return NextResponse.json(
            {
              success: false,
              code: 'active_code_not_found',
              error: 'No active enterprise registration code',
            },
            { status: 404 }
          );
        }
        try {
          const { environment } = await getPlatformMiniProgramCodeConfig();
          const image = await createEnterpriseRegistrationCode(revealed.token, {
            envVersion: environment,
          });
          const contentType =
            getMiniProgramCodeContentType(image) ?? 'application/octet-stream';
          const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
          return new NextResponse(image, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'private, no-store, max-age=0',
              'Content-Disposition': `inline; filename="enterprise-registration-code.${extension}"`,
            },
          });
        } catch (error) {
          console.error('[Enterprise registration code provider]', error);
          return NextResponse.json(
            {
              success: false,
              code: 'wechat_code_unavailable',
              error: 'The WeChat Mini Program code is temporarily unavailable',
            },
            { status: 502 }
          );
        }
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
