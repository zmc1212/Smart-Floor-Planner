import { cache } from 'react';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'measurer' | 'viewer';
  enterpriseId: string | null;
  enterpriseName: string | null;
}

/**
 * 使用 React.cache() 实现单请求内去重的会话用户获取。
 * 同一个 RSC 请求中多次调用只会执行一次数据库查询。
 * 
 * @see react-best-practices: server-cache-react
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    await dbConnect();

    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    const globalTenantId = cookieStore.get('global_tenant_id')?.value;

    if (!token) return null;

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);

    const admin = await AdminUser.findById(payload.id)
      .select('username displayName role enterpriseId')
      .populate({ path: 'enterpriseId', model: Enterprise, select: 'name' })
      .lean();

    if (!admin) return null;

    let enterprise = admin.enterpriseId as unknown as { _id?: string; name?: string } | null;

    if (
      (admin.role === 'super_admin' || admin.role === 'admin') &&
      globalTenantId &&
      globalTenantId !== 'all'
    ) {
      const selectedEnterprise = await Enterprise.findById(globalTenantId)
        .select('name')
        .lean<{ _id: unknown; name?: string } | null>();

      if (selectedEnterprise) {
        enterprise = {
          _id: String(selectedEnterprise._id),
          name: selectedEnterprise.name || undefined,
        };
      }
    }

    return {
      id: String(admin._id),
      username: admin.username,
      displayName: admin.displayName || admin.username,
      role: admin.role,
      enterpriseId: enterprise?._id ? String(enterprise._id) : null,
      enterpriseName: enterprise?.name || null,
    };
  } catch {
    return null;
  }
});
