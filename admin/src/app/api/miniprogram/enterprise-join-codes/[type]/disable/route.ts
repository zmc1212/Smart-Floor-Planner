import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
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
  if (
    context.mode !== 'staff' ||
    !context.enterpriseId ||
    !context.staff ||
    context.staff.role !== 'enterprise_admin'
  ) {
    return referrerNetworkError('enterprise_admin_required', { status: 403 });
  }

  const { type } = await params;
  if (!isEnterpriseJoinCodeType(type)) {
    return referrerNetworkError('invalid_code_type', { status: 400 });
  }

  try {
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const staffId = parsePostgresId(context.staff._id, 'staffId');
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new ReferrerNetworkRepository(transaction).disableEnterpriseJoinCode({
        enterpriseId,
        codeType: type,
        actorStaffId: staffId,
      })
    );
    if (!result) {
      return referrerNetworkError('active_code_not_found', { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: enterpriseJoinCodeToDto(result),
    });
  } catch (error) {
    console.error('[MiniProgramEnterpriseJoinCodes] disable failed', error);
    return referrerNetworkError('join_code_disable_failed', { status: 500 });
  }
}
