import { NextResponse } from 'next/server';
import { enterpriseToDto } from '@/db/postgres-dto';
import {
  EnterpriseRegistrationCodeRepository,
  MiniProgramIdentityRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  createSelfServiceEnterpriseApplication,
  parseSelfServiceEnterpriseApplicationBody,
  SelfServiceEnterpriseApplicationError,
  selfServiceEnterpriseApplicationHttpStatus,
} from '@/lib/self-service-enterprise-registration';
import {
  normalizeOpaqueToken,
  readMiniProgramPayload,
  referrerNetworkError,
  validateMiniProgramIdentity,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

const PLATFORM_REGISTRATION_DISPLAY_NAME = '家客来企业入驻';

export async function POST(request: Request) {
  const payload = await readMiniProgramPayload(request);
  if (!payload) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }

  try {
    const body = await request.json();
    const token = normalizeOpaqueToken(body.token);
    if (!token || !token.startsWith('er_')) {
      return referrerNetworkError('invalid_token', {
        message: 'A valid enterprise registration token is required',
      });
    }

    let input;
    try {
      input = parseSelfServiceEnterpriseApplicationBody(body);
    } catch (error) {
      if (error instanceof SelfServiceEnterpriseApplicationError) {
        return NextResponse.json(
          { success: false, code: error.code, error: error.message },
          { status: 400 }
        );
      }
      throw error;
    }

    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const authenticated = await validateMiniProgramIdentity(
        transaction,
        payload,
        identities
      );
      if (!authenticated) {
        return { ok: false as const, reason: 'identity_context_changed' as const };
      }

      const authorizedPhone = authenticated.user.phone?.trim() || '';
      if (!authorizedPhone) {
        return {
          ok: false as const,
          reason: 'phone_authorization_required' as const,
        };
      }
      if (authorizedPhone !== input.contactPerson.phone) {
        return {
          ok: false as const,
          reason: 'phone_mismatch' as const,
        };
      }

      const codes = new EnterpriseRegistrationCodeRepository(transaction);
      const resolved = await codes.inspect(token);
      if (resolved.result !== 'ok' || !resolved.code) {
        if (resolved.code) {
          await codes.recordSubmission({
            code: resolved.code,
            actorUserId: authenticated.user.id,
            result: resolved.result,
          });
        }
        return {
          ok: false as const,
          reason: resolved.result,
        };
      }

      try {
        const enterprise = await createSelfServiceEnterpriseApplication(
          transaction,
          input
        );
        await codes.recordSubmission({
          code: resolved.code,
          actorUserId: authenticated.user.id,
          result: 'submitted',
          metadata: {
            enterpriseId: enterprise.id.toString(),
            displayName: PLATFORM_REGISTRATION_DISPLAY_NAME,
          },
        });
        return {
          ok: true as const,
          enterprise,
        };
      } catch (error) {
        await codes.recordSubmission({
          code: resolved.code,
          actorUserId: authenticated.user.id,
          result:
            error instanceof SelfServiceEnterpriseApplicationError
              ? error.code
              : 'submit_failed',
          metadata: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }
    });

    if (!result.ok) {
      if (result.reason === 'identity_context_changed') {
        return referrerNetworkError('identity_context_changed', { status: 401 });
      }
      if (result.reason === 'phone_authorization_required') {
        return referrerNetworkError('phone_authorization_required', {
          message: '微信手机号授权后才能提交企业开户申请',
        });
      }
      if (result.reason === 'phone_mismatch') {
        return referrerNetworkError('phone_mismatch', {
          message: '联系人手机号必须与当前微信授权手机号一致',
        });
      }
      return referrerNetworkError(result.reason);
    }

    return NextResponse.json({
      success: true,
      data: {
        enterprise: enterpriseToDto(result.enterprise),
        displayName: PLATFORM_REGISTRATION_DISPLAY_NAME,
      },
    });
  } catch (error) {
    if (error instanceof SelfServiceEnterpriseApplicationError) {
      return NextResponse.json(
        { success: false, code: error.code, error: error.message },
        { status: selfServiceEnterpriseApplicationHttpStatus(error) }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to submit enterprise registration',
      },
      { status: 500 }
    );
  }
}
