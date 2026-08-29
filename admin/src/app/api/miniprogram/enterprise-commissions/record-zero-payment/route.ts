import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadCommissionRepository } from '@/db/repositories';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type RecordZeroPaymentBody = {
  commissionId?: unknown;
  paidAmount?: unknown;
};

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramEnterpriseAdmin(context);
    const body = (await request.json()) as RecordZeroPaymentBody;
    if (body.commissionId === undefined || body.commissionId === null || body.commissionId === '') {
      return NextResponse.json({ success: false, error: 'commissionId 必填' }, { status: 400 });
    }
    if (typeof body.paidAmount !== 'string' && typeof body.paidAmount !== 'number') {
      return NextResponse.json({ success: false, error: '实际付款金额格式无效' }, { status: 400 });
    }

    const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
    const actorId = parsePostgresId(context.staff!._id, 'staff id');
    const commissionId = parsePostgresId(body.commissionId, 'commission id');
    const row = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new LeadCommissionRepository(transaction).recordZeroAmountPayment(
        enterpriseId,
        commissionId,
        actorId,
        String(body.paidAmount)
      )
    );

    return NextResponse.json({
      success: true,
      data: {
        id: row.id.toString(),
        payableAmount: row.payableAmount,
        originalPayableAmount: row.originalPayableAmount,
        adjustedAt: row.adjustedAt,
        adjustedBy: row.adjustedBy?.toString() ?? null,
        adjustReason: row.adjustReason,
        status: row.status,
        paidAt: row.paidAt,
        paidBy: row.paidBy?.toString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '快速记账失败',
    }, { status: httpErrorStatus(error, 400) });
  }
}
