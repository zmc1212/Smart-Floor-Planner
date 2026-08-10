import { NextResponse } from 'next/server';
import { acquisitionCommissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    const id = parsePostgresId((await params).id, 'commission id');
    const result = await withAdminPostgresTransaction(context, async (transaction) => {
      const repository = new AcquisitionRepository(transaction);
      const current = await repository.findCommissionById(id);
      if (!current) return { error: '获客提成记录不存在', status: 404 } as const;
      if (context.role === 'enterprise_admin' && current.enterpriseId.toString() !== context.enterpriseId) return { error: '无权操作该企业提成', status: 403 } as const;
      if (current.status !== 'pending_settlement') return { error: '该提成已结算或作废', status: 400 } as const;
      const settled = await repository.settleCommission(id, parsePostgresId(context.userId, 'settledBy'));
      return settled ? { data: settled } : { error: '提成状态已发生变化，请刷新后重试', status: 409 } as const;
    });
    if ('error' in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: acquisitionCommissionToDto(result.data) });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '结算获客提成失败' }, { status: 500 });
  }
}
