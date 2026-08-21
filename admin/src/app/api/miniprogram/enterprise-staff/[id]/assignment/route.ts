import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { retryPendingLeadAssignmentsForEnterprise } from '@/lib/lead-assignment-retry';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';
import { buildEnterpriseStaffRosterItem } from '@/lib/miniprogram-workbench';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

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

    const { id } = await params;
    const staffId = parsePostgresId(id);
    const body = (await request.json()) as { assignmentPaused?: unknown };
    if (typeof body.assignmentPaused !== 'boolean') {
      return NextResponse.json(
        { success: false, error: '请提供 assignmentPaused 布尔值' },
        { status: 400 }
      );
    }

    const updated = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      const current = await repository.findById(staffId);
      if (!current) return null;
      if (current.role !== 'designer' && current.role !== 'measurer') {
        throw Object.assign(new Error('只能调整设计师或测量员派单状态'), { status: 403 });
      }
      return repository.update(staffId, { assignmentPaused: body.assignmentPaused });
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: '员工不存在' }, { status: 404 });
    }

    if (
      body.assignmentPaused === false
      && updated.enterpriseId
      && updated.status === 'active'
      && !updated.assignmentPaused
      && (updated.role === 'designer' || updated.role === 'measurer')
    ) {
      await retryPendingLeadAssignmentsForEnterprise({
        enterpriseId: updated.enterpriseId,
        reason: 'staff_profile_or_assignment_availability_changed',
      }).catch((error) => {
        console.error('[MiniProgramEnterpriseStaff] assignment retry', error);
      });
    }

    return NextResponse.json({
      success: true,
      data: buildEnterpriseStaffRosterItem(updated),
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      code: (error as { code?: string }).code,
      error: error instanceof Error ? error.message : '更新派单状态失败',
    }, { status });
  }
}
