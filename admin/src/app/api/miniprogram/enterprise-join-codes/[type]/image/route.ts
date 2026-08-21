import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getPlatformMiniProgramCodeConfig } from '@/lib/platform-mini-program-code-config';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  isEnterpriseJoinCodeType,
  referrerNetworkError,
} from '@/lib/referrer-network-api';
import {
  createEnterpriseOnboardingCode,
  getMiniProgramCodeContentType,
} from '@/lib/wechat-miniprogram-code';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const context = await resolveMiniProgramContext(request);
  if (!context) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  if (
    context.mode !== 'staff' ||
    !context.enterpriseId ||
    !context.staff ||
    context.staff.role !== 'enterprise_admin'
  ) {
    return referrerNetworkError('enterprise_admin_required', { status: 403 });
  }

  const { type } = await params;
  if (!isEnterpriseJoinCodeType(type)) {
    return referrerNetworkError('invalid_code_type', { status: 400 });
  }

  let revealed: { token: string } | null = null;
  try {
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const staffId = parsePostgresId(context.staff._id, 'staffId');
    revealed = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new ReferrerNetworkRepository(transaction).revealActiveEnterpriseJoinCode({
        enterpriseId,
        codeType: type,
        actorStaffId: staffId,
      })
    );
  } catch (error) {
    console.error('[MiniProgramEnterpriseJoinCodes] reveal failed', error);
    return referrerNetworkError('join_code_lookup_failed', { status: 500 });
  }

  if (!revealed) {
    return referrerNetworkError('active_code_not_found', { status: 404 });
  }

  try {
    const { environment } = await getPlatformMiniProgramCodeConfig();
    const image = await createEnterpriseOnboardingCode(revealed.token, {
      envVersion: environment,
    });
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
    console.error('[MiniProgramEnterpriseJoinCodes] WeChat code unavailable', error);
    return referrerNetworkError('wechat_code_unavailable', {
      status: 502,
      message: 'The WeChat Mini Program code is temporarily unavailable',
    });
  }
}
