import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';

// GET /api/admin-users — List all admin users (with optional search)
export async function GET(request: Request) {
  await dbConnect();
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    let filter: any = {};
    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter = {
        $or: [{ username: regex }, { displayName: regex }],
      };
    }

    const admins = await AdminUser.find(filter)
      .select('-passwordHash') // Never expose password hash
      .sort({ createdAt: -1 });

    // Attach effective permissions for each admin
    const data = admins.map((admin) => {
      const a = admin.toObject();
      const effectivePermissions =
        a.menuPermissions && a.menuPermissions.length > 0
          ? a.menuPermissions
          : DEFAULT_PERMISSIONS[a.role] || [];
      return { ...a, effectivePermissions };
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/admin-users — Create a new admin user
export async function POST(request: Request) {
  await dbConnect();
  try {
    const body = await request.json();
    const { username, password, displayName, role, menuPermissions } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: '用户名和密码为必填项' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: '密码长度不能少于6位' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existing = await AdminUser.findOne({ username: username.trim() });
    if (existing) {
      return NextResponse.json(
        { success: false, error: '用户名已存在' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await AdminUser.create({
      username: username.trim(),
      passwordHash,
      displayName: displayName?.trim() || '',
      role: role || 'admin',
      menuPermissions: menuPermissions || [],
    });

    // Return without passwordHash
    const result = admin.toObject();
    delete result.passwordHash;

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '用户名已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
