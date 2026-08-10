import { NextResponse } from 'next/server';
import { acquisitionCommissionToDto, parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const mini = await resolveMiniProgramContext(request);
    if (mini?.staff) {
      if (mini.staff.role !== 'measurer') return NextResponse.json({ success: false, error: '仅测量员可以查看获客提成' }, { status: 403 });
      const result = await withMiniProgramPostgresTransaction(mini, async (transaction) => {
        const repository = new AcquisitionRepository(transaction);
        const measurerId = parsePostgresId(mini.staff!._id, 'measurer id');
        const [data, summary] = await Promise.all([repository.listCommissions({ measurerId, status }), repository.summary({ measurerId, status })]);
        return { data, summary };
      });
      return NextResponse.json({ success: true, data: result.data.map(acquisitionCommissionToDto), summary: result.summary });
    }
    const context = await getTenantContext(request);
    if (!context || !['enterprise_admin', 'admin', 'super_admin'].includes(context.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    const enterpriseId = context.role === 'enterprise_admin' ? context.enterpriseId : searchParams.get('enterpriseId') || context.enterpriseId;
    const result = await withAdminPostgresTransaction(context, async (transaction) => {
      const repository = new AcquisitionRepository(transaction);
      const options = { enterpriseId: enterpriseId ? parsePostgresId(enterpriseId, 'enterpriseId') : undefined, measurerId: searchParams.get('measurerId') ? parsePostgresId(searchParams.get('measurerId')!, 'measurerId') : undefined, status };
      const [data, summary] = await Promise.all([repository.listCommissions(options), repository.summary(options)]);
      return { data, summary };
    });
    return NextResponse.json({ success: true, data: result.data.map(acquisitionCommissionToDto), summary: result.summary });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取获客提成失败' }, { status: 500 });
  }
}
