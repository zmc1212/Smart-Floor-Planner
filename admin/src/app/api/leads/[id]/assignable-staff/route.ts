import { NextResponse } from 'next/server';
import { LeadRepository, ReferralLeadRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { getLeadAssignmentActions } from '@/lib/lead-assignment-actions';
import {
  canAccessAssignedLead,
  resolveLeadAssignmentRequest,
  withLeadAssignmentTransaction,
} from '@/lib/lead-assignment-request';
import { buildEnterpriseStaffRosterItem } from '@/lib/miniprogram-workbench';
import { httpErrorStatus } from '@/lib/http-error';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    if (!actor.actorStaffId) {
      return NextResponse.json({ success: false, error: '无权读取可派人员' }, { status: 403 });
    }

    const url = new URL(request.url);
    const roleParam = url.searchParams.get('role');
    if (roleParam !== 'designer' && roleParam !== 'measurer') {
      return NextResponse.json(
        { success: false, error: 'role 仅支持 designer 或 measurer' },
        { status: 400 }
      );
    }
    const { page, limit } = getPaginationParams(url);

    const leadId = parsePostgresId((await params).id, 'lead id');
    const data = await withLeadAssignmentTransaction(actor, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canAccessAssignedLead(lead, actor)) return { kind: 'not_found' as const };
      const actions = getLeadAssignmentActions(lead, actor.role, actor.actorStaffId);
      if (
        (roleParam === 'designer' && !actions.canAssignDesigner)
        || (roleParam === 'measurer' && !actions.canAssignMeasurer)
      ) {
        return { kind: 'forbidden' as const };
      }
      if (!lead.enterpriseId) return { kind: 'not_found' as const };
      const excludeStaffId = roleParam === 'designer' ? lead.assignedTo : lead.measurerId;
      const listed = await new ReferralLeadRepository(transaction).listAssignableStaff({
        enterpriseId: lead.enterpriseId,
        role: roleParam,
        excludeStaffId,
        page,
        limit,
      });
      return {
        kind: 'ok' as const,
        items: listed.rows.map((row) => buildEnterpriseStaffRosterItem(row)),
        pagination: createPaginationMetadata(listed.total, page, limit),
      };
    });

    if (data.kind === 'not_found') {
      return NextResponse.json(
        { success: false, error: '线索不存在或无权操作' },
        { status: 404 }
      );
    }
    if (data.kind === 'forbidden') {
      return NextResponse.json(
        { success: false, error: roleParam === 'designer' ? '无权更换家装设计顾问' : '无权分配或更换家装现场顾问' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { items: data.items, pagination: data.pagination },
    });
  } catch (error) {
    const status = httpErrorStatus(error, 400);
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '读取可派人员失败',
      },
      { status }
    );
  }
}
