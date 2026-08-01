import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { adminUserToDto, parseOptionalPostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  getEffectivePermissions,
  getRolePermissionMap,
} from '@/lib/staff-access';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = [
  'super_admin',
  'admin',
  'viewer',
  'enterprise_admin',
  'salesperson',
];

function duplicateResponse(error: unknown) {
  const details = error as {
    code?: string;
    constraint?: string;
    field?: string;
  };
  if (details.code !== '23505' && !details.field) return null;
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const admins = await withPlatformTransaction((transaction) =>
      new AdminUserRepository(transaction).list({
        roles: ADMIN_ROLES,
        search: searchParams.get('search') || '',
        page: 1,
        limit: 1000,
      })
    );
    const roleMap = await getRolePermissionMap();
    const data = admins.rows.map((admin) => ({
      ...adminUserToDto(admin),
      effectivePermissions:
        roleMap[admin.role] || DEFAULT_PERMISSIONS[admin.role] || [],
    }));
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      username,
      password,
      displayName,
      phone,
      role,
      menuPermissions,
      enterpriseId,
    } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: '用户名和密码不能为空' },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: '密码长度不能少于 6 位' },
        { status: 400 }
      );
    }

    const trimmedPhone = phone?.trim();
    if (!trimmedPhone) {
      return NextResponse.json(
        { success: false, error: '联系电话为必填项' },
        { status: 400 }
      );
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      return NextResponse.json(
        { success: false, error: '请输入 11 位有效手机号' },
        { status: 400 }
      );
    }

    const targetRole = role || 'admin';
    if (!ADMIN_ROLES.includes(targetRole)) {
      return NextResponse.json(
        { success: false, error: '此接口仅允许创建管理类角色' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const effectivePermissions =
      menuPermissions?.length > 0
        ? menuPermissions
        : await getEffectivePermissions(targetRole);
    const targetEnterpriseId =
      targetRole === 'salesperson'
        ? null
        : parseOptionalPostgresId(enterpriseId, 'enterpriseId');

    const admin = await withPlatformTransaction(async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      if (await repository.existsWithUsername(username.trim())) {
        throw Object.assign(new Error('Username already exists'), {
          field: 'username',
        });
      }
      if (await repository.existsWithPhone(trimmedPhone)) {
        throw Object.assign(new Error('Phone already exists'), {
          field: 'phone',
        });
      }
      return repository.create({
        username: username.trim(),
        passwordHash,
        displayName: displayName?.trim() || '',
        phone: trimmedPhone,
        role: targetRole,
        enterpriseId: targetEnterpriseId,
        menuPermissions: effectivePermissions,
      });
    });

    return NextResponse.json(
      { success: true, data: adminUserToDto(admin) },
      { status: 201 }
    );
  } catch (error: unknown) {
    const duplicate = duplicateResponse(error);
    if (duplicate) return duplicate;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
