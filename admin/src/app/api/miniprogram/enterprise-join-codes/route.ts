import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  createEnterpriseJoinToken,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramReferrerNetwork } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  enterpriseJoinCodeToDto,
  referrerNetworkError,
} from '@/lib/referrer-network-api';

export const dynamic = 'force-dynamic';

const JOIN_CODE_TYPES = ['staff', 'referrer'] as const;

function isActiveJoinCode(code: {
  status: string;
  expiresAt: Date | null;
}) {
  return (
    code.status === 'active' &&
    (!code.expiresAt || code.expiresAt.getTime() > Date.now())
  );
}

export async function GET(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) {
    return referrerNetworkError('unauthorized', { status: 401 });
  }

  try {
    const role = requireMiniProgramReferrerNetwork(context);
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const staffId = parsePostgresId(context.staff!._id, 'staffId');
    const isOwner = role === 'enterprise_admin';
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const codes = await new ReferrerNetworkRepository(
        transaction
      ).listEnterpriseJoinCodes(enterpriseId, {
        referrerInviterStaffId: staffId,
      });
      const visibleTypes = isOwner
        ? JOIN_CODE_TYPES
        : JOIN_CODE_TYPES.filter((codeType) => codeType === 'referrer');
      const byType = visibleTypes.map((codeType) => {
        const active =
          codes.find((row) => row.codeType === codeType && isActiveJoinCode(row)) ?? null;
        return {
          codeType,
          label: codeType === 'staff' ? '员工入驻码' : '我的推荐人入驻码',
          scope: codeType === 'staff' ? 'enterprise' : 'own',
          hasActive: Boolean(active),
          code: active ? enterpriseJoinCodeToDto(active) : null,
          token: active
            ? createEnterpriseJoinToken(
                active.enterpriseId,
                codeType,
                active.version,
                active.inviterStaffId
              )
            : null,
        };
      });
      return {
        enterpriseName: context.enterprise?.name || '',
        scope: isOwner ? 'enterprise' : 'own',
        canManageStaffCodes: isOwner,
        codes: byType,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[MiniProgramEnterpriseJoinCodes] list failed', error);
    const businessError = error as { code?: string; status?: number };
    return businessError.code && businessError.status
      ? referrerNetworkError(businessError.code, {
          status: businessError.status,
          message: error instanceof Error ? error.message : undefined,
        })
      : referrerNetworkError('join_code_lookup_failed', { status: 500 });
  }
}
