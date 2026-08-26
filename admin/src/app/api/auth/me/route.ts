import * as jose from 'jose';
import { NextResponse } from 'next/server';
import { adminUserToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { setAdminSessionCookie, signAdminSession } from '@/lib/admin-session';
import {
  enterpriseAccessDeniedMessage,
  isEnterpriseOperationallyActive,
} from '@/lib/enterprise-status';
import {
  getEffectivePermissions,
  getWorkbenchType,
} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';

const PLATFORM_ROLES = new Set(['super_admin', 'admin']);

function clearAuthCookie(response: NextResponse) {
  const secureAuthCookie =
    process.env.NODE_ENV === 'production' &&
    process.env.AUTH_COOKIE_SECURE !== 'false';
  response.cookies.set({
    name: 'auth_token',
    value: '',
    httpOnly: true,
    secure: secureAuthCookie,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function GET(request: Request) {
  try {
    const cookie = request.headers.get('cookie');
    const tokenMatch = cookie?.match(/auth_token=([^;]+)/);
    let token = tokenMatch ? tokenMatch[1] : null;
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
    }
    if (!token) {
      return NextResponse.json(
        { success: false, error: '未登录' },
        { status: 401 }
      );
    }

    const globalTenantMatch = cookie?.match(/global_tenant_id=([^;]+)/);
    const globalTenantId = globalTenantMatch
      ? decodeURIComponent(globalTenantMatch[1])
      : null;
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback_secret_random_123'
    );
    const { payload } = await jose.jwtVerify(token, secret);
    const result = await withPlatformTransaction(async (transaction) => {
      const admin = await new AdminUserRepository(transaction).findById(
        parsePostgresId(payload.id, 'user id')
      );
      if (!admin || admin.status !== 'active') return null;

      let enterpriseId = admin.enterpriseId;
      if (
        (admin.role === 'super_admin' || admin.role === 'admin') &&
        globalTenantId &&
        globalTenantId !== 'all'
      ) {
        enterpriseId = parsePostgresId(globalTenantId, 'global tenant id');
      }
      const enterprise = enterpriseId
        ? await new EnterpriseRepository(transaction).findById(enterpriseId)
        : null;

      if (
        admin.enterpriseId &&
        !PLATFORM_ROLES.has(admin.role)
      ) {
        const boundEnterprise = await new EnterpriseRepository(
          transaction
        ).findById(admin.enterpriseId);
        if (
          !boundEnterprise ||
          !isEnterpriseOperationallyActive(boundEnterprise.status)
        ) {
          return {
            blocked: true as const,
            message: enterpriseAccessDeniedMessage(boundEnterprise?.status),
          };
        }
      }

      return { admin, enterprise, blocked: false as const };
    });
    if (!result) {
      return clearAuthCookie(
        NextResponse.json(
          { success: false, error: '用户不存在或已禁用' },
          { status: 401 }
        )
      );
    }
    if (result.blocked) {
      return clearAuthCookie(
        NextResponse.json(
          { success: false, error: result.message },
          { status: 401 }
        )
      );
    }

    const data = adminUserToDto(result.admin);
    data.enterpriseId = result.enterprise
      ? {
          _id: result.enterprise.id.toString(),
          name: result.enterprise.name,
          automationConfig: result.enterprise.automationConfig,
        }
      : null;
    const effectivePermissions = await getEffectivePermissions(
      result.admin.role,
      result.admin.menuPermissions
    );
    const response = NextResponse.json({
      success: true,
      data: {
        ...data,
        mustChangePassword: result.admin.mustChangePassword,
        effectivePermissions,
        workbenchType: getWorkbenchType(result.admin.role),
      },
    });

    const tokenPermissions = Array.isArray(payload.permissions)
      ? (payload.permissions as string[])
      : [];
    const permissionsChanged =
      tokenPermissions.length !== effectivePermissions.length ||
      effectivePermissions.some(
        (permission) => !tokenPermissions.includes(permission)
      );
    const passwordRequirementChanged =
      (payload.mustChangePassword === true) !== result.admin.mustChangePassword;
    if (permissionsChanged || passwordRequirementChanged) {
      const refreshedToken = await signAdminSession({
        admin: result.admin,
        permissions: effectivePermissions,
      });
      setAdminSessionCookie(response, refreshedToken);
    }

    return response;
  } catch {
    return clearAuthCookie(
      NextResponse.json(
        { success: false, error: '登录失效' },
        { status: 401 }
      )
    );
  }
}
