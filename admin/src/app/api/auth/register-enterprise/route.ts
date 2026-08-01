import { NextResponse } from 'next/server';
import { enterpriseToDto } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, code, contactPerson } = body;
    if (!name || !code || !contactPerson?.name || !contactPerson?.phone) {
      return NextResponse.json(
        { success: false, error: '请填写所有必填字段' },
        { status: 400 }
      );
    }

    const phone = contactPerson.phone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return NextResponse.json(
        { success: false, error: '联系人手机号格式不正确' },
        { status: 400 }
      );
    }

    const enterprise = await withPlatformTransaction(async (transaction) => {
      const adminUsers = new AdminUserRepository(transaction);
      const enterprises = new EnterpriseRepository(transaction);
      if (await adminUsers.findByUsernameOrPhone(phone)) {
        throw Object.assign(
          new Error('该联系人手机号已注册为系统账号，请更换手机号或联系平台管理员'),
          { code: 'ACCOUNT_CONFLICT' }
        );
      }
      if (await enterprises.findByCode(code.trim())) {
        throw Object.assign(new Error('该统一社会信用代码已注册'), {
          code: '23505',
        });
      }
      return enterprises.create({
        name: name.trim(),
        code: code.trim(),
        contactPerson: { ...contactPerson, phone },
        status: 'pending_approval',
        registrationMode: 'self_service',
      });
    });

    return NextResponse.json({
      success: true,
      data: enterpriseToDto(enterprise),
    });
  } catch (error: unknown) {
    const details = error as { code?: string };
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      {
        status:
          details.code === '23505' || details.code === 'ACCOUNT_CONFLICT'
            ? 400
            : 500,
      }
    );
  }
}
