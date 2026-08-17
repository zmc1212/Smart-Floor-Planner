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
import { createPromotionServiceCode } from '@/lib/wechat-miniprogram-code';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }

  let membershipId: bigint;
  try {
    membershipId = parsePostgresId((await params).id, 'membershipId');
  } catch {
    return referrerNetworkError('invalid_membership_id', { status: 400 });
  }

  let result;
  try {
    result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) return { authenticated: false as const };
      const promotion = await new ReferrerNetworkRepository(
        transaction
      ).getReferrerPromotionCode(authenticated.user.id, membershipId);
      return { authenticated: true as const, promotion };
    });
  } catch (error) {
    console.error('[Promotion service code lookup]', error);
    return referrerNetworkError('promotion_code_lookup_failed', { status: 500 });
  }
  if (!result.authenticated) {
    return referrerNetworkError('identity_context_changed', { status: 401 });
  }
  if (!result.promotion) {
    return referrerNetworkError('membership_not_found', { status: 404 });
  }

  try {
    const image = await createPromotionServiceCode(result.promotion.token);
    return new NextResponse(image, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': 'inline; filename="promotion-service-code.png"',
      },
    });
  } catch (error) {
    console.error('[Promotion service code provider]', error);
    return referrerNetworkError('wechat_code_unavailable', {
      status: 502,
      message: 'The WeChat Mini Program code is temporarily unavailable',
    });
  }
}
