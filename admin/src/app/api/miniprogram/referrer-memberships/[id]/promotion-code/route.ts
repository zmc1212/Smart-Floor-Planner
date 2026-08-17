import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  promotionCodeToDto,
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  try {
    const membershipId = parsePostgresId((await params).id, 'membershipId');
    const result = await withPlatformTransaction(async (transaction) => {
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
    if (!result.authenticated) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }
    if (!result.promotion) {
      return referrerNetworkError('membership_not_found', { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: {
        ...promotionCodeToDto(result.promotion.code),
        token: result.promotion.token,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to load promotion code',
      },
      { status: 400 }
    );
  }
}
