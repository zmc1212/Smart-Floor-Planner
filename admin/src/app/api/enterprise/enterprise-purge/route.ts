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
            { success: false, error: '请输入企业全名以确认删除整家企业' },
            { status: 400 }
          );
        }

        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');

        const data = await withPlatformTransaction(async (transaction) => {
          const repository = new TenantEnterpriseResetRepository(transaction);
          const preview = await repository.previewPurge(enterpriseId);
          if (preview.enterpriseName !== confirmEnterpriseName) {
            throw Object.assign(new Error('企业全名不匹配，已取消删除'), {
              status: 400,
              code: 'enterprise_name_mismatch',
            });
          }
          return repository.purge(enterpriseId);
        });

        return NextResponse.json({
          success: true,
          data: {
            ...data,
            enterpriseDeleted: true,
            retainedNote:
              '企业壳与全部员工账号已删除。商户负责人需重新开户/建企；平台管理员可在企业列表继续管理其他企业。',
          },
        });
      }
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500;
    console.error('[enterprise-purge]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除整家企业失败' },
      { status }
    );
  }
}
