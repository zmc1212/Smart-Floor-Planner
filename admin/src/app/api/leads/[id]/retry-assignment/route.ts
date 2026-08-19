import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { retrySingleLeadAssignment } from '@/lib/lead-assignment-retry';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

const RETRY_ROLES = new Set(['enterprise_admin', 'admin', 'super_admin']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getTenantContext(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!RETRY_ROLES.has(admin.role)) {
      return NextResponse.json({ success: false, error: '仅企业负责人可重试自动派单' }, { status: 403 });
    }
    if (!admin.enterpriseId) {
      return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
    }

    const leadId = parsePostgresId((await params).id, 'lead id');
    const body = await request.json().catch(() => ({}));
    const current = await withAdminPostgresTransaction(admin, (transaction) =>
      new LeadRepository(transaction).findById(leadId)
    );
    if (!current) {
      return NextResponse.json({ success: false, error: '线索不存在或无权操作' }, { status: 404 });
    }

    const result = await retrySingleLeadAssignment({
      leadId,
      reason:
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 160)
          : 'admin_retry',
    });
    if (!result) {
      return NextResponse.json({ success: false, error: '线索不存在' }, { status: 404 });
    }

    const updated = await withAdminPostgresTransaction(admin, (transaction) =>
      new LeadRepository(transaction).findById(leadId)
    );
    return NextResponse.json({
      success: true,
      data: {
        ...(updated ? leadToDto(updated) : {}),
        result: result.kind,
        assignmentStatus: result.lead.assignmentStatus,
        assignmentErrorCode: result.lead.assignmentErrorCode,
        designerId: result.lead.assignedTo?.toString() || null,
        measurerId: result.lead.measurerId?.toString() || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '派单重试失败',
      },
      { status: 400 }
    );
  }
}
