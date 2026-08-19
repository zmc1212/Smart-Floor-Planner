import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository } from '@/db/repositories';
import { customerProjectIndexToDto } from '@/lib/customer-project';
import { requireMiniProgramPortalMode } from '@/lib/miniprogram-portal-authority';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    requireMiniProgramPortalMode(context, 'customer');
    const projects = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new CustomerProjectRepository(transaction).listCustomerProjects(parsePostgresId(context.user._id, 'customer user id'))
    );
    return NextResponse.json({
      success: true,
      data: projects.map(customerProjectIndexToDto),
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取客户项目索引失败' }, { status });
  }
}
