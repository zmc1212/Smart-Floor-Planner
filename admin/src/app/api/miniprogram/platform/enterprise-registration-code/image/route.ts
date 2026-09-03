import { NextResponse } from 'next/server';
import {
  enterpriseRegistrationCodeImageResponse,
  loadActiveEnterpriseRegistrationCodeImage,
} from '@/lib/enterprise-registration-code-image';
import {
  enterpriseRegistrationCodePosterResponse,
  loadActiveEnterpriseRegistrationCodePoster,
} from '@/lib/enterprise-registration-code-poster';
import {
  parsePlatformAdminActorId,
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function parseVariant(request: Request) {
  const variant = new URL(request.url).searchParams.get('variant');
  return variant === 'raw' ? 'raw' : 'poster';
}

type RegistrationCodeLoadFailure =
  | { ok: false; kind: 'active_code_not_found' }
  | { ok: false; kind: 'template_background_missing' }
  | { ok: false; kind: 'poster_composition_failed'; error: unknown }
  | { ok: false; kind: 'wechat_code_unavailable'; error: unknown };

function registrationCodeFailureResponse(result: RegistrationCodeLoadFailure) {
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
  if (result.kind === 'template_background_missing') {
    return NextResponse.json(
      {
        success: false,
        code: 'template_background_missing',
        error: '开户海报模板缺失，请联系平台管理员',
      },
      { status: 500 }
    );
  }
  if (result.kind === 'poster_composition_failed') {
    console.error('[MiniProgramEnterpriseRegistrationPoster]', result.error);
    return NextResponse.json(
      {
        success: false,
        code: 'poster_composition_failed',
        error: '开户海报暂时无法生成，请稍后重试',
      },
      { status: 500 }
    );
  }
  console.error('[MiniProgramEnterpriseRegistrationCode]', result.error);
  return NextResponse.json(
    {
      success: false,
      code: 'wechat_code_unavailable',
      error: '开户码暂时无法生成，请稍后重试。微信失败时当前码仍有效，不必换新。',
    },
    { status: 502 }
  );
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const actorStaffId = parsePlatformAdminActorId(context);
    const variant = parseVariant(request);
    if (variant === 'raw') {
      const result = await loadActiveEnterpriseRegistrationCodeImage({ actorStaffId });
      if (!result.ok) return registrationCodeFailureResponse(result);
      return enterpriseRegistrationCodeImageResponse(result);
    }
    const result = await loadActiveEnterpriseRegistrationCodePoster({ actorStaffId });
    if (!result.ok) return registrationCodeFailureResponse(result);
    return enterpriseRegistrationCodePosterResponse(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
