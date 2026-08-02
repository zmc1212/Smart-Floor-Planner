import { NextResponse } from 'next/server';
import { promotionRecordToDto } from '@/db/postgres-dto';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withMiniProgramPostgresTransaction,
  withPromotionPostgresTransaction,
} from '@/lib/postgres-request-scope';
import {
  findPromotionRecord,
  promotionActorFromContext,
  updatePromotionRecord,
  type PromotionRouteActor,
} from '@/lib/postgres-promotion-workflow';
import { dispatchWorkflowNotifications } from '@/lib/postgres-workflow-automation';
import type { PostgresTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

interface PromotionScope {
  actor: PromotionRouteActor;
  execute<T>(callback: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

async function getScope(request: Request): Promise<PromotionScope | null> {
  const mini = await resolveMiniProgramContext(request);
  if (mini) {
    if (!mini.staff) return null;
    const actor = promotionActorFromContext({
      id: mini.staff._id,
      role: mini.staff.role,
      name: mini.staff.displayName || mini.staff.username,
      enterpriseId: mini.staff.enterpriseId ?? mini.enterpriseId,
    });
    return {
      actor,
      execute: <T>(callback: (transaction: PostgresTransaction) => Promise<T>) =>
        withMiniProgramPostgresTransaction(mini, callback),
    };
  }

  const context = await getTenantContext(request);
  if (!context) return null;
  const b2bContext = getPlatformB2BTenantContext(context);
  const actor = promotionActorFromContext({
    id: b2bContext.userId,
    role: b2bContext.role,
    name: b2bContext.username,
    enterpriseId: b2bContext.enterpriseId,
  });
  return {
    actor,
    execute: <T>(callback: (transaction: PostgresTransaction) => Promise<T>) =>
      withPromotionPostgresTransaction(b2bContext, callback),
  };
}

function errorResponse(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  const code = details.code ?? details.cause?.code;
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = code === '23505' ? 409 : message === 'Unauthorized' ? 401 : 400;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const record = await scope.execute((transaction) =>
      findPromotionRecord(transaction, id, { id: scope.actor.id, role: scope.actor.role })
    );
    if (!record) {
      return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: promotionRecordToDto(record) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await scope.execute((transaction) =>
      updatePromotionRecord(transaction, id, body, scope.actor)
    );
    if (!result) {
      return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
    }
    for (const job of result.notificationJobs) {
      await dispatchWorkflowNotifications({
        record: result.record,
        notificationType: job.notificationType,
        recipientRoles: job.recipientRoles,
        message: job.message,
        dedupeSuffix: job.dedupeSuffix,
      });
    }
    return NextResponse.json({ success: true, data: promotionRecordToDto(result.record) });
  } catch (error) {
    return errorResponse(error);
  }
}
