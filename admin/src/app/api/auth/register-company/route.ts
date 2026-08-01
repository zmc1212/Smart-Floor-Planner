import { NextResponse } from 'next/server';
import { EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.code || !body.contactPerson?.phone) {
      return NextResponse.json(
        { success: false, error: '请填写公司名称、统一社会信用代码和联系电话' },
        { status: 400 }
      );
    }

    const enterprise = await withPlatformTransaction(async (transaction) => {
      const repository = new EnterpriseRepository(transaction);
      if (
        await repository.findByNameOrCode(
          body.name.trim(),
          body.code.trim()
        )
      ) {
        throw Object.assign(new Error('公司名称或统一社会信用代码已注册'), {
          code: '23505',
        });
      }
      return repository.create({
        name: body.name.trim(),
        code: body.code.trim(),
        contactPerson: body.contactPerson,
        address: body.address || null,
        industry: body.industry || null,
        description: body.description || null,
        status: 'pending_approval',
        registrationMode: 'self_service',
      });
    });

    return NextResponse.json({
      success: true,
      message: '申请已提交，请等待管理员审核',
      data: { id: enterprise.id.toString() },
    });
  } catch (error: unknown) {
    const details = error as { code?: string };
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: details.code === '23505' ? 400 : 500 }
    );
  }
}
