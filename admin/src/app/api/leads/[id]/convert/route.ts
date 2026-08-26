import { NextResponse } from 'next/server';
import { leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { LeadLifecycleRepository, LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import {
  getLeadConversionActions,
  hasLeadConversionEnterpriseContext,
  parseLeadConversionInput,
} from '@/lib/lead-conversion';
import { httpError, httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { notifyConvertedLeadParties } from '@/lib/wechat-notification';

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
    if (!['enterprise_admin', 'designer'].includes(role)) {
      return NextResponse.json(
        { success: false, error: '仅企业管理员或负责该客户的家装设计顾问可以标记已签约' },
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
    const body = await request.json();
    const conversion = parseLeadConversionInput(body);

    const execute = async (transaction: PostgresTransaction) => {
      const repository = new LeadRepository(transaction);
      const current = await repository.findById(leadId);
      if (!current) return null;
      if (role === 'designer' && current.assignedTo !== actorId) {
        throw httpError('线索不存在或无权操作', 404);
      }
      await new LeadLifecycleRepository(transaction).convert({
        leadId,
        actorId,
        ...conversion,
      });
      const updated = await repository.findById(leadId);
      if (!updated) throw httpError('签约状态保存失败', 409);
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
    if (updated.enterpriseId) {
      void notifyConvertedLeadParties({
        enterpriseId: updated.enterpriseId,
        leadId: updated.id,
      }).catch((error) => {
        console.error('Converted lead notification dispatch failed:', error);
      });
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
        error: error instanceof Error ? error.message : '标记已签约失败',
      },
      { status: httpErrorStatus(error, 400) }
    );
  }
}
