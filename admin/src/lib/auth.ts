import { NextRequest } from 'next/server';
import * as jose from 'jose';
import { tenantStorage, TenantStore } from './tenant-context';

export interface TenantContext {
  userId: string;
  role: 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'measurer' | 'viewer';
  enterpriseId: string | null;
  username: string;
}

export async function getTenantContext(request: Request | NextRequest): Promise<TenantContext | null> {
  try {
    // 1. 优先从 Cookie 读取（Admin Dashboard 浏览器端）
    const cookie = request.headers.get('cookie');
    const tokenMatch = cookie?.match(/auth_token=([^;]+)/);
    let token = tokenMatch ? tokenMatch[1] : null;

    // 2. 若 Cookie 中没有，从 Authorization Header 读取（小程序端 Bearer Token）
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) return null;

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);
    // Mini Program JWTs share JWT_SECRET but use aud=miniprogram and put the
    // base users.id in `id`. Never treat them as Admin tenant sessions.
    const audience = payload.aud;
    const audiences = Array.isArray(audience) ? audience : audience ? [audience] : [];
    if (audiences.includes('miniprogram')) return null;

    let enterpriseId = payload.enterpriseId as string | null;

    // Check for global tenant selector cookie for super admins
    if (payload.role === 'super_admin' || payload.role === 'admin') {
      const globalTenantMatch = cookie?.match(/global_tenant_id=([^;]+)/);
      const globalTenantId = globalTenantMatch ? globalTenantMatch[1] : null;
      if (globalTenantId && globalTenantId !== 'all') {
        enterpriseId = globalTenantId;
      }
    }

    return {
      userId: payload.id as string,
      role: payload.role as any,
      enterpriseId,
      username: payload.username as string,
    };
  } catch (error) {
    return null;
  }
}

/**
 * 包装器：在租户上下文中运行执行函数
 * 这是实现自动租户隔离的核心函数
 */
export async function withTenantContext<T>(
  request: Request | NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const context = await getTenantContext(request);

  if (!context) {
    throw new Error('Unauthorized');
  }

  // 使用 run 方法开启一个新的上下文作用域
  return tenantStorage.run(
    {
      enterpriseId: context.enterpriseId,
      role: context.role,
      userId: context.userId,
      username: context.username
    } as TenantStore,
    handler
  );
}

export function getPlatformB2BTenantContext(context: TenantContext): TenantContext {
  if (context.role === 'super_admin' || context.role === 'admin') {
    return { ...context, enterpriseId: null };
  }

  return context;
}

export async function withPlatformB2BTenantContext<T>(
  request: Request | NextRequest,
  handler: (context: TenantContext) => Promise<T>
): Promise<T> {
  const context = await getTenantContext(request);

  if (!context) {
    throw new Error('Unauthorized');
  }

  const b2bContext = getPlatformB2BTenantContext(context);

  return tenantStorage.run(
    {
      enterpriseId: b2bContext.enterpriseId,
      role: b2bContext.role,
      userId: b2bContext.userId,
      username: b2bContext.username,
    } as TenantStore,
    () => handler(b2bContext)
  );
}

/**
 * Generates a MongoDB query filter based on the current user's role and enterprise.
 * @param context TenantContext
 * @param options optional overrides
 * @deprecated 使用 withTenantContext + multiTenantPlugin 替代此方法
 */
export function getTenantFilter(context: TenantContext, options: {
  enterpriseField?: string;
  staffField?: string;
} = {}) {
  const { enterpriseField = 'enterpriseId', staffField = 'staffField' } = options;

  // Super Admins & System Admins see everything
  if (context.role === 'super_admin' || context.role === 'admin') {
    return {};
  }

  // Enterprise Admins see everything in their company
  if (context.role === 'enterprise_admin') {
    return { [enterpriseField]: context.enterpriseId };
  }

  // Designers and Sales see only their own data
  if (context.role === 'designer' || context.role === 'salesperson' || context.role === 'measurer') {
    return {
      [enterpriseField]: context.enterpriseId,
      [staffField]: context.userId
    };
  }

  // Fallback: No access
  return { _id: null };
}

