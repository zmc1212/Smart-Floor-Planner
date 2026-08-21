import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadCommissionRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramEnterpriseAdmin(context);
    const result = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new LeadCommissionRepository(transaction).listEnterprisePayouts(
        parsePostgresId(context.enterpriseId!, 'enterprise id'),
        context.enterprise?.name || ''
      )
    );
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '读取提成发放台账失败',
    }, { status });
  }
}
