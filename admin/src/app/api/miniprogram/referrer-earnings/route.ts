import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerPortalRepository } from '@/db/repositories';
import { requireMiniProgramPortalMode } from '@/lib/miniprogram-portal-authority';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramPortalMode(context, 'referrer');
    const { page, limit } = getPaginationParams(new URL(request.url));
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new ReferrerPortalRepository(transaction).listEarnings(
        parsePostgresId(context.user._id, 'referrer user id'),
        parsePostgresId(context.referrerMembershipId!, 'referrer membership id'),
        parsePostgresId(context.enterpriseId!, 'enterprise id'),
        { page, limit }
      )
    );
    if (!result) return NextResponse.json({ success: false, code: 'referrer_membership_context_invalid', error: '推荐人企业上下文无效' }, { status: 403 });
    return NextResponse.json({
      success: true,
      data: result,
      pagination: createPaginationMetadata(result.total, result.page, result.limit),
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取推荐收益失败' }, { status });
  }
}
