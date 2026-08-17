import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { adminUserToDto } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  normalizeOpaqueToken,
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';
import { getEffectivePermissions } from '@/lib/staff-access';

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
    if (body.role !== 'designer' && body.role !== 'measurer') {
      return referrerNetworkError('invalid_staff_role', {
        message: 'role must be designer or measurer',
      });
    }
    const role: 'designer' | 'measurer' = body.role;
    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim().slice(0, 60)
        : '';
    const [menuPermissions, passwordHash] = await Promise.all([
      getEffectivePermissions(role),
      bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10),
    ]);

    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) return { authenticated: false as const };
      const onboarding = await new ReferrerNetworkRepository(
        transaction
      ).onboardStaff({
        token,
        userId: authenticated.user.id,
        contextVersion: authenticated.user.contextVersion,
        role,
        displayName:
          displayName || authenticated.user.nickname || '微信员工',
        menuPermissions,
        passwordHash,
      });
      if (!onboarding.ok) {
        return { authenticated: true as const, onboarding };
      }
      const contexts = await identities.listContexts(onboarding.user.id);
      const selected = contexts.find(
        (context) =>
          context.mode === 'staff' && context.staffId === onboarding.staff.id
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
      return referrerNetworkError('staff_context_missing', { status: 500 });
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
      data: adminUserToDto(result.onboarding.staff),
      idempotent: result.onboarding.idempotent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to onboard staff',
      },
      { status: 400 }
    );
  }
}
