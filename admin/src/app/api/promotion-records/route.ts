import { NextResponse } from 'next/server';
import { promotionRecordToDto } from '@/db/postgres-dto';
import { PromotionRecordRepository } from '@/db/repositories';
import { withMiniProgramPostgresTransaction, withPromotionPostgresTransaction } from '@/lib/postgres-request-scope';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  buildPromotionListOptions,
  createPromotionRecord,
  promotionActorFromContext,
} from '@/lib/postgres-promotion-workflow';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  const code = details.code ?? details.cause?.code;
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = code === '23505' ? 409 : message === 'Unauthorized' ? 401 : 400;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mini = await resolveMiniProgramContext(request);
    if (mini) {
      if (!mini.staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }
      const actor = promotionActorFromContext({
        id: mini.staff._id,
        role: mini.staff.role,
        name: mini.staff.displayName || mini.staff.username,
        enterpriseId: mini.staff.enterpriseId ?? mini.enterpriseId,
      });
      const result = await withMiniProgramPostgresTransaction(mini, (transaction) =>
        new PromotionRecordRepository(transaction).list(
          buildPromotionListOptions(searchParams, { id: actor.id, role: actor.role })
        )
      );
      return NextResponse.json({
        success: true,
        data: result.rows.map(promotionRecordToDto),
        pagination: { page: Number(searchParams.get('page') || 1), limit: result.rows.length, total: result.total },
      });
    }

    const context = await getTenantContext(request);
    if (!context) throw new Error('Unauthorized');
    const b2bContext = getPlatformB2BTenantContext(context);
    const actor = promotionActorFromContext({
      id: b2bContext.userId,
      role: b2bContext.role,
      name: b2bContext.username,
      enterpriseId: b2bContext.enterpriseId,
    });
    const result = await withPromotionPostgresTransaction(b2bContext, (transaction) =>
      new PromotionRecordRepository(transaction).list(
        buildPromotionListOptions(searchParams, { id: actor.id, role: actor.role })
      )
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map(promotionRecordToDto),
      pagination: { page: Number(searchParams.get('page') || 1), limit: result.rows.length, total: result.total },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const mini = await resolveMiniProgramContext(request);
    let result: Awaited<ReturnType<typeof createPromotionRecord>>;

    if (mini) {
      if (!mini.staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }
      const actor = promotionActorFromContext({
        id: mini.staff._id,
        role: mini.staff.role,
        name: mini.staff.displayName || mini.staff.username,
        enterpriseId: mini.staff.enterpriseId ?? mini.enterpriseId,
      });
      if (!['salesperson', 'enterprise_admin'].includes(actor.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      result = await withMiniProgramPostgresTransaction(mini, (transaction) =>
        createPromotionRecord(transaction, body, actor)
      );
    } else {
      const context = await getTenantContext(request);
      if (!context) throw new Error('Unauthorized');
      const b2bContext = getPlatformB2BTenantContext(context);
      const actor = promotionActorFromContext({
        id: b2bContext.userId,
        role: b2bContext.role,
        name: b2bContext.username,
        enterpriseId: b2bContext.enterpriseId,
      });
      if (!['salesperson', 'enterprise_admin', 'admin', 'super_admin'].includes(actor.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      result = await withPromotionPostgresTransaction(b2bContext, (transaction) =>
        createPromotionRecord(transaction, body, actor)
      );
    }

    return NextResponse.json(
      { success: true, data: result.record ? promotionRecordToDto(result.record) : null, created: result.created },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
