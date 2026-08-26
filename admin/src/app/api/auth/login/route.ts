import { NextResponse } from 'next/server';
import { AdminUserRepository, EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { authenticateAdminCredential } from '@/lib/admin-credential-auth';
import { setAdminSessionCookie, signAdminSession } from '@/lib/admin-session';
import {
  enterpriseAccessDeniedMessage,
  isEnterpriseOperationallyActive,
} from '@/lib/enterprise-status';
import { getEffectivePermissions } from '@/lib/staff-access';

export const dynamic = 'force-dynamic';

const PLATFORM_ROLES = new Set(['super_admin', 'admin']);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: '请输入手机号/账号和密码' },
        { status: 400 }
      );
    }

    const authResult = await withPlatformTransaction(async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      const credential = await authenticateAdminCredential(
        repository,
        username,
        password
      );
      if (credential.kind !== 'ok') return credential;
      const admin = credential.admin;

      if (admin.enterpriseId && !PLATFORM_ROLES.has(admin.role)) {
        const enterprise = await new EnterpriseRepository(
          transaction
        ).findById(admin.enterpriseId);
        if (
          !enterprise ||
          !isEnterpriseOperationallyActive(enterprise.status)
        ) {
          return {
            kind: 'enterprise_blocked' as const,
            message: enterpriseAccessDeniedMessage(enterprise?.status),
          };
        }
      }

      return { kind: 'ok' as const, admin };
    });

    if (authResult.kind === 'invalid_credentials') {
      return NextResponse.json(
        { success: false, error: '手机号/账号或密码错误' },
        { status: 401 }
      );
    }
    if (authResult.kind === 'ambiguous_identifier') {
      return NextResponse.json(
        {
          success: false,
          code: 'ambiguous_identifier',
          error: '该手机号关联多个账号，请改用员工管理页显示的内部登录账号',
        },
        { status: 409 }
      );
    }
    if (authResult.kind === 'enterprise_blocked') {
      return NextResponse.json(
        { success: false, error: authResult.message },
        { status: 401 }
      );
    }

    const admin = authResult.admin;
    const effectivePermissions = await getEffectivePermissions(
      admin.role,
      admin.menuPermissions
    );
    const token = await signAdminSession({
      admin,
      permissions: effectivePermissions,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        requiresPasswordChange: admin.mustChangePassword,
        nextPath: admin.mustChangePassword ? '/change-password' : '/',
      },
    });
    return setAdminSessionCookie(response, token);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `服务器内部错误: ${message}` },
      { status: 500 }
    );
  }
}
