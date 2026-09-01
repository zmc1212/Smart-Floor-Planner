import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramReferrerNetwork } from '@/lib/miniprogram-portal-authority';
import {
  buildEnterpriseReferrerRosterItem,
  parseEnterpriseReferrerRosterStatus,
} from '@/lib/miniprogram-workbench';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type RosterRecord = Awaited<
  ReturnType<ReferrerNetworkRepository['listEnterpriseReferrerMemberships']>
>[number];

function inviterForRoster(item: RosterRecord) {
  if (item.inviter) {
    return {
      id: item.inviter.id,
      displayName:
        item.inviter.displayName.trim() ||
        item.membership.invitedByNameSnapshot ||
        item.inviter.username,
      role: item.inviter.role,
      status: item.inviter.status,
    };
  }
  const snapshot = item.membership.invitedByNameSnapshot?.trim();
  return snapshot
    ? {
        id: null,
        displayName: snapshot,
        role: null,
        status: 'deleted',
      }
    : null;
}

function rosterItem(item: RosterRecord, canDisable: boolean) {
  return buildEnterpriseReferrerRosterItem({
    id: item.membership.id,
    displayName: item.displayName,
    phone: item.phone,
    status: item.membership.status,
    joinedAt: item.membership.joinedAt,
    exitedAt: item.membership.exitedAt,
    hasActivePromotionCode: item.promotionCode?.status === 'active',
    inviter: inviterForRoster(item),
    canDisable,
  });
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    const role = requireMiniProgramReferrerNetwork(context);

    const url = new URL(request.url);
    const query = url.searchParams.get('query')?.trim() || undefined;
    const status = parseEnterpriseReferrerRosterStatus(url.searchParams.get('status'));
    const requestedView = url.searchParams.get('view') || 'flat';
    if (requestedView !== 'flat' && requestedView !== 'network' && requestedView !== 'staff') {
      return NextResponse.json(
        { success: false, error: '推广人视图无效' },
        { status: 400 }
      );
    }
    const isOwner = role === 'enterprise_admin';
    if (requestedView === 'staff' && !isOwner) {
      return NextResponse.json(
        { success: false, error: '仅企业负责人可查看员工推广人' },
        { status: 403 }
      );
    }
    const view = isOwner ? requestedView : 'flat';
    const { page, limit } = getPaginationParams(url);
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new ReferrerNetworkRepository(transaction);
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      if (view === 'network') {
        const network = await repository.listEnterpriseReferrerNetworkSummary(enterpriseId);
        return {
          scope: 'enterprise' as const,
          view: 'network' as const,
          canDisable: true,
          summary: network.summary,
          branches: network.branches.map((branch) => ({
            staff: branch.staff
              ? {
                  ...branch.staff,
                  id: branch.staff.id?.toString() ?? null,
                }
              : null,
            total: branch.total,
            activeCount: branch.activeCount,
          })),
          items: [],
          pagination: null,
        };
      }

      if (view === 'staff') {
        const rawStaffId = url.searchParams.get('staffId');
        if (!rawStaffId) {
          throw Object.assign(new Error('请选择员工推广分支'), { status: 400 });
        }
        const staffId = parsePostgresId(rawStaffId, 'staffId');
        const staff = await repository.getEnterpriseReferrerNetworkStaff(enterpriseId, staffId);
        if (!staff) {
          throw Object.assign(new Error('员工推广分支不存在'), { status: 404 });
        }
        const [rows, counts, branchSummary] = await Promise.all([
          repository.listEnterpriseReferrerMemberships(enterpriseId, {
            query,
            status,
            page,
            limit,
            inviterStaffId: staffId,
          }),
          repository.countEnterpriseReferrerMemberships(enterpriseId, {
            query,
            status,
            inviterStaffId: staffId,
          }),
          repository.countEnterpriseReferrerMemberships(enterpriseId, {
            inviterStaffId: staffId,
          }),
        ]);
        return {
          scope: 'enterprise' as const,
          view: 'staff' as const,
          canDisable: true,
          staff: {
            ...staff,
            id: staff.id.toString(),
          },
          items: rows.map((item) => rosterItem(item, true)),
          branches: [],
          summary: counts,
          branchSummary,
          pagination: createPaginationMetadata(counts.total, page, limit),
        };
      }

      const inviterStaffId = isOwner
        ? undefined
        : parsePostgresId(context.staff!._id, 'staffId');
      const [rows, counts] = await Promise.all([
        repository.listEnterpriseReferrerMemberships(enterpriseId, {
          query,
          status,
          page,
          limit,
          inviterStaffId,
        }),
        repository.countEnterpriseReferrerMemberships(enterpriseId, {
          query,
          status,
          inviterStaffId,
        }),
      ]);
      return {
        scope: isOwner ? 'enterprise' as const : 'own' as const,
        view: 'flat' as const,
        // Owners manage the whole tenant; ordinary staff are scoped below
        // to memberships they invited and can manage that personal network.
        canDisable: true,
        items: rows.map((item) => rosterItem(item, true)),
        branches: [],
        summary: {
          total: counts.total,
          activeCount: counts.activeCount,
        },
        pagination: createPaginationMetadata(counts.total, page, limit),
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
