import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadCommissionRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramStaffEarnings } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    const role = requireMiniProgramStaffEarnings(context);
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new LeadCommissionRepository(transaction).listOwnStaffEarnings({
        userId: parsePostgresId(context.user._id, 'user id'),
        enterpriseId: parsePostgresId(context.enterpriseId!, 'enterprise id'),
        staffId: parsePostgresId(context.staff!._id, 'staff id'),
        role,
        enterpriseName: context.enterprise?.name || '',
      })
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '读取岗位收益失败',
    }, { status });
  }
}
