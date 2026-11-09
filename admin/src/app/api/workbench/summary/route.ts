import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId, promotionRecordToDto } from '@/db/postgres-dto';
import { CommercialRepository, PromotionRecordRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withMiniProgramPostgresTransaction,
  withPromotionPostgresTransaction,
} from '@/lib/postgres-request-scope';
import {
  loadWorkbenchTodos,
} from '@/lib/postgres-workflow-automation';

export const dynamic = 'force-dynamic';

interface WorkbenchIdentity {
  role: string;
  userId: string;
  enterpriseId: string | null;
}

interface WorkbenchScope {
  identity: WorkbenchIdentity;
  execute<T>(callback: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

async function getScope(request: Request): Promise<WorkbenchScope | null> {
  const mini = await resolveMiniProgramContext(request);
  if (mini) {
    if (!mini.staff) return null;
    return {
      identity: {
        role: mini.staff.role,
        userId: mini.staff._id,
        enterpriseId: mini.staff.enterpriseId ?? mini.enterpriseId ?? null,
      },
      execute: <T>(callback: (transaction: PostgresTransaction) => Promise<T>) =>
        withMiniProgramPostgresTransaction(mini, callback),
    };
  }
  const context = await getTenantContext(request);
  if (!context) return null;
  const b2bContext = getPlatformB2BTenantContext(context);
  return {
    identity: {
      role: b2bContext.role,
      userId: b2bContext.userId,
      enterpriseId: b2bContext.enterpriseId,
    },
    execute: <T>(callback: (transaction: PostgresTransaction) => Promise<T>) =>
      withPromotionPostgresTransaction(b2bContext, callback),
  };
}

export async function GET(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { identity } = scope;
    const userId = parsePostgresId(identity.userId, 'userId');
    const actor = ['salesperson', 'measurer', 'designer'].includes(identity.role)
      ? { id: userId, role: identity.role }
      : undefined;
    const promoterId = identity.role === 'salesperson' ? userId : undefined;
    const result = await scope.execute(async (transaction) => {
      const promotions = new PromotionRecordRepository(transaction);
      const commercial = new CommercialRepository(transaction);
      const [records, latestRecords, latestCommissions, commissionSummary, todos] =
        await Promise.all([
          promotions.listForTodo({ actor, limit: 200 }),
          promotions.list({ actor, limit: 5 }),
          commercial.listCommissions({ promoterId, page: 1, limit: 5 }),
          commercial.commissionSummary({
            status: 'pending_settlement',
            promoterId,
          }),
          loadWorkbenchTodos(transaction, {
            role: identity.role,
            userId: identity.userId,
            view: 'mine',
          }),
        ]);
      return {
        records,
        latestRecords: latestRecords.rows,
        latestCommissions,
        pendingCommission: commissionSummary.pending_settlement?.amount ?? 0,
        todos,
      };
    });
    const overdueTodos = result.todos.filter((todo) => todo.overdue);

    const pendingAssignments = result.records.filter(
      (item) =>
        item.ownershipStatus === 'conflict_pending' ||
        (item.businessStage === 'measuring' && item.measureTaskStatus === 'unassigned') ||
        (item.measureTaskStatus === 'submitted' && item.designTaskStatus === 'unassigned')
    ).length;
    const pendingCommission = result.pendingCommission;

    let cards: Array<{ key: string; label: string; value: number }>;
    if (identity.role === 'salesperson') {
      cards = [
        { key: 'reported', label: '我的报备', value: result.records.length },
        { key: 'pendingTodo', label: '待跟进事项', value: result.todos.length },
        { key: 'overdueFollowUps', label: '超时跟进', value: overdueTodos.length },
        { key: 'pendingCommission', label: '待结算提成', value: pendingCommission },
      ];
    } else if (identity.role === 'measurer') {
      cards = [
        { key: 'mine', label: '我的任务', value: result.todos.length },
        { key: 'assigned', label: '待接收任务', value: result.records.filter((item) => item.measureTaskStatus === 'assigned').length },
        { key: 'accepted', label: '量房进行中', value: result.records.filter((item) => item.measureTaskStatus === 'accepted').length },
        { key: 'overdueMeasures', label: '超时量房', value: overdueTodos.length },
      ];
    } else if (identity.role === 'designer') {
      cards = [
        { key: 'mine', label: '我的任务', value: result.todos.length },
        { key: 'assigned', label: '待设计任务', value: result.records.filter((item) => item.designTaskStatus === 'assigned').length },
        { key: 'progress', label: '设计进行中', value: result.records.filter((item) => item.designTaskStatus === 'in_progress').length },
        { key: 'overdueDesigns', label: '超时设计', value: overdueTodos.length },
      ];
    } else {
      cards = [
        { key: 'records', label: '企业报备', value: result.records.length },
        { key: 'pendingAssignments', label: '待分配任务', value: pendingAssignments },
        { key: 'overdue', label: '超时任务', value: overdueTodos.length },
        { key: 'pendingCommission', label: '待结算提成', value: pendingCommission },
      ];
    }

    return NextResponse.json({
      success: true,
      data: {
        staffRole: identity.role,
        cards,
        latestRecords: result.latestRecords.map(promotionRecordToDto),
        latestCommissions: result.latestCommissions.map(commissionToDto),
        latestTodos: result.todos.slice(0, 5),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
