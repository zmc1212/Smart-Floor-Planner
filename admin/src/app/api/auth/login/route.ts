import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import { NextResponse } from 'next/server';
import { AdminUserRepository, EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
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
        { success: false, error: '请输入用户名和密码' },
        { status: 400 }
      );
    }

    const authResult = await withPlatformTransaction(async (transaction) => {
      const admin = await new AdminUserRepository(
        transaction
      ).findByUsernameOrPhone(username.trim(), true);
      if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
        return { kind: 'invalid_credentials' as const };
      }

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
        { success: false, error: '用户名或密码错误' },
        { status: 401 }
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
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback_secret_random_123'
    );
    const token = await new jose.SignJWT({
      id: admin.id.toString(),
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      enterpriseId: admin.enterpriseId?.toString() || null,
      permissions: effectivePermissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    const response = NextResponse.json({
      success: true,
      data: {
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
      },
    });
    const secureAuthCookie =
      process.env.NODE_ENV === 'production' &&
      process.env.AUTH_COOKIE_SECURE !== 'false';
    response.cookies.set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      secure: secureAuthCookie,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `服务器内部错误: ${message}` },
      { status: 500 }
    );
  }
}
