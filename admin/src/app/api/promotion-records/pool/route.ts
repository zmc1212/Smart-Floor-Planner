import { NextResponse } from 'next/server';
import { promotionRecordToDto } from '@/db/postgres-dto';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withMiniProgramPostgresTransaction,
  withPromotionPostgresTransaction,
} from '@/lib/postgres-request-scope';
import {
  approveClaimFromPool,
  assignPoolRecordToPromoter,
  claimFromPool,
  listPoolRecords,
  promotionActorFromContext,
  rejectClaimFromPool,
  releaseToPool,
  type PromotionRouteActor,
} from '@/lib/postgres-promotion-workflow';
import { getPlatformPromotionConfig } from '@/lib/platform-promotion-config';
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
  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ success: false, error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope || !['salesperson', 'enterprise_admin', 'admin', 'super_admin'].includes(scope.actor.role)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const manager = ['enterprise_admin', 'admin', 'super_admin'].includes(scope.actor.role);
    const result = await scope.execute((transaction) =>
      listPoolRecords(
        transaction,
        searchParams.get('search'),
        searchParams.get('poolStatus'),
        manager
      )
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map(promotionRecordToDto),
      pagination: { total: result.total },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.recordId) {
      return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
    }
    const action = String(body.action || 'claim');
    const config = await getPlatformPromotionConfig();
    const result = await scope.execute((transaction) => {
      if (action === 'assign') {
        if (!['admin', 'super_admin'].includes(scope.actor.role)) {
          throw new Error('Only managers can assign pool records');
        }
        if (!body.promoterId) throw new Error('Missing promoterId');
        return assignPoolRecordToPromoter(
          transaction,
          body.recordId,
          body.promoterId,
          scope.actor,
          config
        );
      }
      if (action === 'approve_claim') {
        if (!['admin', 'super_admin'].includes(scope.actor.role)) {
          throw new Error('Only managers can approve claim requests');
        }
        return approveClaimFromPool(transaction, body.recordId, scope.actor, config);
      }
      if (action === 'reject_claim') {
        if (!['admin', 'super_admin'].includes(scope.actor.role)) {
          throw new Error('Only managers can reject claim requests');
        }
        return rejectClaimFromPool(transaction, body.recordId, scope.actor, body.reason);
      }
      if (action === 'release') {
        if (!['admin', 'super_admin'].includes(scope.actor.role)) {
          throw new Error('Only managers can release records to pool');
        }
        return releaseToPool(transaction, body.recordId, scope.actor);
      }
      if (scope.actor.role !== 'salesperson') {
        throw new Error('Only salesperson can claim from pool');
      }
      return claimFromPool(transaction, body.recordId, scope.actor.id, config);
    });
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Record not available in claimable pool' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: promotionRecordToDto(result) });
  } catch (error) {
    return errorResponse(error);
  }
}
