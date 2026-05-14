import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import * as jose from 'jose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { getEffectivePermissions, getWorkbenchType } from '@/lib/staff-access';

export async function GET(request: Request) {
  await dbConnect();
  try {
    const cookie = request.headers.get('cookie');
    const tokenMatch = cookie?.match(/auth_token=([^;]+)/);
    let token = tokenMatch ? tokenMatch[1] : null;

    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }
    const globalTenantMatch = cookie?.match(/global_tenant_id=([^;]+)/);
    const globalTenantId = globalTenantMatch ? decodeURIComponent(globalTenantMatch[1]) : null;

    if (!token) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);

    const admin = await AdminUser.findById(payload.id)
      .populate({ path: 'enterpriseId', model: Enterprise, select: 'name automationConfig' })
      .select('-passwordHash');
    if (!admin || admin.status === 'disabled') {
      return NextResponse.json({ success: false, error: '用户不存在或已禁用' }, { status: 401 });
    }

    const result = admin.toObject() as unknown as Record<string, unknown> & {
      role?: string;
      menuPermissions?: string[];
      enterpriseId?: unknown;
    };
    if (
      (result.role === 'super_admin' || result.role === 'admin') &&
      globalTenantId &&
      globalTenantId !== 'all'
    ) {
      const selectedEnterprise = await Enterprise.findById(globalTenantId).select('name automationConfig').lean();
      if (selectedEnterprise) {
        result.enterpriseId = {
          _id: String(selectedEnterprise._id),
          name: selectedEnterprise.name,
          automationConfig: selectedEnterprise.automationConfig,
        };
      }
    }

    const role = result.role || '';
    const effectivePermissions = await getEffectivePermissions(role, result.menuPermissions);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        effectivePermissions,
        workbenchType: getWorkbenchType(role),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: '登录失效' }, { status: 401 });
  }
}
