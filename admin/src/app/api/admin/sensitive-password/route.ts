import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  isSensitivePasswordConfigured,
  setAdminSensitivePassword,
} from '@/lib/enterprise-sensitive-password';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const adminUserId = parsePostgresId(context.userId, 'user id');
        const admin = await withPlatformTransaction((transaction) =>
          new AdminUserRepository(transaction).findById(adminUserId)
        );
        if (!admin) {
          return NextResponse.json(
            { success: false, error: '用户不存在' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: {
            configured: isSensitivePasswordConfigured(
              admin.sensitiveOperationPasswordHash
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
      { roles: ['super_admin', 'admin'], requireEnterprise: false },
      async (context) => {
        const adminUserId = parsePostgresId(context.userId, 'user id');
        const body = await request.json();
        const data = await withPlatformTransaction((transaction) =>
          setAdminSensitivePassword(transaction, adminUserId, {
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
