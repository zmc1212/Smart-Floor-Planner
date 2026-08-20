import { NextResponse } from 'next/server';
import {
  EnterpriseRegistrationCodeRepository,
  EnterpriseRepository,
  MiniProgramIdentityRepository,
  ReferralLeadRepository,
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
import {
  pendingReferralSourceTtlSeconds,
  sealPendingReferralSource,
  sealPendingStaffActivitySource,
} from '@/lib/referral-attribution';

export const dynamic = 'force-dynamic';

const PLATFORM_REGISTRATION_DISPLAY_NAME = '家客来企业入驻';

function tokenCandidates(token: string) {
  if (/^[A-Za-z0-9_-]{32}$/.test(token)) {
    return [`ej_${token}`, `rp_${token}`, `sa_${token}`, `er_${token}`];
  }
  return [token];
}

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
      const registrationCodes = new EnterpriseRegistrationCodeRepository(
        transaction
      );
      const leads = new ReferralLeadRepository(transaction);
      const withExistingProject = async <T extends {
        kind: string;
        result: string;
        pendingSource?: string | null;
        enterpriseName?: string | null;
      }>(resolved: T) => {
        if (
          (resolved.kind !== 'referral' && resolved.kind !== 'staff_activity') ||
          resolved.result !== 'ok' ||
          payload?.mode !== 'customer' ||
          !actorUserId
        ) {
          return resolved;
        }
        const existing = await leads.findActiveCustomerAttribution(actorUserId);
        if (!existing) return resolved;
        return {
          ...resolved,
          pendingSource: null,
          enterpriseName: null,
          existingAttribution: true as const,
          lead: {
            id: existing.lead.id.toString(),
            status: existing.lead.status,
          },
        };
      };
      for (const candidate of tokenCandidates(token)) {
        if (candidate.startsWith('er_')) {
          const registration = await registrationCodes.resolve(
            candidate,
            actorUserId
          );
          if (registration.code || registration.result !== 'code_not_found') {
            return {
              kind: 'enterprise_registration' as const,
              codeType: null,
              result: registration.result,
              displayName: PLATFORM_REGISTRATION_DISPLAY_NAME,
            };
          }
          continue;
        }
        const joinCode = await repository.resolveEnterpriseJoinToken(
          candidate,
          actorUserId
        );
        if (joinCode.code) {
          const enterprise = await new EnterpriseRepository(transaction).findById(
            joinCode.code.enterpriseId
          );
          return {
            kind: 'onboarding' as const,
            codeType: joinCode.code.codeType,
            enterpriseName: enterprise?.name ?? null,
            result: joinCode.result,
          };
        }
        const promotionCode = await repository.resolvePromotionToken({
          token: candidate,
          sessionKey:
            typeof body.sessionKey === 'string'
              ? body.sessionKey.trim().slice(0, 120)
              : null,
          ipHash: hashRequestAddress(request),
          deviceSummary: sanitizeDeviceSummary(body.deviceSummary),
        });
        if (promotionCode.code) {
          return withExistingProject({
            kind: 'referral' as const,
            codeType: null,
            result: promotionCode.result,
            pendingSource:
              promotionCode.result === 'ok' &&
              promotionCode.code &&
              promotionCode.membership
                ? sealPendingReferralSource({
                    promotionCodeId: promotionCode.code.id,
                    membershipId: promotionCode.membership.id,
                    version: promotionCode.code.version,
                  })
                : null,
            enterpriseName: null,
          });
        }
        const activityCode = await repository.resolveStaffActivityToken({
          token: candidate,
          sessionKey:
            typeof body.sessionKey === 'string'
              ? body.sessionKey.trim().slice(0, 120)
              : null,
          ipHash: hashRequestAddress(request),
          deviceSummary: sanitizeDeviceSummary(body.deviceSummary),
        });
        if (activityCode.code) {
          return withExistingProject({
            kind: 'staff_activity' as const,
            codeType: null,
            result: activityCode.result,
            pendingSource:
              activityCode.result === 'ok' && activityCode.code && activityCode.staff
                ? sealPendingStaffActivitySource({
                    activityCodeId: activityCode.code.id,
                    staffId: activityCode.staff.id,
                    enterpriseId: activityCode.code.enterpriseId,
                    version: activityCode.code.version,
                  })
                : null,
            enterpriseName: activityCode.enterpriseName,
          });
        }
      }
      return {
        kind: 'referral' as const,
        codeType: null,
        result: 'code_not_found' as const,
        pendingSource: null,
        enterpriseName: null,
      };
    });

    if (result.result !== 'ok') {
      return referrerNetworkError(result.result);
    }
    return NextResponse.json({
      success: true,
      data: {
        kind: result.kind,
        ...(result.codeType
          ? {
              codeType: result.codeType,
              enterpriseName: result.enterpriseName,
            }
          : {}),
        ...(result.kind === 'enterprise_registration'
          ? {
              displayName: result.displayName,
              valid: true,
            }
          : {}),
        ...(result.kind === 'referral' || result.kind === 'staff_activity'
          ? {
              pendingSource: result.pendingSource,
              expiresIn: pendingReferralSourceTtlSeconds,
              ...('existingAttribution' in result && result.existingAttribution
                ? {
                    existingAttribution: true,
                    lead: 'lead' in result ? result.lead : null,
                  }
                : {}),
              ...(result.kind === 'staff_activity' && result.enterpriseName
                ? { enterpriseName: result.enterpriseName }
                : {}),
            }
          : {}),
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
