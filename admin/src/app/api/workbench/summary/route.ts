import { NextResponse } from 'next/server';
import { commissionToDto, parsePostgresId, promotionRecordToDto } from '@/db/postgres-dto';
import { CommercialRepository, PromotionRecordRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import {
  listWorkbenchTodos,
  type WorkbenchTodoItem,
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
      withAdminPostgresTransaction(b2bContext, callback),
  };
}

export async function GET(request: Request) {
  try {
    const scope = await getScope(request);
    if (!scope) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { identity } = scope;
    const actor = ['salesperson', 'measurer', 'designer'].includes(identity.role)
      ? { id: parsePostgresId(identity.userId, 'userId'), role: identity.role }
      : undefined;
    const records = await scope.execute((transaction) =>
      new PromotionRecordRepository(transaction).list({ actor, limit: 200 })
    );
    const [commissions, todos, overdueTodos] = await Promise.all([
      scope.execute((transaction) =>
        new CommercialRepository(transaction).listCommissions({
          promoterId: identity.role === 'salesperson'
            ? parsePostgresId(identity.userId, 'userId')
            : undefined,
        })
      ),
      listWorkbenchTodos({
        role: identity.role,
        userId: identity.userId,
        enterpriseId: identity.enterpriseId,
        view: 'mine',
      }),
      listWorkbenchTodos({
        role: identity.role,
        userId: identity.userId,
        enterpriseId: identity.enterpriseId,
        view: 'overdue',
      }),
    ]);

    const pendingAssignments = records.rows.filter(
      (item) =>
        item.ownershipStatus === 'conflict_pending' ||
        (item.businessStage === 'measuring' && item.measureTaskStatus === 'unassigned') ||
        (item.measureTaskStatus === 'submitted' && item.designTaskStatus === 'unassigned')
    ).length;
    const pendingCommission = commissions
      .filter((item: { status?: string }) => item.status === 'pending_settlement')
      .reduce(
        (sum: number, item: { commissionAmount?: number | string }) =>
          sum + Number(item.commissionAmount || 0),
        0
      );

    let cards: Array<{ key: string; label: string; value: number }>;
    if (identity.role === 'salesperson') {
      cards = [
        { key: 'reported', label: 'My reports', value: records.rows.length },
        { key: 'pendingTodo', label: 'Pending follow-up', value: todos.length },
        { key: 'overdueFollowUps', label: 'Overdue follow-up', value: overdueTodos.length },
        { key: 'pendingCommission', label: 'Pending commission', value: pendingCommission },
      ];
    } else if (identity.role === 'measurer') {
      cards = [
        { key: 'mine', label: 'My tasks', value: todos.length },
        { key: 'assigned', label: 'Awaiting acceptance', value: records.rows.filter((item) => item.measureTaskStatus === 'assigned').length },
        { key: 'accepted', label: 'In progress', value: records.rows.filter((item) => item.measureTaskStatus === 'accepted').length },
        { key: 'overdueMeasures', label: 'Overdue measurement', value: overdueTodos.length },
      ];
    } else if (identity.role === 'designer') {
      cards = [
        { key: 'mine', label: 'My tasks', value: todos.length },
        { key: 'assigned', label: 'Awaiting design', value: records.rows.filter((item) => item.designTaskStatus === 'assigned').length },
        { key: 'progress', label: 'Design in progress', value: records.rows.filter((item) => item.designTaskStatus === 'in_progress').length },
        { key: 'overdueDesigns', label: 'Overdue design', value: overdueTodos.length },
      ];
    } else {
      cards = [
        { key: 'records', label: 'Enterprise reports', value: records.rows.length },
        { key: 'pendingAssignments', label: 'Pending assignment', value: pendingAssignments },
        { key: 'overdue', label: 'Overdue tasks', value: overdueTodos.length },
        { key: 'pendingCommission', label: 'Pending commission', value: pendingCommission },
      ];
    }

    return NextResponse.json({
      success: true,
      data: {
        staffRole: identity.role,
        cards,
        latestRecords: records.rows.slice(0, 5).map(promotionRecordToDto),
        latestCommissions: commissions.slice(0, 5).map(commissionToDto),
        latestTodos: (todos as WorkbenchTodoItem[]).slice(0, 5),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
