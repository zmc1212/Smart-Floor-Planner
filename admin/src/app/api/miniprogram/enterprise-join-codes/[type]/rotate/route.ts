import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramReferrerNetwork } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  enterpriseJoinCodeToDto,
  isEnterpriseJoinCodeType,
  referrerNetworkError,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const context = await resolveMiniProgramContext(request);
  if (!context) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }
  const { type } = await params;
  if (!isEnterpriseJoinCodeType(type)) {
    return referrerNetworkError('invalid_code_type', { status: 400 });
  }

  try {
    const role = requireMiniProgramReferrerNetwork(context);
    if (type === 'staff' && role !== 'enterprise_admin') {
      return referrerNetworkError('enterprise_admin_required', { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
      return referrerNetworkError('invalid_expiry', { status: 400 });
    }

    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const staffId = parsePostgresId(context.staff!._id, 'staffId');
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new ReferrerNetworkRepository(transaction).rotateEnterpriseJoinCode({
        enterpriseId,
        codeType: type,
        actorStaffId: staffId,
        inviterStaffId: type === 'referrer' ? staffId : null,
        expiresAt,
      })
    );
    return NextResponse.json({
      success: true,
      data: enterpriseJoinCodeToDto(result.code),
    });
  } catch (error) {
    console.error('[MiniProgramEnterpriseJoinCodes] rotate failed', error);
    const businessError = error as { code?: string; status?: number };
    return businessError.code && businessError.status
      ? referrerNetworkError(businessError.code, {
          status: businessError.status,
          message: error instanceof Error ? error.message : undefined,
        })
      : referrerNetworkError('join_code_rotate_failed', { status: 500 });
  }
}
