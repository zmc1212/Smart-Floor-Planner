import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';
import {
  createStaffActivityServiceCode,
  getMiniProgramCodeContentType,
} from '@/lib/wechat-miniprogram-code';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  if (payload.mode !== 'staff' || !payload.staffId) {
    return referrerNetworkError('staff_context_required', { status: 403 });
  }

  let result;
  try {
    const staffId = parsePostgresId(payload.staffId, 'staffId');
    result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) return { authenticated: false as const };
      const activity = await new ReferrerNetworkRepository(
        transaction
      ).getStaffActivityCode(authenticated.user.id, staffId);
      return { authenticated: true as const, activity };
    });
  } catch (error) {
    console.error('[Staff activity code lookup]', error);
    return referrerNetworkError('activity_code_lookup_failed', { status: 500 });
  }
  if (!result.authenticated) {
    return referrerNetworkError('identity_context_changed', { status: 401 });
  }
  if (!result.activity.ok) {
    return referrerNetworkError(result.activity.code, {
      status: result.activity.code === 'staff_not_found' ? 404 : 403,
    });
  }

  try {
    const image = await createStaffActivityServiceCode(result.activity.token);
    const contentType = getMiniProgramCodeContentType(image) ?? 'application/octet-stream';
    const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
    return new NextResponse(image, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `inline; filename="staff-activity-code.${extension}"`,
      },
    });
  } catch (error) {
    console.error('[Staff activity code provider]', error);
    return referrerNetworkError('wechat_code_unavailable', {
      status: 502,
      message: 'The WeChat Mini Program code is temporarily unavailable',
    });
  }
}
