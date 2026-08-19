import { NextResponse } from 'next/server';
import { ReferrerNetworkRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const membershipId = parsePostgresId((await params).id, 'membershipId');
        const result = await withTenantTransaction(context.enterpriseId!, (transaction) =>
          new ReferrerNetworkRepository(transaction).disableEnterpriseReferrerMembership(enterpriseId, membershipId)
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
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '停用推荐人失败' },
      { status: 400 }
    );
  }
}
