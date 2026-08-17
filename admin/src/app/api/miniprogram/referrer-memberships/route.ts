import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  readMiniProgramPayload,
  referrerMembershipToDto,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  try {
    const rows = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) return null;
      return new ReferrerNetworkRepository(
        transaction
      ).listReferrerMemberships(authenticated.user.id);
    });
    if (!rows) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }
    return NextResponse.json({
      success: true,
      data: rows.map(referrerMembershipToDto),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to list memberships',
      },
      { status: 400 }
    );
  }
}
