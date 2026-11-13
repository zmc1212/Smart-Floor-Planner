import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { WorkflowOperationError } from '../errors';
import { assertSameLiveRunIdentity } from './binding';
import { assertBatchRequestId, assertSameManifestIdentity, type PeriodReportBatchStore } from './period-report-batch-store';
import type { PeriodReportBatchManifest } from './period-report-batch';
import {
  assertPeriodStart, assertRunId, assertRunShape, assertSameRunIdentity, assertSameRunScope,
  controlOf, MAX_CANCELLED_PERIODS, normalizeCancelledPeriods, type PeriodReportScheduleStore,
} from './period-report-schedule-store';
import {
  SCHEDULE_LEDGER_VERSION, type PeriodReportScheduleControl, type PeriodReportScheduleLedger,
  type PeriodReportScheduleRun,
} from './period-report-schedule-types';
import {
  assertCheckpointLease, assertRuntimeTenant, checkpoint, checkpointConflict, claimCheckpoint,
  insertCheckpoint, listCheckpoints, lockScheduleControl, readCheckpoint, releaseCheckpoint, replaceCheckpoint,
} from './runtime-postgres-repository';
import type { LiveRunRecord, LiveRunStore } from './types';

export function createPostgresWorkflowRunStore(enterpriseId: string, bound?: PostgresTransaction): LiveRunStore {
  const transaction = <T>(operation: (tx: PostgresTransaction) => Promise<T>) =>
    bound ? operation(bound) : withTenantTransaction(enterpriseId, operation);
  return {
    create: (record, writeGuard) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, record.enterpriseId);
      await writeGuard?.(tx);
      const id = record.binding.runId;
      const inserted = await insertCheckpoint(tx, 'run', id, record);
      if (inserted) return { created: true, record: checkpoint(inserted) };
      const existing = await readCheckpoint<LiveRunRecord>(tx, 'run', enterpriseId, id);
      if (!existing) checkpointConflict(id);
      assertSameLiveRunIdentity(existing.state, record);
      return { created: false, record: checkpoint(existing) };
    }),
    update: (record, writeGuard) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, record.enterpriseId);
      await writeGuard?.(tx);
      const id = record.binding.runId;
      const existing = await readCheckpoint<LiveRunRecord>(tx, 'run', enterpriseId, id);
      if (!existing) throw new WorkflowOperationError('run_not_found', 404, 'run was not found');
      assertSameLiveRunIdentity(existing.state, record);
      const updated = await replaceCheckpoint(tx, 'run', id, { ...record, createdAt: existing.state.createdAt });
      return updated ? checkpoint(updated) : checkpointConflict(id);
    }),
    get: (id) => transaction(async (tx) => {
      const row = await readCheckpoint<LiveRunRecord>(tx, 'run', enterpriseId, id);
      return row ? checkpoint(row) : null;
    }),
    list: (limit = 20) => transaction(async (tx) =>
      (await listCheckpoints<LiveRunRecord>(tx, 'run', enterpriseId, Math.max(1, Math.min(limit, 100)))).map(checkpoint)),
  };
}

export function createPostgresPeriodReportBatchStore(enterpriseId: string): PeriodReportBatchStore {
  const transaction = <T>(operation: (tx: PostgresTransaction) => Promise<T>) =>
    withTenantTransaction(enterpriseId, operation);
  return {
    create: (manifest) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, manifest.enterpriseId);
      const id = manifest.requestId;
      assertBatchRequestId(id);
      const inserted = await insertCheckpoint(tx, 'batch', id, manifest);
      if (inserted) return { created: true, manifest: checkpoint(inserted) };
      const existing = await readCheckpoint<PeriodReportBatchManifest>(tx, 'batch', enterpriseId, id);
      if (!existing) checkpointConflict(id);
      assertSameManifestIdentity(existing.state, manifest);
      return { created: false, manifest: checkpoint(existing) };
    }),
    update: (manifest, fence, writeGuard) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, manifest.enterpriseId);
      await writeGuard?.(tx);
      const id = manifest.requestId;
      const existing = await readCheckpoint<PeriodReportBatchManifest>(tx, 'batch', enterpriseId, id);
      if (!existing) throw new WorkflowOperationError('period_report_batch_not_found', 404, 'batch was not found');
      assertSameManifestIdentity(existing.state, manifest);
      const updated = await replaceCheckpoint(tx, 'batch', id, {
        ...manifest, createdAt: existing.state.createdAt,
      }, { fence });
      return updated ? checkpoint(updated) : checkpointConflict(id);
    }),
    get: (id) => transaction(async (tx) => {
      assertBatchRequestId(id);
      const row = await readCheckpoint<PeriodReportBatchManifest>(tx, 'batch', enterpriseId, id);
      return row ? checkpoint(row) : null;
    }),
    acquire: (id, { owner, token = owner, ttlMs }) => transaction((tx) =>
      claimCheckpoint(tx, 'batch', enterpriseId, id, { owner, token }, ttlMs)),
    release: (id, owner, token = owner) => transaction((tx) =>
      releaseCheckpoint(tx, 'batch', enterpriseId, id, { owner, token })),
    assertLease: (tx, id, fence) => assertCheckpointLease(tx, 'batch', enterpriseId, id, fence),
  };
}

/** Serializes control changes with the short business transactions they gate.
 * A tenant with no control row yet has the same lock as a paused tenant. */
export async function readPostgresScheduleControl(
  tx: PostgresTransaction, enterpriseId: string, lock: 'exclusive' | 'shared' | false = false,
): Promise<PeriodReportScheduleControl> {
  if (lock) await lockScheduleControl(tx, enterpriseId, lock);
  const row = await readCheckpoint<PeriodReportScheduleControl>(tx, 'control', enterpriseId, enterpriseId);
  return controlOf(enterpriseId, row ? checkpoint(row) : null);
}

export function createPostgresPeriodReportScheduleStore(enterpriseId: string): PeriodReportScheduleStore {
  const transaction = <T>(operation: (tx: PostgresTransaction) => Promise<T>) =>
    withTenantTransaction(enterpriseId, operation);

  async function updateControl(
    tenant: string, patch: (previous: PeriodReportScheduleControl) => PeriodReportScheduleControl,
  ) {
    assertRuntimeTenant(enterpriseId, tenant);
    return transaction(async (tx) => {
      const previous = await readPostgresScheduleControl(tx, enterpriseId, 'exclusive');
      const next = patch(previous);
      const updated = previous.storeRevision
        ? await replaceCheckpoint(tx, 'control', enterpriseId, next)
        : await insertCheckpoint(tx, 'control', enterpriseId, next);
      return updated ? checkpoint(updated) : checkpointConflict(enterpriseId);
    });
  }

  return {
    create: (run) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, run.enterpriseId);
      assertRunShape(run);
      assertRunId(run.runId);
      const inserted = await insertCheckpoint(tx, 'schedule', run.runId, run, run.period.periodStart);
      if (inserted) return { created: true, run: checkpoint(inserted) };
      const existing = await readCheckpoint<PeriodReportScheduleRun>(tx, 'schedule', enterpriseId, run.runId);
      if (!existing) checkpointConflict(run.runId);
      assertSameRunScope(existing.state, run);
      return { created: false, run: checkpoint(existing) };
    }),
    update: (run, fence) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, run.enterpriseId);
      assertRunShape(run);
      const existing = await readCheckpoint<PeriodReportScheduleRun>(tx, 'schedule', enterpriseId, run.runId);
      if (!existing) throw new WorkflowOperationError('period_report_schedule_not_found', 404, 'schedule run was not found');
      assertSameRunIdentity(existing.state, run);
      // Cancellation is the only control action that may revoke a live lease.
      // It must reflect a committed cancellation for this exact business week.
      const cancellation = !fence && run.status === 'cancelled';
      const revoke = cancellation && (await readPostgresScheduleControl(tx, enterpriseId, 'shared'))
        .cancelledPeriods.includes(run.period.periodStart);
      if (cancellation && !revoke) checkpointConflict(run.runId);
      const updated = await replaceCheckpoint(tx, 'schedule', run.runId, {
        ...run, startedAt: existing.state.startedAt,
      }, { fence, revoke });
      return updated ? checkpoint(updated) : checkpointConflict(run.runId);
    }),
    get: (id) => transaction(async (tx) => {
      assertRunId(id);
      const row = await readCheckpoint<PeriodReportScheduleRun>(tx, 'schedule', enterpriseId, id);
      return row ? checkpoint(row) : null;
    }),
    list: ({ enterpriseId: tenant = enterpriseId, limit = 20 } = {}) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, tenant);
      return (await listCheckpoints<PeriodReportScheduleRun>(
        tx, 'schedule', enterpriseId, Math.max(1, Math.min(limit, 100)),
      )).map(checkpoint);
    }),
    acquire: (id, { owner, token = owner, ttlMs }) => transaction((tx) =>
      claimCheckpoint(tx, 'schedule', enterpriseId, id, { owner, token }, ttlMs)),
    release: (id, owner, token = owner) => transaction((tx) =>
      releaseCheckpoint(tx, 'schedule', enterpriseId, id, { owner, token })),
    async assertLease(tx, id, fence) {
      const control = await readPostgresScheduleControl(tx, enterpriseId, 'shared');
      const row = await one<{ period: string }>(tx, sql`select to_char(period_start,'YYYY-MM-DD') as period
        from app.native_workflow_schedule_runs where enterprise_id=${enterpriseId} and id=${id}`);
      if (!row || control.paused || control.cancelledPeriods.includes(row.period)) {
        throw new WorkflowOperationError('period_report_schedule_not_active', 409, 'schedule dispatch is paused or cancelled');
      }
      await assertCheckpointLease(tx, 'schedule', enterpriseId, id, fence);
    },
    control: (tenant) => transaction((tx) => {
      assertRuntimeTenant(enterpriseId, tenant);
      return readPostgresScheduleControl(tx, enterpriseId);
    }),
    setControl: (tenant, input) => updateControl(tenant, (previous) => ({
      ...previous,
      paused: input.paused,
      cancelledPeriods: input.cancelledPeriods === undefined
        ? previous.cancelledPeriods : normalizeCancelledPeriods(input.cancelledPeriods),
      updatedAt: input.now().toISOString(),
      updatedBy: input.updatedBy,
      reason: input.reason,
    })),
    cancelPeriod: async (tenant, periodStart, input) => {
      assertPeriodStart(periodStart);
      return updateControl(tenant, (previous) => {
        const periods = new Set(previous.cancelledPeriods);
        if (input.cancelled) periods.add(periodStart);
        else periods.delete(periodStart);
        return {
          ...previous,
          cancelledPeriods: [...periods].sort().slice(-MAX_CANCELLED_PERIODS),
          updatedAt: input.now().toISOString(),
          updatedBy: input.updatedBy,
          reason: input.reason,
        };
      });
    },
    ledger: (tenant, projectId) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, tenant);
      const row = await readCheckpoint<PeriodReportScheduleLedger>(tx, 'ledger', enterpriseId, projectId);
      return row ? checkpoint(row) : {
        ledgerVersion: SCHEDULE_LEDGER_VERSION, enterpriseId, projectId,
        items: [], updatedAt: new Date(0).toISOString(), storeRevision: 0,
      };
    }),
    saveLedger: (ledger, execution) => transaction(async (tx) => {
      assertRuntimeTenant(enterpriseId, ledger.enterpriseId);
      if (ledger.ledgerVersion !== SCHEDULE_LEDGER_VERSION) {
        throw new WorkflowOperationError('period_report_schedule_ledger_invalid', 422, 'schedule ledger version is unsupported');
      }
      if (execution) await assertCheckpointLease(tx, 'schedule', enterpriseId, execution.runId, execution.fence);
      const updated = ledger.storeRevision === 0
        ? await insertCheckpoint(tx, 'ledger', ledger.projectId, ledger)
        : await replaceCheckpoint(tx, 'ledger', ledger.projectId, ledger);
      return updated ? checkpoint(updated) : checkpointConflict(ledger.projectId);
    }),
  };
}
