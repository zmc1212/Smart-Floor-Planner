import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import {
  getLeadConversionActions,
  hasLeadConversionEnterpriseContext,
  parseConversionRevertReason,
} from '@/lib/lead-conversion';
import { httpError, httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mini = await resolveMiniProgramContext(request);
    const admin = mini ? null : await getTenantContext(request);
    if (!mini && !admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const role = mini?.staff?.role || admin?.role || '';
    if (role !== 'enterprise_admin') {
      return NextResponse.json(
        { success: false, error: '仅企业管理员可以撤销签约标记' },
        { status: 403 }
      );
    }
    if (!hasLeadConversionEnterpriseContext(mini?.enterpriseId, admin?.enterpriseId)) {
      return NextResponse.json(
        { success: false, error: 'Enterprise context is required' },
        { status: 400 }
      );
    }
    const actorId = parsePostgresId(mini?.staff?._id || admin?.userId, 'actor id');
    const leadId = parsePostgresId((await params).id, 'lead id');
    const reason = parseConversionRevertReason(await request.json());

    const execute = async (transaction: PostgresTransaction) => {
      const repository = new LeadRepository(transaction);
      const current = await repository.findById(leadId);
      if (!current) return null;
      await new LeadLifecycleRepository(transaction).revertConversion({
        leadId,
        actorId,
        reason,
      });
      const updated = await repository.findById(leadId);
      if (!updated) throw httpError('撤销签约标记失败', 409);
      return updated;
    };

    const updated = mini
      ? await withMiniProgramPostgresTransaction(mini, execute)
      : await withAdminPostgresTransaction(admin!, execute);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: '线索不存在或无权操作' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        ...leadToDto(updated),
        conversionActions: getLeadConversionActions(updated, role, actorId),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '撤销签约标记失败',
      },
      { status: httpErrorStatus(error, 400) }
    );
  }
}
