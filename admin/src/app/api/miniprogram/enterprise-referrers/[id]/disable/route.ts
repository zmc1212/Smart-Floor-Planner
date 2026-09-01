import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramReferrerNetwork } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    const role = requireMiniProgramReferrerNetwork(context);

    const membershipId = parsePostgresId((await params).id, 'membershipId');
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new ReferrerNetworkRepository(transaction).disableEnterpriseReferrerMembership(
        parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        membershipId,
        role === 'enterprise_admin'
          ? {}
          : { inviterStaffId: parsePostgresId(context.staff!._id, 'staffId') }
      )
    );
    if (!result) {
      return NextResponse.json({ success: false, error: '推荐人成员不存在' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: {
        id: result.membership.id.toString(),
        status: result.membership.status,
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '停用推荐人失败',
    }, { status });
  }
}
