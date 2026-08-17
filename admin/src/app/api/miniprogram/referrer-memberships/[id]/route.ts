import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  readMiniProgramPayload,
  referrerNetworkError,
  selectContextAfterMutation,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function DELETE(
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
      const exited = await new ReferrerNetworkRepository(
        transaction
      ).exitReferrerMembership({
        userId: authenticated.user.id,
        contextVersion: authenticated.user.contextVersion,
        membershipId,
      });
      if (!exited) {
        return { authenticated: true as const, exited: null };
      }
      const contexts = await identities.listContexts(exited.user.id);
      const selected = selectContextAfterMutation({ contexts, payload });
      return {
        authenticated: true as const,
        exited,
        contexts,
        selected,
      };
    });
    if (!result.authenticated) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }
    if (!result.exited) {
      return referrerNetworkError('membership_not_found', { status: 404 });
    }
    if (!result.selected) {
      return referrerNetworkError('identity_context_missing', { status: 500 });
    }
    const token = await signMiniProgramIdentityContextToken({
      userId: result.exited.user.id,
      contextVersion: result.exited.user.contextVersion,
      context: result.selected,
      source: payload.source,
    });
    return NextResponse.json({
      success: true,
      token,
      context: miniProgramIdentityContextToDto(result.selected),
      contexts: result.contexts.map(miniProgramIdentityContextToDto),
      data: {
        id: result.exited.membership.id.toString(),
        status: result.exited.membership.status,
        exitedAt: result.exited.membership.exitedAt,
      },
      idempotent: result.exited.idempotent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to exit membership',
      },
      { status: 400 }
    );
  }
}
