import * as jose from 'jose';
import { NextResponse } from 'next/server';
import { adminUserToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  getEffectivePermissions,
  getWorkbenchType,
} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';

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
      return { admin, enterprise };
    });
    if (!result) {
      return NextResponse.json(
        { success: false, error: '用户不存在或已禁用' },
        { status: 401 }
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
    return NextResponse.json({
      success: true,
      data: {
        ...data,
        effectivePermissions,
        workbenchType: getWorkbenchType(result.admin.role),
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: '登录失效' },
      { status: 401 }
    );
  }
}
