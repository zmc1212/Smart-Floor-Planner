import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  normalizeOpaqueToken,
  promotionCodeToDto,
  promotionTokenForCode,
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }

  try {
    const body = await request.json();
    const token = normalizeOpaqueToken(body.token);
    if (!token) return referrerNetworkError('invalid_token');
    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim().slice(0, 30)
        : '';
    if (!displayName) {
      return referrerNetworkError('display_name_required', {
        message: '请填写推荐人姓名',
      });
    }
    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) return { authenticated: false as const };
      const repository = new ReferrerNetworkRepository(transaction);
      const onboarding = await repository.onboardReferrer({
        token,
        userId: authenticated.user.id,
        contextVersion: authenticated.user.contextVersion,
        displayName,
        membershipLimit: await repository.getMembershipLimit(),
      });
      if (!onboarding.ok) {
        return { authenticated: true as const, onboarding };
      }
      const contexts = await identities.listContexts(onboarding.user.id);
      const selected = contexts.find(
        (context) =>
          context.mode === 'referrer' &&
          context.referrerMembershipId === onboarding.membership.id
      );
      return {
        authenticated: true as const,
        onboarding,
        contexts,
        selected,
      };
    });

    if (!result.authenticated) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }
    if (!result.onboarding.ok) {
      return referrerNetworkError(result.onboarding.code);
    }
    if (!result.selected) {
      return referrerNetworkError('referrer_context_missing', { status: 500 });
    }
    const switchedToken = await signMiniProgramIdentityContextToken({
      userId: result.onboarding.user.id,
      contextVersion: result.onboarding.user.contextVersion,
      context: result.selected,
      source: payload.source,
    });
    return NextResponse.json({
      success: true,
      token: switchedToken,
      context: miniProgramIdentityContextToDto(result.selected),
      contexts: result.contexts.map(miniProgramIdentityContextToDto),
      data: {
        membershipId: result.onboarding.membership.id.toString(),
        enterpriseId: result.onboarding.membership.enterpriseId.toString(),
        status: result.onboarding.membership.status,
        promotionCode: {
          ...promotionCodeToDto(result.onboarding.promotionCode),
          token: promotionTokenForCode(result.onboarding.promotionCode),
        },
      },
      idempotent: result.onboarding.idempotent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to onboard referrer',
      },
      { status: 400 }
    );
  }
}
