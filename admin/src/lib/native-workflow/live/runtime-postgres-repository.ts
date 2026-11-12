import { sql, type SQL } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { WorkflowOperationError } from '../errors';
import type { RuntimeExecutionFence } from './types';

// Only these module-owned identifiers are ever interpolated into SQL.
export const runtimeTables = {
  run: sql`app.native_workflow_runs`,
  schedule: sql`app.native_workflow_schedule_runs`,
  batch: sql`app.native_workflow_report_batches`,
  control: sql`app.native_workflow_schedule_controls`,
  ledger: sql`app.native_workflow_schedule_ledgers`,
} as const;
export type RuntimeKind = keyof typeof runtimeTables;
type LeasedKind = 'batch' | 'schedule';
export type RuntimeCheckpoint = {
  readonly enterpriseId: string;
  readonly updatedAt: string;
  readonly storeRevision?: number;
};
export interface CheckpointRow<T = RuntimeCheckpoint> {
  readonly id: string;
  readonly revision: number;
  readonly state: T;
}

export function storedState<T extends RuntimeCheckpoint>(record: T): Omit<T, 'storeRevision'> {
  const state = { ...record };
  delete (state as { storeRevision?: number }).storeRevision;
  return state;
}

export function checkpoint<T extends RuntimeCheckpoint>(row: CheckpointRow<T>): T {
  return { ...row.state, storeRevision: row.revision };
}

export async function lockScheduleControl(
  tx: PostgresTransaction, enterpriseId: string, mode: 'shared' | 'exclusive',
): Promise<void> {
  const key = 'native.workflow.schedule.control:' + enterpriseId;
  if (mode === 'shared') await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${key},0))`);
  else await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`);
}

export function assertRuntimeTenant(expected: string, actual: string): void {
  if (actual !== expected) {
    throw new WorkflowOperationError('runtime_store_tenant_mismatch', 403, 'runtime store tenant mismatch');
  }
}

export function readCheckpoint<T>(
  tx: PostgresTransaction, kind: RuntimeKind, enterpriseId: string, id: string, lock = false,
) {
  return one<CheckpointRow<T>>(tx, sql`select id,revision,state from ${runtimeTables[kind]}
    where enterprise_id=${enterpriseId} and id=${id} ${lock ? sql`for update` : sql``}`);
}

export function listCheckpoints<T>(
  tx: PostgresTransaction, kind: RuntimeKind, enterpriseId: string, limit?: number,
) {
  return rows<CheckpointRow<T>>(tx, sql`select id,revision,state from ${runtimeTables[kind]}
    where enterprise_id=${enterpriseId} order by updated_at desc,id
    ${limit === undefined ? sql`` : sql`limit ${limit}`}`);
}

export function insertCheckpoint<T extends RuntimeCheckpoint>(
  tx: PostgresTransaction, kind: RuntimeKind, id: string, record: T, periodStart?: string,
) {
  return one<CheckpointRow<T>>(tx, sql`insert into ${runtimeTables[kind]}
    (enterprise_id,id,state,updated_at ${kind === 'schedule' ? sql`,period_start` : sql``})
    values (${record.enterpriseId},${id},${JSON.stringify(storedState(record))}::jsonb,${record.updatedAt}
      ${kind === 'schedule' ? sql`,${periodStart!}::date` : sql``})
    on conflict do nothing returning id,revision,state`);
}

export function replaceCheckpoint<T extends RuntimeCheckpoint>(
  tx: PostgresTransaction, kind: RuntimeKind, id: string, record: T,
  options: { readonly fence?: RuntimeExecutionFence; readonly revoke?: boolean } = {},
) {
  const leased = kind === 'batch' || kind === 'schedule';
  const constraint = !leased || options.revoke ? sql``
    : options.fence ? sql`and ${leasePredicate(options.fence)}`
      : sql`and (lease_until is null or lease_until <= clock_timestamp())`;
  return one<CheckpointRow<T>>(tx, sql`update ${runtimeTables[kind]}
    set state=${JSON.stringify(storedState(record))}::jsonb,updated_at=${record.updatedAt},revision=revision+1
      ${options.revoke ? sql`,lease_owner=null,lease_token=null,lease_until=null` : sql``}
    where enterprise_id=${record.enterpriseId} and id=${id}
      and revision=${record.storeRevision ?? 0} ${constraint} returning id,revision,state`);
}

function leasePredicate(fence: RuntimeExecutionFence): SQL {
  return sql`lease_owner=${fence.owner} and lease_token=${fence.token} and lease_until>clock_timestamp()`;
}

export async function claimCheckpoint(
  tx: PostgresTransaction, kind: LeasedKind, enterpriseId: string, id: string,
  fence: RuntimeExecutionFence, ttlMs: number,
): Promise<boolean> {
  return Boolean(await one(tx, sql`update ${runtimeTables[kind]}
    set lease_owner=${fence.owner},lease_token=${fence.token},
      lease_until=clock_timestamp()+${ttlMs}::double precision*interval '1 millisecond'
    where enterprise_id=${enterpriseId} and id=${id}
      and (lease_until is null or lease_until <= clock_timestamp())
    returning id`));
}

export async function releaseCheckpoint(
  tx: PostgresTransaction, kind: LeasedKind, enterpriseId: string, id: string, fence: RuntimeExecutionFence,
): Promise<void> {
  await tx.execute(sql`update ${runtimeTables[kind]} set lease_owner=null,lease_token=null,lease_until=null
    where enterprise_id=${enterpriseId} and id=${id}
      and lease_owner=${fence.owner} and lease_token=${fence.token}`);
}

export async function assertCheckpointLease(
  tx: PostgresTransaction, kind: LeasedKind, enterpriseId: string, id: string, fence: RuntimeExecutionFence,
): Promise<void> {
  if (!await one(tx, sql`with held as materialized (
      select id,lease_owner,lease_token,lease_until from ${runtimeTables[kind]}
      where enterprise_id=${enterpriseId} and id=${id} for share
    ) select id from held where ${leasePredicate(fence)}`)) {
    throw new WorkflowOperationError('runtime_store_lease_lost', 409, 'runtime execution lease was lost');
  }
}

export function checkpointConflict(id: string): never {
  throw new WorkflowOperationError('runtime_store_conflict', 409, `checkpoint ${id} changed or lost its execution lease`);
}
