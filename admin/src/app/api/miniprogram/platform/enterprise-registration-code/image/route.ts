import { NextResponse } from 'next/server';
import {
  enterpriseRegistrationCodeImageResponse,
  loadActiveEnterpriseRegistrationCodeImage,
} from '@/lib/enterprise-registration-code-image';
import {
  parsePlatformAdminActorId,
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const result = await loadActiveEnterpriseRegistrationCodeImage({
      actorStaffId: parsePlatformAdminActorId(context),
    });
    if (!result.ok) {
      if (result.kind === 'active_code_not_found') {
        return NextResponse.json(
          {
            success: false,
            code: 'active_code_not_found',
            error: '暂无生效开户码，请在电脑后台生成',
          },
          { status: 404 }
        );
      }
      console.error('[MiniProgramEnterpriseRegistrationCode]', result.error);
      return NextResponse.json(
        {
          success: false,
          code: 'wechat_code_unavailable',
          error:
            '开户码暂时无法生成，请稍后重试。微信失败时当前码仍有效，不必换新。',
        },
        { status: 502 }
      );
    }

    return enterpriseRegistrationCodeImageResponse(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
