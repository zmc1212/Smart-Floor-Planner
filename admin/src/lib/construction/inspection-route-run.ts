import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantError, fail, fingerprint } from '@/lib/assistant/contracts';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { createPostgresDurableTaskStore } from '@/lib/native-workflow/live/durable-task-postgres-store';
import { createDurableTaskRuntime, type DurableTaskLeaseRef, type DurableTaskRuntime } from '@/lib/native-workflow/live/durable-task-runtime';
import type { DurableTaskRecord } from '@/lib/native-workflow/live/durable-task-types';
import type { ConstructionActor } from './contracts';
import { inspectionStops } from './inspection';
import {
  executeInspectionRoute, prepareInspectionRoute, tiandituProvider, type DrivingLeg, type DrivingProvider,
} from './inspection-route';

type InspectionRoute = Awaited<ReturnType<typeof executeInspectionRoute>>;
const attemptMs = 60_000;
const store = createPostgresDurableTaskStore();
const contention = (code: string) => code === 'durable_task_conflict' || code === 'durable_task_lease_lost';

function withRouteReceipts(
  runtime: DurableTaskRuntime, lease: DurableTaskLeaseRef, record: DurableTaskRecord, provider: DrivingProvider,
): DrivingProvider {
  const saved = new Map(record.steps.filter(step => step.status === 'succeeded' && step.outputs)
    .map(step => [step.key, step.outputs as unknown as DrivingLeg]));
  let writes = Promise.resolve();
  return {
    async reserve(count) {
      if (saved.size > count) fail('inspection_route_unavailable', 503);
      if (saved.size === count) return;
      if (!(await runtime.heartbeat(lease)).ok) fail('inspection_route_unavailable', 503);
      await provider.reserve(count - saved.size);
    },
    async leg(from, to, signal, key) {
      const previous = saved.get(key);
      if (previous) return previous;
      if (!(await runtime.heartbeat(lease)).ok) fail('inspection_route_unavailable', 503);
      const startedAt = runtime.now().toISOString();
      const leg = await provider.leg(from, to, signal, key);
      const commit = writes.then(async () => {
        await runtime.checkpoint({
          ...lease,
          steps: [{ key, status: 'succeeded', attempts: 1, errorCode: null, startedAt,
            finishedAt: runtime.now().toISOString(), outputs: leg }],
        });
      });
      writes = commit;
      await commit;
      return leg;
    },
  };
}

export async function runInspectionRoute(actor: ConstructionActor, input: unknown, requestKey: string): Promise<InspectionRoute | null> {
  const plan = await prepareInspectionRoute(actor, input);
  const { origin, projectIds, firstId, authorized } = plan;
  const scope = fingerprint(authorized);
  const binding = fingerprint({ origin, projectIds, firstId, scope, unit: process.env.TIANDITU_INSPECTION_DURATION_UNIT ?? null });
  const eid = actor.enterpriseId;
  const dbTime = await withTenantTransaction(eid, tx => one<{ ms: number }>(tx,
    sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as ms`));
  if (!dbTime) fail('inspection_route_unavailable', 503);
  const anchor = performance.now();
  const runtime = createDurableTaskRuntime({
    store,
    now: () => new Date(dbTime.ms + performance.now() - anchor),
  });
  let active: DurableTaskLeaseRef | undefined;
  try {
    const created = await runtime.create({
      enterpriseId: eid, kind: 'construction.inspection.route',
      businessKey: fingerprint({ requestKey, adminId: actor.adminId }),
      delegation: { requestedBy: 'admin:' + actor.adminId, conversationId: null, messageId: null, runId: null },
      recoveryMode: 'retry', retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 1, jitterRatio: 0 },
      timeouts: { taskTimeoutMs: 150_000, attemptTimeoutMs: attemptMs, externalCallTimeoutMs: 5000 },
      data: { binding },
    });
    let record = created.record;
    const taskId = record.taskId;
    if (record.data.binding !== binding) fail('inspection_route_changed', 409);
    if (record.status === 'running') {
      if (record.lease && Date.parse(record.lease.expiresAt) > runtime.now().getTime()) return null;
      const recovery = await runtime.recover(eid, { taskId, statuses: ['running'] });
      if (recovery.errors.some(error => !contention(error.code))) fail('inspection_route_unavailable', 503);
      if (recovery.errors.length) return null;
      const latest = await runtime.get(eid, taskId);
      if (!latest) fail('inspection_route_unavailable', 503);
      record = latest;
    }
    if (record.status === 'succeeded') {
      if (fingerprint(await inspectionStops(actor, projectIds)) !== scope) fail('inspection_route_changed', 409);
      if (!record.data.route) fail('inspection_route_unavailable', 503);
      return record.data.route as unknown as InspectionRoute;
    }
    if (record.status === 'failed' && typeof record.data.errorStatus === 'number' && record.lastError) {
      fail(record.lastError.code, record.data.errorStatus);
    }
    if (record.status === 'failed' || record.status === 'expired' || record.status === 'cancelled') {
      fail('inspection_route_unavailable', 503);
    }
    if (record.status === 'pending') await runtime.enqueue({ enterpriseId: eid, taskId });
    const claim = await runtime.claim({ enterpriseId: eid, taskId, owner: randomUUID(), leaseTtlMs: attemptMs });
    if (!claim) return null;
    const lease = { enterpriseId: eid, taskId, token: claim.lease.token, owner: claim.lease.owner };
    active = lease;
    const route = await executeInspectionRoute(actor, plan,
      async () => withRouteReceipts(runtime, lease, claim.record, await tiandituProvider()));
    const current = await runtime.get(eid, taskId);
    const completed = await runtime.complete({
      ...lease, data: { route },
      steps: current?.steps.map(step => ({ ...step, outputs: null })),
    });
    if (completed.status !== 'succeeded') fail('inspection_route_unavailable', 503);
    return route;
  } catch (error) {
    if (error instanceof WorkflowOperationError && contention(error.code)) return null;
    if (active) {
      const status = error instanceof AssistantError ? error.status : 503;
      const code = error instanceof AssistantError ? error.code : 'inspection_route_unavailable';
      try {
        const current = await runtime.get(eid, active.taskId);
        await runtime.fail({ ...active, errorClass: error instanceof AssistantError && status < 500 ? 'business_rejection' : 'permanent', code, message: code,
          data: { errorStatus: status }, steps: current?.steps.map(step => ({ ...step, outputs: null })) });
      } catch (failure) {
        if (failure instanceof WorkflowOperationError && contention(failure.code)) return null;
        throw failure;
      }
    }
    throw error;
  }
}
