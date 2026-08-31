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
        const requestedView = url.searchParams.get('view') || 'flat';
        if (url.searchParams.get('status') && !status) {
          return NextResponse.json({ success: false, error: '成员状态无效' }, { status: 400 });
        }
        if (requestedView !== 'flat' && requestedView !== 'network') {
          return NextResponse.json({ success: false, error: '推广网络视图无效' }, { status: 400 });
        }
        if (requestedView === 'network' && context.role !== 'enterprise_admin') {
          return NextResponse.json({ success: false, error: '仅企业负责人可查看推广网络' }, { status: 403 });
        }
        if (requestedView === 'network') {
          const network = await withTenantTransaction(context.enterpriseId!, (transaction) =>
            new ReferrerNetworkRepository(transaction).listEnterpriseReferrerNetwork(
              parsePostgresId(context.enterpriseId!, 'enterpriseId'),
              { query, status }
            )
          );
          return NextResponse.json({
            success: true,
            data: {
              view: 'network',
              summary: network.summary,
              branches: network.branches.map((branch) => ({
                staff: branch.staff
                  ? {
                      id: branch.staff.id?.toString() ?? null,
                      displayName: branch.staff.displayName,
                      role: branch.staff.role,
                      status: branch.staff.status,
                    }
                  : null,
                total: branch.total,
                activeCount: branch.activeCount,
                items: branch.items.map((item) => ({
                  id: item.membership.id.toString(),
                  displayName: item.displayName || item.phone || '未命名推荐人',
                  phone: item.phone || null,
                  status: item.membership.status,
                  joinedAt: item.membership.joinedAt,
                  exitedAt: item.membership.exitedAt,
                  hasActivePromotionCode: item.promotionCode?.status === 'active',
                })),
              })),
            },
          });
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
            inviter: item.inviter
              ? {
                  id: item.inviter.id.toString(),
                  displayName:
                    item.inviter.displayName.trim() ||
                    item.membership.invitedByNameSnapshot ||
                    item.inviter.username,
                  role: item.inviter.role,
                  status: item.inviter.status,
                }
              : item.membership.invitedByNameSnapshot
                ? {
                    id: null,
                    displayName: item.membership.invitedByNameSnapshot,
                    role: null,
                    status: 'deleted',
                  }
                : null,
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
