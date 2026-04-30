import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { getEffectivePermissions } from '@/lib/staff-access';

export async function POST(request: Request) {
  try {
    await dbConnect();

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: '请输入用户名和密码' }, { status: 400 });
    }

    const admin = await AdminUser.findOne({ username: username.trim(), status: 'active' });
    if (!admin) {
      return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
    }

    const effectivePermissions = getEffectivePermissions(admin.role, admin.menuPermissions);

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const token = await new jose.SignJWT({
      id: admin._id.toString(),
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      enterpriseId: admin.enterpriseId?.toString() || null,
      permissions: effectivePermissions,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);

    const response = NextResponse.json({
      success: true,
      data: {
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
      },
    });

    response.cookies.set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ success: false, error: `服务器内部错误: ${error.message}` }, { status: 500 });
  }
}
