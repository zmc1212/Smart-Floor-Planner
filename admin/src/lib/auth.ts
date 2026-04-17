import { NextRequest } from 'next/server';
import * as jose from 'jose';

export interface TenantContext {
  userId: string;
  role: 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'viewer';
  enterpriseId: string | null;
  username: string;
}

export async function getTenantContext(request: Request | NextRequest): Promise<TenantContext | null> {
  try {
    const cookie = request.headers.get('cookie');
    const tokenMatch = cookie?.match(/auth_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) return null;

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);

    return {
      userId: payload.id as string,
      role: payload.role as any,
      enterpriseId: payload.enterpriseId as string | null,
      username: payload.username as string,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Generates a MongoDB query filter based on the current user's role and enterprise.
 * @param context TenantContext
 * @param options optional overrides
 */
export function getTenantFilter(context: TenantContext, options: { 
  enterpriseField?: string; 
  staffField?: string; 
} = {}) {
  const { enterpriseField = 'enterpriseId', staffField = 'staffId' } = options;

  // Super Admins & System Admins see everything
  if (context.role === 'super_admin' || context.role === 'admin') {
    return {};
  }

  // Enterprise Admins see everything in their company
  if (context.role === 'enterprise_admin') {
    return { [enterpriseField]: context.enterpriseId };
  }

  // Designers and Sales see only their own data
  if (context.role === 'designer' || context.role === 'salesperson') {
    return { 
      [enterpriseField]: context.enterpriseId,
      [staffField]: context.userId 
    };
  }

  // Fallback: No access
  return { _id: null };
}
