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

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  if (payload.mode !== 'staff' || !payload.staffId) {
    return referrerNetworkError('staff_context_required', { status: 403 });
  }
  try {
    const staffId = parsePostgresId(payload.staffId, 'staffId');
    const result = await withPlatformTransaction(async (transaction) => {
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
    if (!result.authenticated) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }
    if (!result.activity.ok) {
      return referrerNetworkError(result.activity.code, {
        status: result.activity.code === 'staff_not_found' ? 404 : 403,
      });
    }
    return NextResponse.json({
      success: true,
      data: {
        id: result.activity.code.id.toString(),
        staffId: result.activity.code.staffId.toString(),
        enterpriseId: result.activity.code.enterpriseId.toString(),
        enterpriseName: result.activity.enterpriseName,
        status: result.activity.code.status,
        version: result.activity.code.version,
        token: result.activity.token,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to load activity code',
      },
      { status: 400 }
    );
  }
}
