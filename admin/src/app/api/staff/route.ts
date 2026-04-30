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

async function getStaffByOpenid(openid: string) {
  const { User } = await import('@/models/User');
  const user = await User.findOne({ openid });
  if (!user || user.role !== 'staff') {
    return { user: null, staff: null };
  }

  const staff = await AdminUser.findOne({
    status: 'active',
    $or: [{ openid }, ...(user.phone ? [{ phone: user.phone }] : [])],
  });

  return { user, staff };
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid');

    if (openid) {
      const roles = searchParams.get('roles')?.split(',').map((item) => item.trim()).filter(Boolean) || [];
      const { staff } = await getStaffByOpenid(openid);

      if (!staff || staff.role !== 'enterprise_admin') {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      const filter: Record<string, unknown> = {
        enterpriseId: staff.enterpriseId,
        status: 'active',
      };

      if (roles.length > 0) {
        filter.role = { $in: roles };
      }

      const list = await AdminUser.find(filter)
        .select('displayName username role phone')
        .sort({ createdAt: -1 })
        .lean();

      return NextResponse.json({ success: true, data: list });
    }

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async () => {
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
          return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
        }

        const targetEnterpriseId = resolveWritableEnterpriseId(context, body.enterpriseId);
        if (!targetEnterpriseId) {
          return NextResponse.json({ success: false, error: 'Unable to determine enterprise' }, { status: 400 });
        }

        const businessRoles = ['enterprise_admin', 'designer', 'salesperson', 'measurer'];
        if (!businessRoles.includes(role)) {
          return NextResponse.json({ success: false, error: 'Unsupported staff role' }, { status: 403 });
        }

        if (context.role === 'enterprise_admin' && !['designer', 'salesperson', 'measurer'].includes(role)) {
          return NextResponse.json({ success: false, error: 'Forbidden role' }, { status: 403 });
        }

        const existing = await AdminUser.findOne({ username: username.trim() });
        if (existing) {
          return NextResponse.json({ success: false, error: 'Username already exists' }, { status: 400 });
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

        const result = staff.toObject() as unknown as Record<string, unknown>;
        delete result.passwordHash;
        return NextResponse.json({ success: true, data: result }, { status: 201 });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
