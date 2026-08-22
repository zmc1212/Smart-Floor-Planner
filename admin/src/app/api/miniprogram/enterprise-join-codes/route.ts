import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  createEnterpriseJoinToken,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
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
  if (
    context.mode !== 'staff' ||
    !context.enterpriseId ||
    !context.staff ||
    context.staff.role !== 'enterprise_admin'
  ) {
    return referrerNetworkError('enterprise_admin_required', { status: 403 });
  }

  try {
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const codes = await new ReferrerNetworkRepository(transaction).listEnterpriseJoinCodes(
        enterpriseId
      );
      const byType = JOIN_CODE_TYPES.map((codeType) => {
        const active =
          codes.find((row) => row.codeType === codeType && isActiveJoinCode(row)) ?? null;
        return {
          codeType,
          label: codeType === 'staff' ? '员工入驻码' : '推荐人入驻码',
          hasActive: Boolean(active),
          code: active ? enterpriseJoinCodeToDto(active) : null,
          token: active
            ? createEnterpriseJoinToken(active.enterpriseId, codeType, active.version)
            : null,
        };
      });
      return {
        enterpriseName: context.enterprise?.name || '',
        codes: byType,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[MiniProgramEnterpriseJoinCodes] list failed', error);
    return referrerNetworkError('join_code_lookup_failed', { status: 500 });
  }
}
