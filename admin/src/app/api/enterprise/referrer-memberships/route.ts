import { NextResponse } from 'next/server';
import {
  ReferrerNetworkRepository,
  type ReferrerMembershipStatus,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

const MEMBERSHIP_STATUSES = new Set<ReferrerMembershipStatus>([
  'active',
  'disabled',
  'exited',
]);

function parseStatus(value: string | null): ReferrerMembershipStatus | undefined {
  if (!value) return undefined;
  return MEMBERSHIP_STATUSES.has(value as ReferrerMembershipStatus)
    ? (value as ReferrerMembershipStatus)
    : undefined;
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const url = new URL(request.url);
        const query = url.searchParams.get('query')?.trim() || undefined;
        const status = parseStatus(url.searchParams.get('status'));
        if (url.searchParams.get('status') && !status) {
          return NextResponse.json({ success: false, error: '成员状态无效' }, { status: 400 });
        }
        const rows = await withTenantTransaction(context.enterpriseId!, (transaction) =>
          new ReferrerNetworkRepository(transaction).listEnterpriseReferrerMemberships(
            parsePostgresId(context.enterpriseId!, 'enterpriseId'),
            { query, status }
          )
        );
        return NextResponse.json({
          success: true,
          data: rows.map((item) => ({
            id: item.membership.id.toString(),
            displayName: item.displayName || item.phone || '未命名推荐人',
            phone: item.phone || null,
            status: item.membership.status,
            joinedAt: item.membership.joinedAt,
            exitedAt: item.membership.exitedAt,
            hasActivePromotionCode: item.promotionCode?.status === 'active',
          })),
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取推荐人失败' },
      { status: 500 }
    );
  }
}
