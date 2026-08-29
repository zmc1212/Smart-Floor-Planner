import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadCommissionRepository } from '@/db/repositories';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type AdjustAmountBody = {
  payableAmount?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    requireMiniProgramEnterpriseAdmin(context);

    const body = (await request.json()) as AdjustAmountBody;
    if (typeof body.payableAmount !== 'string' && typeof body.payableAmount !== 'number') {
      return NextResponse.json({ success: false, error: '应付金额格式无效' }, { status: 400 });
    }
    const payableAmount = String(body.payableAmount).trim();
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(payableAmount)) {
      return NextResponse.json({ success: false, error: '应付金额须为 0 至 999999999999.99，最多两位小数' }, { status: 400 });
    }

    const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
    const actorId = parsePostgresId(context.staff!._id, 'staff id');
    const commissionId = parsePostgresId((await params).id, 'commission id');
    const row = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new LeadCommissionRepository(transaction).adjustPayable(enterpriseId, commissionId, actorId, {
        payableAmount,
        reason: '小程序提成金额调整',
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        id: row.id.toString(),
        role: row.role,
        payableAmount: row.payableAmount,
        originalPayableAmount: row.originalPayableAmount,
        adjustedAt: row.adjustedAt,
        adjustedBy: row.adjustedBy?.toString() ?? null,
        adjustReason: row.adjustReason,
        status: row.status,
        updatedAt: row.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '调整提成金额失败',
    }, { status: httpErrorStatus(error, 400) });
  }
}
