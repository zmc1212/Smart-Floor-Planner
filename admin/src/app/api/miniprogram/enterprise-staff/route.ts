import { NextResponse } from 'next/server';
import { AdminUserRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import {
  buildEnterpriseStaffRosterItem,
  parseEnterpriseStaffRosterRoles,
} from '@/lib/miniprogram-workbench';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    requireMiniProgramEnterpriseAdmin(context);

    const url = new URL(request.url);
    const roles = parseEnterpriseStaffRosterRoles(url.searchParams.get('role'));
    const { page, limit } = getPaginationParams(url);
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const users = new AdminUserRepository(transaction);
      const filters = {
        roles,
        status: 'active' as const,
      };
      const [list, summary] = await Promise.all([
        users.list({ ...filters, page, limit }),
        users.summarizeAssignmentRoster(filters),
      ]);
      const items = list.rows.map((row) => buildEnterpriseStaffRosterItem(row));
      return {
        items,
        summary,
        pagination: createPaginationMetadata(summary.total, page, limit),
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '读取人员名册失败',
    }, { status });
  }
}
