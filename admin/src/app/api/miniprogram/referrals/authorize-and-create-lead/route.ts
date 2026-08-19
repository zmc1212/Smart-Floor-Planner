import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  MiniProgramIdentityRepository,
  ReferralLeadRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { httpErrorStatus } from '@/lib/http-error';
import {
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';
import {
  hashReferralIdempotencyKey,
  normalizeReferralIdempotencyKey,
  openPendingClaimSource,
} from '@/lib/referral-attribution';
import {
  notifyDesignerOfAssignedLead,
  notifyEnterpriseAdminOfAssignmentPending,
  notifyEnterpriseAdminOfNewLead,
} from '@/lib/wechat-notification';
import {
  getWechatPhoneNumber,
  getWechatSessionIdentity,
} from '@/lib/wechat-miniprogram-auth';

export const dynamic = 'force-dynamic';

function optionalText(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength) || null
    : null;
}

export async function POST(request: Request) {
  const payload = await readMiniProgramPayload(request);

  try {
    const body = await request.json();
    const directPhoneAuthorization =
      typeof body.loginCode === 'string' &&
      typeof body.phoneCode === 'string';
    if (payload && payload.mode !== 'customer' && !directPhoneAuthorization) {
      return referrerNetworkError('customer_context_required', {
        status: 403,
        message: 'Switch to the customer context before claiming this service',
      });
    }
    if (!payload && !directPhoneAuthorization) {
      return referrerNetworkError('phone_authorization_required', {
        status: 401,
        message: 'A customer token or WeChat phone authorization is required',
      });
    }
    const source = openPendingClaimSource(body.pendingSource);
    if (!source) {
      return referrerNetworkError('pending_source_invalid', {
        status: 400,
        message: 'A valid pending referral source is required',
      });
    }
    const idempotencyKey = normalizeReferralIdempotencyKey(
      request.headers.get('Idempotency-Key') || body.idempotencyKey
    );
    if (!idempotencyKey) {
      return referrerNetworkError('idempotency_key_required', {
        status: 400,
        message: 'Idempotency-Key must contain 8 to 160 characters',
      });
    }

    const wechat = directPhoneAuthorization
      ? await Promise.all([
          getWechatSessionIdentity(body.loginCode),
          getWechatPhoneNumber(body.phoneCode),
        ]).then(([identity, phone]) => ({ ...identity, phone }))
      : null;

    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      let customer;
      if (wechat) {
        customer = await identities.resolveWechatPhoneUser({
          openid: wechat.openid,
          unionid: wechat.unionid,
          phone: wechat.phone,
        });
        if (payload && parsePostgresId(payload.sub, 'customer user id') !== customer.id) {
          throw Object.assign(
            new Error('微信手机号授权与当前登录账号不一致'),
            { code: 'wechat_user_mismatch', status: 409 }
          );
        }
      } else if (payload) {
        const authenticated = await validateMiniProgramIdentity(
          transaction,
          payload,
          identities
        );
        if (!authenticated || authenticated.selected.mode !== 'customer') {
          return { authenticated: false as const };
        }
        customer = authenticated.user;
      } else {
        return { authenticated: false as const };
      }
      const claim = await new ReferralLeadRepository(
        transaction
      ).authorizeAndCreateLead({
        source,
        customerUserId: customer.id,
        idempotencyKeyHash: hashReferralIdempotencyKey(idempotencyKey),
        name: optionalText(body.name, 120),
        communityName: optionalText(body.communityName, 160),
        city: optionalText(body.city, 80),
        stylePreference: optionalText(body.stylePreference, 120),
      });
      const contexts = wechat ? await identities.listContexts(customer.id) : null;
      const customerContext = contexts?.find((context) => context.mode === 'customer') ?? null;
      return {
        authenticated: true as const,
        claim,
        customer,
        customerContext,
      };
    });
    if (!result.authenticated) {
      return referrerNetworkError('identity_context_changed', { status: 401 });
    }

    const { claim } = result;
    const customerToken = result.customerContext
      ? await signMiniProgramIdentityContextToken({
          userId: result.customer.id,
          contextVersion: result.customer.contextVersion,
          context: result.customerContext,
          source: 'phone',
        })
      : null;
    if (claim.kind === 'created') {
      const notificationLead = {
        ...claim.lead,
        enterpriseId: claim.lead.enterpriseId?.toString(),
      };
      await Promise.allSettled([
        notifyEnterpriseAdminOfNewLead(notificationLead),
        claim.lead.assignedTo
          ? notifyDesignerOfAssignedLead(
              notificationLead,
              claim.lead.assignedTo.toString()
            )
          : Promise.resolve(),
        claim.lead.measurerId &&
        claim.lead.measurerId.toString() !== claim.lead.assignedTo?.toString()
          ? notifyDesignerOfAssignedLead(
              notificationLead,
              claim.lead.measurerId.toString()
            )
          : Promise.resolve(),
        claim.lead.assignmentStatus === 'assignment_pending'
          ? notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
              reasonCode: claim.lead.assignmentErrorCode || 'assignment_pending',
              eventKey: `initial:${claim.lead.id.toString()}`,
            })
          : Promise.resolve(),
      ]);
    }

    const designer = claim.lead.assignedUser;
    return NextResponse.json(
      {
        success: true,
        ...(customerToken
          ? {
              token: customerToken,
              context: miniProgramIdentityContextToDto(result.customerContext!),
            }
          : {}),
        idempotent: claim.kind === 'idempotent',
        existingAttribution: claim.kind === 'existing_attribution',
        data: {
          lead: {
            id: claim.lead.id.toString(),
            name: claim.lead.name,
            communityName: claim.lead.communityName,
            status: claim.lead.status,
            assignmentStatus: claim.lead.assignmentStatus,
            assignmentErrorCode: claim.lead.assignmentErrorCode,
            createdAt: claim.lead.createdAt,
          },
          designerProfile:
            designer && claim.lead.enterpriseId && claim.kind !== 'existing_attribution'
              ? {
                  displayName: designer.displayName || designer.username,
                  wechatId: designer.wechatId,
                  wechatQrUrl:
                    designer.wechatQrAssetId && designer.wechatId
                      ? getSignedMiniAiAssetUrl({
                          request,
                          assetId: designer.wechatQrAssetId.toString(),
                          enterpriseId: claim.lead.enterpriseId.toString(),
                        })
                      : null,
                }
              : null,
        },
      },
      { status: claim.kind === 'created' ? 201 : 200 }
    );
  } catch (error) {
    console.error('[Referral authorization]', error);
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to authorize referral service',
      },
      { status: httpErrorStatus(error, 400) }
    );
  }
}
