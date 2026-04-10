import { NextResponse } from 'next/server';
import * as jose from 'jose';
import dbConnect from '@/lib/mongodb';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';

export async function GET(request: Request) {
  await dbConnect();
  try {
    const cookie = request.headers.get('cookie');
    const tokenMatch = cookie?.match(/auth_token=([^;]+)/);
    const token = tokenMatch ? tokenMatch[1] : null;

    if (!token) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);

    const admin = await AdminUser.findById(payload.id).select('-passwordHash');
    if (!admin || admin.status === 'disabled') {
      return NextResponse.json({ success: false, error: '用户不存在或已禁用' }, { status: 401 });
    }

    const a = admin.toObject();
    const effectivePermissions = 
      a.menuPermissions && a.menuPermissions.length > 0
        ? a.menuPermissions
        : DEFAULT_PERMISSIONS[a.role] || [];

    return NextResponse.json({ success: true, data: { ...a, effectivePermissions } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: '登录失效' }, { status: 401 });
  }
}
