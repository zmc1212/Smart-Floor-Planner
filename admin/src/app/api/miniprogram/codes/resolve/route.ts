import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  hashRequestAddress,
  normalizeOpaqueToken,
  readMiniProgramPayload,
  referrerNetworkError,
  sanitizeDeviceSummary,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = normalizeOpaqueToken(body.token);
    if (!token) {
      return referrerNetworkError('invalid_token', {
        message: 'A valid opaque token is required',
      });
    }
    const payload = await readMiniProgramPayload(request);
    const result = await withPlatformTransaction(async (transaction) => {
      const authenticatedUser = payload
        ? await new MiniProgramIdentityRepository(transaction).findUserById(
            parsePostgresId(payload.sub, 'user id')
          )
        : null;
      const actorUserId =
        authenticatedUser &&
        payload &&
        authenticatedUser.contextVersion === payload.contextVersion
          ? authenticatedUser.id
          : null;
      const repository = new ReferrerNetworkRepository(transaction);
      const joinCode = await repository.resolveEnterpriseJoinToken(
        token,
        actorUserId
      );
      if (joinCode.code) {
        return {
          kind: 'onboarding' as const,
          codeType: joinCode.code.codeType,
          result: joinCode.result,
        };
      }
      const promotionCode = await repository.resolvePromotionToken({
        token,
        sessionKey:
          typeof body.sessionKey === 'string'
            ? body.sessionKey.trim().slice(0, 120)
            : null,
        ipHash: hashRequestAddress(request),
        deviceSummary: sanitizeDeviceSummary(body.deviceSummary),
      });
      return {
        kind: 'referral' as const,
        codeType: null,
        result: promotionCode.result,
      };
    });

    if (result.result !== 'ok') {
      return referrerNetworkError(result.result);
    }
    return NextResponse.json({
      success: true,
      data: {
        kind: result.kind,
        ...(result.codeType ? { codeType: result.codeType } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to resolve code',
      },
      { status: 400 }
    );
  }
}
