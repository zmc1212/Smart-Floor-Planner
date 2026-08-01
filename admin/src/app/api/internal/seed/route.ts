import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getEffectivePermissions } from '@/lib/staff-access';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SECRET?.trim();
  const initialUsername =
    process.env.INITIAL_ADMIN_USERNAME?.trim() || 'admin';
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!expectedSecret || expectedSecret.length < 32) {
    return NextResponse.json(
      { error: 'Seed credentials are not configured' },
      { status: 503 }
    );
  }
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!initialPassword || initialPassword.length < 12) {
    return NextResponse.json(
      { error: 'Seed credentials are not configured' },
      { status: 503 }
    );
  }

  try {
    const menuPermissions = await getEffectivePermissions('super_admin');
    const created = await withPlatformTransaction(async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      if (await repository.findByUsernameOrPhone(initialUsername)) return false;

      await repository.create({
        username: initialUsername,
        passwordHash: await bcrypt.hash(initialPassword, 10),
        displayName: '系统管理员',
        role: 'super_admin',
        menuPermissions,
        status: 'active',
      });
      return true;
    });

    return NextResponse.json({
      success: true,
      message: created
        ? '初始平台账号已创建'
        : '平台账号已存在，无需初始化',
    });
  } catch (error: unknown) {
    console.error('[Seed API Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
