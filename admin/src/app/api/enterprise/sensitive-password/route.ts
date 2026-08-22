import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import {
  isSensitivePasswordConfigured,
  setEnterpriseSensitivePassword,
} from '@/lib/enterprise-sensitive-password';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
        const enterprise = await withTenantTransaction(enterpriseId, (transaction) =>
          new EnterpriseRepository(transaction).findById(enterpriseId)
        );
        if (!enterprise) {
          return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          data: {
            configured: isSensitivePasswordConfigured(
              enterprise.sensitiveOperationPasswordHash
            ),
          },
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '读取安全密码状态失败',
      },
      { status: httpErrorStatus(error, 500) }
    );
  }
}

export async function PUT(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
        const body = await request.json();
        const data = await withTenantTransaction(enterpriseId, (transaction) =>
          setEnterpriseSensitivePassword(transaction, enterpriseId, {
            password: body.password,
            confirmPassword: body.confirmPassword,
            currentPassword: body.currentPassword,
          })
        );
        return NextResponse.json({ success: true, data });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '更新安全密码失败',
      },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
