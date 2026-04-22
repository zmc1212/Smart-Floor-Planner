import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';

// PATCH /api/admin-users/[id] — Update admin user
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const { id } = await params;
    const body = await request.json();
    const { username, displayName, role, menuPermissions, status, newPassword, enterpriseId } = body;

    const updateData: any = {};

    if (username !== undefined) updateData.username = username.trim();
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (role !== undefined) {
      const allowedRoles = ['super_admin', 'admin', 'viewer', 'enterprise_admin'];
      if (!allowedRoles.includes(role)) {
        return NextResponse.json({ success: false, error: '此接口仅允许分配管理类角色' }, { status: 400 });
      }
      updateData.role = role;
    }
    if (menuPermissions !== undefined) updateData.menuPermissions = menuPermissions;
    if (status !== undefined) updateData.status = status;
    if (enterpriseId !== undefined) updateData.enterpriseId = enterpriseId;

    // Password reset
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { success: false, error: '密码长度不能少于6位' },
          { status: 400 }
        );
      }
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const admin = await AdminUser.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select('-passwordHash');

    if (!admin) {
      return NextResponse.json({ success: false, error: '管理员不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: admin });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '用户名已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin-users/[id] — Delete admin user
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const { id } = await params;
    const admin = await AdminUser.findByIdAndDelete(id);
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理员不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
