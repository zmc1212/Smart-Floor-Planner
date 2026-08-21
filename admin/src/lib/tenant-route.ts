import { NextRequest, NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext, TenantContext } from './auth';
import {
  enterpriseAccessDeniedMessage,
  isEnterpriseOperationallyActive,
} from './enterprise-status';
import { tenantStorage } from './tenant-context';

type TenantRole = TenantContext['role'];

interface TenantRouteOptions {
  roles?: TenantRole[];
  requireEnterprise?: boolean;
}

const PLATFORM_ROLES = new Set<TenantRole>(['super_admin', 'admin']);

async function assertBoundEnterpriseActive(context: TenantContext) {
  if (!context.enterpriseId || PLATFORM_ROLES.has(context.role)) {
    return null;
  }

  // JWT enterpriseId for platform roles may be a global selector; only gate
  // staff whose role is enterprise-bound. Re-read the admin's bound enterprise
  // from the JWT enterpriseId which for merchant roles is their home tenant.
  const enterprise = await withPlatformTransaction((transaction) =>
    new EnterpriseRepository(transaction).findById(
      parsePostgresId(context.enterpriseId!, 'enterprise id')
    )
  );
  if (!enterprise || !isEnterpriseOperationallyActive(enterprise.status)) {
    return enterpriseAccessDeniedMessage(enterprise?.status);
  }
  return null;
}

export async function withTenantRoute<T>(
  request: Request | NextRequest,
  options: TenantRouteOptions,
  handler: (context: TenantContext) => Promise<T>
): Promise<T | NextResponse> {
  const context = await getTenantContext(request);

  if (!context) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (options.roles && !options.roles.includes(context.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  if (options.requireEnterprise && !context.enterpriseId) {
    return NextResponse.json(
      { success: false, error: 'Please select an enterprise first' },
      { status: 400 }
    );
  }

  const blockedMessage = await assertBoundEnterpriseActive(context);
  if (blockedMessage) {
    const response = NextResponse.json(
      { success: false, error: blockedMessage },
      { status: 401 }
    );
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

  return tenantStorage.run(
    {
      enterpriseId: context.enterpriseId,
      role: context.role,
      userId: context.userId,
    },
    () => handler(context)
  );
}

export function resolveWritableEnterpriseId(
  context: TenantContext,
  explicitEnterpriseId?: string | null
): string | null {
  if (context.role === 'super_admin' || context.role === 'admin') {
    return explicitEnterpriseId || context.enterpriseId;
  }

  return context.enterpriseId;
}
