import { NextResponse } from 'next/server';
import {
  isTenantEnterpriseResetAllowed,
  TenantEnterpriseResetRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    if (!isTenantEnterpriseResetAllowed()) {
      return NextResponse.json(
        {
          success: false,
          error: '当前环境禁止企业一键清空。生产环境需显式设置 ALLOW_TENANT_ENTERPRISE_RESET=true',
        },
        { status: 403 }
      );
    }

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const actorAdminUserId = parsePostgresId(context.userId, 'actorAdminUserId');
        const data = await withPlatformTransaction((transaction) =>
          new TenantEnterpriseResetRepository(transaction).preview(enterpriseId, actorAdminUserId)
        );
        return NextResponse.json({ success: true, data });
      }
    );
  } catch (error) {
    console.error('[enterprise-reset/preview]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '预览失败' },
      { status: 500 }
    );
  }
}
