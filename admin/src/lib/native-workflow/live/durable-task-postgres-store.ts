import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { WorkflowOperationError } from '../errors';
import {
  assertEnterpriseId, assertSameCreateScope, assertSameIdentity, assertTaskId, leaseLost,
  type DurableTaskStore,
} from './durable-task-store';
import { isTerminalDurableTaskStatus, type DurableTaskLease, type DurableTaskRecord } from './durable-task-types';
import { assertRuntimeTenant, storedState } from './runtime-postgres-repository';
import type { RuntimeExecutionFence } from './types';

const relation = sql`app.native_workflow_durable_tasks`;
const nonterminal = sql`status in ('pending','queued','running','waiting','retrying')`;
const noLiveLease = sql`(lease_until is null or lease_until <= clock_timestamp())`;
const leaseFields = sql`lease_owner,lease_token,lease_acquired_at,lease_heartbeat_at,lease_until`;
const selection = sql`revision,state,${leaseFields}`;
const clearLease = sql`lease_owner=null,lease_token=null,lease_acquired_at=null,lease_heartbeat_at=null,lease_until=null`;

interface LeaseRow {
  lease_owner: string | null;
  lease_token: string | null;
  lease_acquired_at: Date | string | null;
  lease_heartbeat_at: Date | string | null;
  lease_until: Date | string | null;
}
interface TaskRow extends LeaseRow {
  revision: number;
  state: DurableTaskRecord;
}

function leaseOf(row: LeaseRow | undefined): DurableTaskLease | null {
  if (!row?.lease_token) return null;
  return {
    owner: row.lease_owner!, token: row.lease_token,
    acquiredAt: new Date(row.lease_acquired_at!).toISOString(),
    heartbeatAt: new Date(row.lease_heartbeat_at!).toISOString(),
    expiresAt: new Date(row.lease_until!).toISOString(),
  };
}

function task(row: TaskRow): DurableTaskRecord {
  return { ...row.state, storeRevision: row.revision, lease: leaseOf(row) };
}

function scope(enterpriseId: string, id: string) {
  assertEnterpriseId(enterpriseId);
  assertTaskId(id);
  return sql`enterprise_id=${enterpriseId} and id=${id}`;
}

function owns(fence: RuntimeExecutionFence) {
  return sql`lease_token=${fence.token} and lease_owner=${fence.owner} and lease_until>clock_timestamp()`;
}

function conflict(taskId: string): never {
  throw new WorkflowOperationError('durable_task_conflict', 409, `task ${taskId} changed before commit`);
}

function taskState(record: DurableTaskRecord): string {
  const state = storedState(record);
  delete (state as { lease?: DurableTaskLease | null }).lease;
  return JSON.stringify(state);
}

export async function assertPostgresDurableTaskLease(
  tx: PostgresTransaction, enterpriseId: string, taskId: string, fence: RuntimeExecutionFence,
): Promise<void> {
  if (!await one(tx, sql`with held as materialized (
      select id,lease_owner,lease_token,lease_until from ${relation}
      where ${scope(enterpriseId, taskId)} and ${nonterminal} for share
    ) select id from held where ${owns(fence)}`)) throw leaseLost(taskId);
}

/** Use an existing tenant transaction when staging a new request alongside
 * the delegation event. Other lifecycle calls open their own transactions. */
export function createPostgresDurableTaskStore(
  bound?: { readonly tx: PostgresTransaction; readonly enterpriseId: string },
): DurableTaskStore {
  async function transaction<T>(enterpriseId: string, operation: (tx: PostgresTransaction) => Promise<T>) {
    assertEnterpriseId(enterpriseId);
    if (!bound) return withTenantTransaction(enterpriseId, operation);
    assertRuntimeTenant(bound.enterpriseId, enterpriseId);
    return operation(bound.tx);
  }

  return {
    atomicLeaseUpdates: true,
    create: (record) => transaction(record.enterpriseId, async (tx) => {
      const key = scope(record.enterpriseId, record.taskId);
      const inserted = await one<TaskRow>(tx, sql`insert into ${relation}
        (enterprise_id,id,kind,business_key,status,state,next_attempt_at,deadline_at,updated_at)
        values (${record.enterpriseId},${record.taskId},${record.kind},${record.businessKey},${record.status},
          ${taskState(record)}::jsonb,${record.nextAttemptAt},${record.deadlineAt},${record.updatedAt})
        on conflict do nothing returning ${selection}`);
      if (inserted) return { created: true, record: task(inserted) };
      const existing = await one<TaskRow>(tx, sql`select ${selection} from ${relation} where ${key}`);
      if (!existing) conflict(record.taskId);
      assertSameCreateScope(existing.state, record);
      return { created: false, record: task(existing) };
    }),
    update: (record, options = {}) => transaction(record.enterpriseId, async (tx) => {
      const key = scope(record.enterpriseId, record.taskId);
      const existing = await one<TaskRow>(tx, sql`select ${selection} from ${relation} where ${key} for update`);
      if (!existing) throw new WorkflowOperationError('durable_task_not_found', 404, 'durable task was not found');
      assertSameIdentity(existing.state, record);
      if (isTerminalDurableTaskStatus(existing.state.status) && existing.state.status !== record.status && !options.allowTerminalTransition) {
        throw new WorkflowOperationError('durable_task_terminal', 409, 'durable task is terminal');
      }
      if (existing.revision !== record.storeRevision) conflict(record.taskId);
      const guard = options.fence ? sql`and ${owns(options.fence)}`
        : options.clearLease === 'force' ? sql`` : sql`and ${noLiveLease}`;
      const updated = await one<TaskRow>(tx, sql`update ${relation}
        set status=${record.status},state=${taskState(record)}::jsonb,next_attempt_at=${record.nextAttemptAt},
          deadline_at=${record.deadlineAt},updated_at=${record.updatedAt},revision=revision+1
          ${options.clearLease ? sql`,${clearLease}` : sql``}
        where ${key} and revision=${record.storeRevision} ${guard} returning ${selection}`);
      if (!updated) {
        if (options.fence) throw leaseLost(record.taskId);
        conflict(record.taskId);
      }
      return task(updated);
    }),
    get: (enterpriseId, id) => transaction(enterpriseId, async (tx) => {
      const row = await one<TaskRow>(tx, sql`select ${selection} from ${relation} where ${scope(enterpriseId, id)}`);
      return row ? task(row) : null;
    }),
    list: (query) => transaction(query.enterpriseId, async (tx) => {
      const now = query.readyAt;
      const result = await rows<TaskRow>(tx, sql`select ${selection} from ${relation}
        where enterprise_id=${query.enterpriseId}
        ${query.kind === undefined ? sql`` : sql`and kind=${query.kind}`}
        ${query.statuses === undefined ? sql`` : sql`and status=any(array[${sql.join(query.statuses.map((status) => sql`${status}`), sql`,`)}]::text[])`}
        ${query.manualOnly ? sql`and state->'manual' <> 'null'::jsonb and state#>>'{manual,resolvedAt}' is null` : sql``}
        ${query.tool === undefined ? sql`` : sql`and state#>>'{data,tool}'=${query.tool}`}
        ${now === undefined ? sql`` : sql`and ${noLiveLease} and
          (status='running' or deadline_at<=${now} or next_attempt_at<=${now})`}
        order by updated_at ${now ? sql`asc` : sql`desc`},id
        limit ${Math.max(1, Math.min(query.limit ?? 50, 500))}`);
      return result.map(task);
    }),
    acquireLease: (input) => transaction(input.enterpriseId, async (tx) => {
      const row = await one<LeaseRow>(tx, sql`update ${relation}
        set lease_owner=${input.owner},lease_token=${input.token},lease_acquired_at=clock_timestamp(),
          lease_heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+${input.ttlMs}::double precision*interval '1 millisecond'
        where ${scope(input.enterpriseId, input.taskId)} and ${nonterminal} and ${noLiveLease}
        returning ${leaseFields}`);
      const lease = leaseOf(row);
      return { acquired: Boolean(lease), lease };
    }),
    renewLease: (input) => transaction(input.enterpriseId, async (tx) => {
      const row = await one<LeaseRow>(tx, sql`update ${relation}
        set lease_heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+${input.ttlMs}::double precision*interval '1 millisecond'
        where ${scope(input.enterpriseId, input.taskId)} and ${nonterminal} and ${owns(input)}
        returning ${leaseFields}`);
      const lease = leaseOf(row);
      if (!lease) throw leaseLost(input.taskId);
      return lease;
    }),
    releaseLease: (input) => transaction(input.enterpriseId, async (tx) => {
      await tx.execute(sql`update ${relation} set ${clearLease}
        where ${scope(input.enterpriseId, input.taskId)}
          ${input.force ? sql`and ${noLiveLease}` : sql`and lease_token=${input.token}`}`);
    }),
    readLease: (enterpriseId, id) => transaction(enterpriseId, async (tx) =>
      leaseOf(await one<LeaseRow>(tx, sql`select ${leaseFields} from ${relation} where ${scope(enterpriseId, id)}`))),
  };
}
