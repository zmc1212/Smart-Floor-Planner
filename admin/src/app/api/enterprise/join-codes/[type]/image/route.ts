import { NextResponse } from 'next/server';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { isEnterpriseJoinCodeType } from '@/lib/referrer-network-api';
import {
  createEnterpriseOnboardingCode,
  getMiniProgramCodeContentType,
} from '@/lib/wechat-miniprogram-code';
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
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const revealed = await withTenantTransaction(context.enterpriseId!, (transaction) =>
          new ReferrerNetworkRepository(transaction).revealActiveEnterpriseJoinCode({
            enterpriseId: parsePostgresId(context.enterpriseId!, 'enterpriseId'),
            codeType: type,
            actorStaffId: parsePostgresId(context.userId, 'staffId'),
          })
        );
        if (!revealed) {
          return NextResponse.json(
            { success: false, code: 'active_code_not_found', error: 'No active code' },
            { status: 404 }
          );
        }
        try {
          const image = await createEnterpriseOnboardingCode(revealed.token);
          const contentType = getMiniProgramCodeContentType(image) ?? 'application/octet-stream';
          const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
          return new NextResponse(image, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'private, no-store, max-age=0',
              'Content-Disposition': `inline; filename="${type}-onboarding-code.${extension}"`,
            },
          });
        } catch (error) {
          console.error('[Enterprise onboarding code provider]', error);
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
      { success: false, error: error instanceof Error ? error.message : 'Unable to generate onboarding code' },
      { status: 500 }
    );
  }
}
