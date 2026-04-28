import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { Department } from '@/models/Department';
import { resolveWritableEnterpriseId, withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

interface StaffCreateBody {
  username?: string;
  password?: string;
  displayName?: string;
  role?: string;
  phone?: string;
  promoterIds?: string[];
  wecomUserId?: string;
  departmentId?: string;
  enterpriseId?: string;
}

export async function GET(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async () => {
        const { searchParams } = new URL(request.url);
        const search = searchParams.get('search') || '';
        const departmentId = searchParams.get('departmentId');

        const filter: Record<string, unknown> = {};

        if (departmentId && departmentId !== 'none' && departmentId !== 'all') {
          filter.departmentId = mongoose.Types.ObjectId.isValid(departmentId)
            ? new mongoose.Types.ObjectId(departmentId)
            : departmentId;
        } else if (departmentId === 'none') {
          filter.departmentId = null;
        }

        if (search.trim()) {
          const regex = new RegExp(search.trim(), 'i');
          filter.$or = [{ username: regex }, { displayName: regex }];
        }

        const staff = await AdminUser.find(filter)
          .populate({ path: 'enterpriseId', model: Enterprise, select: 'name' })
          .populate({ path: 'departmentId', model: Department, select: 'name' })
          .select('-passwordHash')
          .sort({ createdAt: -1 });

        return NextResponse.json({ success: true, data: staff });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const body = (await request.json()) as StaffCreateBody;
        const { username, password, displayName, role, phone, promoterIds, wecomUserId, departmentId } = body;

        if (!username || !password || !role) {
          return NextResponse.json({ success: false, error: '缺少必填字段' }, { status: 400 });
        }

        const targetEnterpriseId = resolveWritableEnterpriseId(context, body.enterpriseId);
        if (!targetEnterpriseId) {
          return NextResponse.json({ success: false, error: '无法确定关联企业' }, { status: 400 });
        }

        const businessRoles = ['enterprise_admin', 'designer', 'salesperson'];
        if (!businessRoles.includes(role)) {
          return NextResponse.json({ success: false, error: '该接口仅允许创建业务员工角色' }, { status: 403 });
        }

        if (context.role === 'enterprise_admin' && !['designer', 'salesperson'].includes(role)) {
          return NextResponse.json({ success: false, error: '无权创建该角色' }, { status: 403 });
        }

        const existing = await AdminUser.findOne({ username: username.trim() });
        if (existing) {
          return NextResponse.json({ success: false, error: '用户名已存在' }, { status: 400 });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const staff = await AdminUser.create({
          username: username.trim(),
          passwordHash,
          displayName: displayName?.trim() || '',
          phone: phone?.trim() || '',
          role,
          enterpriseId: targetEnterpriseId,
          departmentId:
            departmentId && departmentId !== 'none' && mongoose.Types.ObjectId.isValid(departmentId)
              ? new mongoose.Types.ObjectId(departmentId)
              : undefined,
          promoterIds,
          wecomUserId,
          status: 'active',
        });

        const result = staff.toObject() as Record<string, unknown>;
        delete result.passwordHash;
        return NextResponse.json({ success: true, data: result }, { status: 201 });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
