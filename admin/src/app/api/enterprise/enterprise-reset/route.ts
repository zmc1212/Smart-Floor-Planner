import { NextResponse } from 'next/server';
import {
  isTenantEnterpriseResetAllowed,
  TenantEnterpriseResetRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

type Body = {
  confirmEnterpriseName?: string;
};

export async function POST(request: Request) {
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
        const body = (await request.json().catch(() => ({}))) as Body;
        const confirmEnterpriseName = String(body.confirmEnterpriseName || '').trim();
        if (!confirmEnterpriseName) {
          return NextResponse.json(
            { success: false, error: '请输入企业全名以确认清空' },
            { status: 400 }
          );
        }

        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const actorAdminUserId = parsePostgresId(context.userId, 'actorAdminUserId');

        const data = await withPlatformTransaction(async (transaction) => {
          const repository = new TenantEnterpriseResetRepository(transaction);
          const preview = await repository.preview(enterpriseId, actorAdminUserId);
          if (preview.enterpriseName !== confirmEnterpriseName) {
            throw Object.assign(new Error('企业全名不匹配，已取消清空'), {
              status: 400,
              code: 'enterprise_name_mismatch',
            });
          }
          return repository.execute(enterpriseId, actorAdminUserId);
        });

        return NextResponse.json({
          success: true,
          data: {
            ...data,
            retainedNote: data.retainedOperatorAdminUserId
              ? `已保留操作者账号：${data.retainedOperatorDisplayName || data.retainedOperatorAdminUserId}`
              : '当前企业未保留任何员工账号（平台管理员可通过全局企业切换继续管理）',
          },
        });
      }
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500;
    console.error('[enterprise-reset]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '清空失败' },
      { status }
    );
  }
}
