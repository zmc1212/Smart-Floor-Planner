import { NextResponse } from 'next/server';
import { workflowNotificationToDto, parsePostgresId } from '@/db/postgres-dto';
import { WorkflowNotificationRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import type { PostgresTransaction } from '@/db/transaction';
import { promotionActorFromContext, type PromotionRouteActor } from '@/lib/postgres-promotion-workflow';

export const dynamic = 'force-dynamic';

interface NotificationScope {
  actor: PromotionRouteActor;
  execute<T>(callback: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

async function getScope(request: Request): Promise<NotificationScope | null> {
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
      withAdminPostgresTransaction(b2bContext, callback),
  };
}

export async function GET(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const result = await scope.execute((transaction) =>
      new WorkflowNotificationRepository(transaction).list({
        channel: 'station',
        recipientStaffId: scope.actor.id,
        onlyUnalerted: true,
        status: 'sent',
        limit: 5,
      })
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map(workflowNotificationToDto),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await request.json()) as { ids?: unknown };
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    const ids = body.ids.map((id) => parsePostgresId(id, 'notificationId'));
    const marked = await scope.execute((transaction) =>
      new WorkflowNotificationRepository(transaction).markAlerted(ids, scope.actor.id)
    );
    return NextResponse.json({ success: true, marked });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
