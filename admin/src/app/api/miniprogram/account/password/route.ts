import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export async function PUT(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!context.staff) {
      return NextResponse.json(
        { success: false, error: '微信快捷登录账号无需设置密码' },
        { status: 403 }
      );
    }
    const body = await request.json();
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!currentPassword) {
      return NextResponse.json(
        { success: false, error: '请输入当前密码' },
        { status: 400 }
      );
    }
    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, error: '新密码不能少于 6 位' },
        { status: 400 }
      );
    }
    const staffId = parsePostgresId(context.staff._id, 'staff id');
    const staff = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).findById(staffId)
    );
    if (!staff || !(await bcrypt.compare(currentPassword, staff.passwordHash))) {
      return NextResponse.json(
        { success: false, error: '当前密码不正确' },
        { status: 400 }
      );
    }
    if (await bcrypt.compare(newPassword, staff.passwordHash)) {
      return NextResponse.json(
        { success: false, error: '新密码不能与当前密码相同' },
        { status: 400 }
      );
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).update(staffId, {
        passwordHash,
        mustChangePassword: false,
      })
    );
    return NextResponse.json({ success: true, data: {} });
  } catch (error) {
    console.error('[MiniProgramAccount] Password update failed', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '密码修改失败',
      },
      { status: 400 }
    );
  }
}
