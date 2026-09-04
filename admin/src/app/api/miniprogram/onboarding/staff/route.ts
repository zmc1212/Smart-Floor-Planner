import { NextResponse } from 'next/server';
import {
  MiniProgramIdentityRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { adminUserToDto } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withMiniProgramRequestLog, type MiniProgramRequestLog } from '@/lib/miniprogram-request-log';
import { hashEnterpriseAdminInitialPassword } from '@/lib/enterprise-admin-provision';
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
import { retryPendingLeadAssignmentsForEnterprise } from '@/lib/lead-assignment-retry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withMiniProgramRequestLog(request, '/api/miniprogram/onboarding/staff', (log) => onboardStaff(request, log));
}

async function onboardStaff(request: Request, log: MiniProgramRequestLog) {
  log.stage('authenticate');
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }

  try {
    log.stage('parse_body');
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
    log.stage('staff_setup');
    const [menuPermissions, passwordHash] = await Promise.all([
      getEffectivePermissions(role),
      hashEnterpriseAdminInitialPassword(),
    ]);

    log.stage('database');
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
    log.stage('sign_token');
    const switchedToken = await signMiniProgramIdentityContextToken({
      userId: result.onboarding.user.id,
      contextVersion: result.onboarding.user.contextVersion,
      context: result.selected,
      source: payload.source,
    });
    if (result.onboarding.staff.enterpriseId) {
      log.stage('assignment_retry');
      await retryPendingLeadAssignmentsForEnterprise({
        enterpriseId: result.onboarding.staff.enterpriseId,
        reason: 'staff_onboarded',
      }).catch((error) => {
        log.error(error);
      });
    }
    return NextResponse.json({
      success: true,
      token: switchedToken,
      context: miniProgramIdentityContextToDto(result.selected),
      contexts: result.contexts.map(miniProgramIdentityContextToDto),
      data: adminUserToDto(result.onboarding.staff),
      idempotent: result.onboarding.idempotent,
    });
  } catch (error) {
    log.error(error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to onboard staff',
      },
      { status: 400 }
    );
  }
}
