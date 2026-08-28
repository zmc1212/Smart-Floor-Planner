import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import {
  buildEnterpriseReferrerRosterItem,
  parseEnterpriseReferrerRosterStatus,
} from '@/lib/miniprogram-workbench';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    requireMiniProgramEnterpriseAdmin(context);

    const url = new URL(request.url);
    const query = url.searchParams.get('query')?.trim() || undefined;
    const status = parseEnterpriseReferrerRosterStatus(url.searchParams.get('status'));
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const rows = await new ReferrerNetworkRepository(transaction).listEnterpriseReferrerMemberships(
        parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        { query, status }
      );
      const items = rows.map((item) => buildEnterpriseReferrerRosterItem({
        id: item.membership.id,
        displayName: item.displayName,
        phone: item.phone,
        status: item.membership.status,
        joinedAt: item.membership.joinedAt,
        exitedAt: item.membership.exitedAt,
        hasActivePromotionCode: item.promotionCode?.status === 'active',
      }));
      return {
        items,
        summary: {
          total: items.length,
          activeCount: items.filter((item) => item.status === 'active').length,
        },
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '读取推荐人名册失败',
    }, { status });
  }
}
