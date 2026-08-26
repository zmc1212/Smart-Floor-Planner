import { NextResponse } from 'next/server';
import { AdminUserRepository } from '@/db/repositories';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { attachLeadAssignmentActions } from '@/lib/lead-assignment-actions';
import { assignLeadStaff } from '@/lib/lead-assignment-manual';
import {
  resolveLeadAssignmentRequest,
  withLeadAssignmentTransaction,
} from '@/lib/lead-assignment-request';
import { httpErrorStatus } from '@/lib/http-error';

function parseOptionalStaffId(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return parsePostgresId(value, label);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await resolveLeadAssignmentRequest(request);
    if (!actor) {
      return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    }
    if (!actor.actorStaffId) {
      return NextResponse.json({ success: false, error: '无权改派线索人员' }, { status: 403 });
    }

    const leadId = parsePostgresId((await params).id, 'lead id');
    const body = await request.json().catch(() => ({}));
    const designerId = parseOptionalStaffId(body.designerId, 'designerId');
    const measurerId = parseOptionalStaffId(body.measurerId, 'measurerId');
    if (!designerId && !measurerId) {
      return NextResponse.json(
        { success: false, error: '请至少选择一名家装设计顾问或家装现场顾问' },
        { status: 400 }
      );
    }

    let actorUserId = actor.actorUserId;
    if (actor.kind === 'admin') {
      actorUserId = await withLeadAssignmentTransaction(actor, (transaction) =>
        new AdminUserRepository(transaction).findLinkedUserId(actor.actorStaffId!)
      );
    }

    const result = await assignLeadStaff({
      leadId,
      actorStaffId: actor.actorStaffId,
      actorRole: actor.role,
      actorUserId,
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
      data: attachLeadAssignmentActions(
        {
          ...leadToDto(result.lead),
          result: result.kind,
        },
        result.lead,
        actor.role,
        actor.actorStaffId
      ),
    });
  } catch (error) {
    const status = httpErrorStatus(error, 400);
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
