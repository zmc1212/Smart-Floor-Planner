import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { getEffectivePermissions } from '@/lib/staff-access';
import { setAdminSessionCookie, signAdminSession } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 32;

export async function PUT(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!currentPassword) {
      return NextResponse.json(
        { success: false, error: '请输入当前密码' },
        { status: 400 }
      );
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { success: false, error: '新密码不能少于 6 位' },
        { status: 400 }
      );
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json(
        { success: false, error: '新密码不能超过 32 位' },
        { status: 400 }
      );
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: '两次输入的新密码不一致' },
        { status: 400 }
      );
    }

    const adminId = parsePostgresId(context.userId, 'user id');
    const admin = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).findById(adminId)
    );
    if (!admin || admin.status !== 'active') {
      return NextResponse.json(
        { success: false, error: '用户不存在或已禁用' },
        { status: 401 }
      );
    }
    if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) {
      return NextResponse.json(
        { success: false, error: '当前密码不正确' },
        { status: 400 }
      );
    }
    if (await bcrypt.compare(newPassword, admin.passwordHash)) {
      return NextResponse.json(
        { success: false, error: '新密码不能与当前密码相同' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).update(adminId, {
        passwordHash,
        mustChangePassword: false,
      })
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: '用户不存在或已禁用' },
        { status: 401 }
      );
    }

    const permissions = await getEffectivePermissions(
      updated.role,
      updated.menuPermissions
    );
    const token = await signAdminSession({ admin: updated, permissions });
    const response = NextResponse.json({ success: true, data: {} });

    return setAdminSessionCookie(response, token);
  } catch (error) {
    console.error('[AuthPassword] Password update failed', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '密码修改失败',
      },
      { status: 400 }
    );
  }
}
