import { NextResponse } from 'next/server';
import { AdminUserRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import {
  buildEnterpriseStaffRosterItem,
  parseEnterpriseStaffRosterRoles,
} from '@/lib/miniprogram-workbench';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    requireMiniProgramEnterpriseAdmin(context);

    const roles = parseEnterpriseStaffRosterRoles(new URL(request.url).searchParams.get('role'));
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const list = await new AdminUserRepository(transaction).list({
        roles,
        status: 'active',
        page: 1,
        limit: 200,
      });
      const items = list.rows.map((row) => buildEnterpriseStaffRosterItem(row));
      return {
        items,
        summary: {
          total: items.length,
          eligibleCount: items.filter((item) => item.assignmentEligible).length,
          designerEligibleCount: items.filter((item) => item.role === 'designer' && item.assignmentEligible).length,
          measurerEligibleCount: items.filter((item) => item.role === 'measurer' && item.assignmentEligible).length,
        },
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
