import { cache } from 'react';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role:
    | 'super_admin'
    | 'admin'
    | 'enterprise_admin'
    | 'designer'
    | 'salesperson'
    | 'measurer'
    | 'viewer';
  enterpriseId: string | null;
  enterpriseName: string | null;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    const globalTenantId = cookieStore.get('global_tenant_id')?.value;
    if (!token) return null;

    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'fallback_secret_random_123'
    );
    const { payload } = await jose.jwtVerify(token, secret);
    const result = await withPlatformTransaction(async (transaction) => {
      const admin = await new AdminUserRepository(transaction).findById(
        parsePostgresId(payload.id, 'session user id')
      );
      if (!admin || admin.status !== 'active') return null;

      let enterpriseId = admin.enterpriseId;
      let enterpriseName = admin.enterpriseName;
      if (
        (admin.role === 'super_admin' || admin.role === 'admin') &&
        globalTenantId &&
        globalTenantId !== 'all'
      ) {
        const selectedEnterprise = await new EnterpriseRepository(
          transaction
        ).findById(parsePostgresId(globalTenantId, 'global tenant id'));
        if (selectedEnterprise) {
          enterpriseId = selectedEnterprise.id;
          enterpriseName = selectedEnterprise.name;
        }
      }
      return {
        id: admin.id.toString(),
        username: admin.username,
        displayName: admin.displayName || admin.username,
        role: admin.role as SessionUser['role'],
        enterpriseId: enterpriseId?.toString() ?? null,
        enterpriseName: enterpriseName || null,
      };
    });
    return result;
  } catch {
    return null;
  }
});
