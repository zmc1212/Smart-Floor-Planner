import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import bcrypt from 'bcryptjs';
import * as jose from 'jose';
import dbConnect from '@/lib/mongodb';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';

export async function POST(request: Request) {
  try {
    console.log("Login route hit, connecting to DB...");
    await dbConnect();
    console.log("DB connection successful in login route.");
    
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      console.log("Login failed: missing username or password");
      return NextResponse.json({ success: false, error: '请输入用户名和密码' }, { status: 400 });
    }

    console.log(`Looking up user: ${username}`);
    const admin = await AdminUser.findOne({ username: username.trim(), status: 'active' });
    if (!admin) {
      console.log(`Login failed: user ${username} not found or inactive`);
      return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
    }

    console.log(`User found. Checking password...`);
    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      console.log(`Login failed: password mismatch for user ${username}`);
      return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
    }

    console.log(`Password match. Generating JWT...`);
    // Calculate effective permissions
    const effectivePermissions = 
      admin.menuPermissions && admin.menuPermissions.length > 0
        ? admin.menuPermissions
        : DEFAULT_PERMISSIONS[admin.role] || [];

    // Generate JWT
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const token = await new jose.SignJWT({ 
      id: admin._id.toString(), 
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      permissions: effectivePermissions
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
        role: admin.role
      } 
    });

    // Set HTTP-only cookie
    response.cookies.set({
      name: 'auth_token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    });
    
    console.log(`Login successful for user ${username}`);
    return response;
  } catch (error: any) {
    console.error("Login API Error:", error);
    return NextResponse.json({ success: false, error: `服务器内部错误: ${error.message}` }, { status: 500 });
  }
}
