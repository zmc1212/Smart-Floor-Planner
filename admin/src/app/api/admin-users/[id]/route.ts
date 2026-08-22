import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import {
  adminUserToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = [
  'super_admin',
  'admin',
  'viewer',
  'enterprise_admin',
  'salesperson',
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const adminId = parsePostgresId(id);
    const body = await request.json();
    const {
      username,
      displayName,
      phone,
      role,
      menuPermissions,
      status,
      newPassword,
      enterpriseId,
    } = body;
    const updateData: Record<string, unknown> = {};

    if (username !== undefined) updateData.username = username.trim();
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (phone !== undefined) {
      const trimmedPhone = phone.trim();
      if (trimmedPhone && !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
        return NextResponse.json(
          { success: false, error: '请输入 11 位有效手机号' },
          { status: 400 }
        );
      }
      updateData.phone = trimmedPhone || null;
    }
    if (role !== undefined) {
      if (!ADMIN_ROLES.includes(role)) {
        return NextResponse.json(
          { success: false, error: '此接口仅允许分配管理类角色' },
          { status: 400 }
        );
      }
      updateData.role = role;
    }
    if (menuPermissions !== undefined) {
      updateData.menuPermissions = menuPermissions;
    }
    if (status !== undefined) updateData.status = status;
    if (enterpriseId !== undefined) {
      updateData.enterpriseId = parseOptionalPostgresId(
        enterpriseId,
        'enterpriseId'
      );
    }
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { success: false, error: '密码长度不能少于 6 位' },
          { status: 400 }
        );
      }
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const admin = await withPlatformTransaction(async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      const existing = await repository.findById(adminId);
      if (!existing) return null;
      if (
        username !== undefined &&
        username.trim() !== existing.username &&
        (await repository.existsWithUsername(username.trim(), adminId))
      ) {
        throw Object.assign(new Error('Username already exists'), {
          field: 'username',
        });
      }
      if (
        phone?.trim() &&
        phone.trim() !== existing.phone &&
        (await repository.existsWithPhone(phone.trim(), {
          excludeId: adminId,
          enterpriseId: existing.enterpriseId,
        }))
      ) {
        throw Object.assign(new Error('Phone already exists'), {
          field: 'phone',
        });
      }
      if ((role || existing.role) === 'salesperson') {
        updateData.enterpriseId = null;
      }
      return repository.update(adminId, updateData);
    });

    if (!admin) {
      return NextResponse.json(
        { success: false, error: '管理员不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      data: adminUserToDto(admin),
    });
  } catch (error: unknown) {
    const details = error as {
      code?: string;
      constraint?: string;
      field?: string;
    };
    if (details.code === '23505' || details.field) {
      const isPhone =
        details.field === 'phone' || details.constraint?.includes('phone');
      return NextResponse.json(
        {
          success: false,
          error: isPhone ? '该手机号已被其他账号使用' : '用户名已存在',
        },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).delete(parsePostgresId(id))
    );
    if (!admin) {
      return NextResponse.json(
        { success: false, error: '管理员不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
