import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { assignLeadStaff } from '@/lib/lead-assignment-manual';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { requireMiniProgramEnterpriseAdmin } from '@/lib/miniprogram-portal-authority';

function parseOptionalStaffId(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return parsePostgresId(value, label);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mini = await resolveMiniProgramContext(request);
    if (!mini) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    requireMiniProgramEnterpriseAdmin(mini);

    const leadId = parsePostgresId((await params).id, 'lead id');
    const body = await request.json().catch(() => ({}));
    const designerId = parseOptionalStaffId(body.designerId, 'designerId');
    const measurerId = parseOptionalStaffId(body.measurerId, 'measurerId');
    if (!designerId && !measurerId) {
      return NextResponse.json(
        { success: false, error: '请至少选择一名设计师或测量员' },
        { status: 400 }
      );
    }

    const result = await assignLeadStaff({
      leadId,
      actorStaffId: mini.staff?._id ? parsePostgresId(mini.staff._id, 'actor staff id') : null,
      designerId,
      measurerId,
    });
    if (!result) {
      return NextResponse.json(
        { success: false, error: '线索不存在或无权操作' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...leadToDto(result.lead),
        result: result.kind,
        assignmentStatus: result.lead.assignmentStatus,
        assignmentErrorCode: result.lead.assignmentErrorCode,
        designerId: result.lead.assignedTo?.toString() || null,
        measurerId: result.lead.measurerId?.toString() || null,
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '手动派单失败',
      },
      { status }
    );
  }
}
