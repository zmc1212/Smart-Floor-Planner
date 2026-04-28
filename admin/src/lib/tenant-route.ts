import { NextRequest, NextResponse } from 'next/server';
import { getTenantContext, TenantContext } from './auth';
import { tenantStorage } from './tenant-context';

type TenantRole = TenantContext['role'];

interface TenantRouteOptions {
  roles?: TenantRole[];
  requireEnterprise?: boolean;
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
