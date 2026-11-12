import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import { createFileDurableTaskStore, type DurableTaskStore } from '../live/durable-task-store';
import {
  createDurableTaskRuntime,
  durableTaskId,
  type CreateDurableTaskInput,
  type DurableTaskRuntime,
} from '../live/durable-task-runtime';
import { durableTaskTracePayload } from '../live/durable-task-observability';
import type { DurableTaskRecord, DurableTaskStep } from '../live/durable-task-types';

const ENTERPRISE_A = '1454';
const ENTERPRISE_B = '1455';
const PROJECT_ID = '1454000004';
const OTHER_PROJECT_ID = '1455000001';

function fakeClock(startIso = '2026-11-12T02:00:00.000Z') {
  let current = Date.parse(startIso);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

type Clock = ReturnType<typeof fakeClock>;

function runtimeFor(store: DurableTaskStore, clock: Clock): DurableTaskRuntime {
  return createDurableTaskRuntime({ store, now: clock.now, random: () => 0.5 });
}

function taskInput(overrides: Partial<CreateDurableTaskInput> = {}): CreateDurableTaskInput {
  return {
    enterpriseId: ENTERPRISE_A,
    projectId: PROJECT_ID,
    kind: 'test.task',
    businessKey: 'event-1',
    delegation: {
      requestedBy: 'admin-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      runId: 'run-1',
    },
    recoveryMode: 'retry',
    timeouts: {
      taskTimeoutMs: 600_000,
      attemptTimeoutMs: 60_000,
      externalCallTimeoutMs: 10_000,
    },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      jitterRatio: 0,
      stormWindowMs: 60_000,
      stormLimit: 50,
    },
    ...overrides,
  };
}

function taskFile(rootDir: string, enterpriseId: string, taskId: string): string {
  return path.join(rootDir, 'tenants', enterpriseId, 'tasks', `${taskId}.json`);
}

async function createTask(
  runtime: DurableTaskRuntime,
  overrides: Partial<CreateDurableTaskInput> = {},
): Promise<DurableTaskRecord> {
  const created = await runtime.create(taskInput(overrides));
  return runtime.enqueue({ enterpriseId: created.record.enterpriseId, taskId: created.record.taskId });
}

function stepFixture(key: string): DurableTaskStep {
  return {
    key,
    status: 'succeeded',
    attempts: 1,
    startedAt: '2026-11-12T02:00:00.000Z',
    finishedAt: '2026-11-12T02:00:01.000Z',
    errorCode: null,
    outputs: null,
  };
}

test('a task created before a restart is recovered from disk and claimed by the new process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const first = runtimeFor(store, clock);
    const record = await createTask(first);
    assert.equal(record.status, 'queued');

    const claimed = await first.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 30_000 });
    assert.ok(claimed);
    assert.equal(claimed.record.status, 'running');
    assert.equal(claimed.record.attempts.length, 1);
    assert.equal(claimed.record.attempts[0]?.outcome, 'running');

    // No complete and no release: the process is gone.
    clock.advance(30_001);
    const second = runtimeFor(store, clock);
    const recovery = await second.recover(ENTERPRISE_A);
    assert.equal(recovery.reclaimed, 1);
    const recovered = await second.get(ENTERPRISE_A, record.taskId);
    assert.equal(recovered?.status, 'retrying');
    assert.equal(recovered?.attempts[0]?.outcome, 'timed_out');

    clock.advance(1_000);
    const reclaimed = await second.claim({
      enterpriseId: ENTERPRISE_A,
      owner: 'worker-b',
      taskId: record.taskId,
      leaseTtlMs: 30_000,
    });
    assert.ok(reclaimed);
    assert.equal(reclaimed.record.attempts.length, 2);
    await second.complete({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-b',
      token: reclaimed.lease.token,
      data: { result: { done: true } },
      steps: [stepFixture('finish')],
    });

    const stored = await second.get(ENTERPRISE_A, record.taskId);
    assert.equal(stored?.status, 'succeeded');
    assert.equal(stored?.delegation.conversationId, 'conv-1');
    assert.equal(stored?.attempts.length, 2);
    const raw = JSON.parse(await readFile(taskFile(root, ENTERPRISE_A, record.taskId), 'utf8'));
    assert.equal(raw.record.status, 'succeeded');
    assert.equal(raw.record.attempts.length, 2);
    assert.equal(raw.record.lease, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a crashed worker is reclaimed only after its lease TTL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const first = runtimeFor(store, clock);
    const record = await createTask(first);
    const claimed = await first.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 30_000 });
    assert.ok(claimed);

    clock.advance(10_000);
    const second = runtimeFor(store, clock);
    const early = await second.recover(ENTERPRISE_A);
    assert.equal(early.reclaimed, 0);
    const blocked = await second.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId });
    assert.equal(blocked, null);

    clock.advance(20_001);
    const late = await second.recover(ENTERPRISE_A);
    assert.equal(late.reclaimed, 1);
    const reclaimed = await second.get(ENTERPRISE_A, record.taskId);
    assert.equal(reclaimed?.status, 'retrying');
    assert.equal(reclaimed?.lease, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the previous worker cannot commit after its lease has been reclaimed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const first = runtimeFor(store, clock);
    const record = await createTask(first);
    const claimedA = await first.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 30_000 });
    assert.ok(claimedA);

    clock.advance(30_001);
    const second = runtimeFor(store, clock);
    await second.recover(ENTERPRISE_A);
    clock.advance(1_000);
    const claimedB = await second.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId });
    assert.ok(claimedB);

    await assert.rejects(
      () => second.complete({
        enterpriseId: ENTERPRISE_A,
        taskId: record.taskId,
        owner: 'worker-a',
        token: claimedA.lease.token,
        data: { result: { stale: true } },
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'durable_task_lease_lost',
    );
    const unchanged = await second.get(ENTERPRISE_A, record.taskId);
    assert.equal(unchanged?.status, 'running');
    assert.equal(unchanged?.data.result, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('heartbeat enforces the attempt timeout and releases the worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, {
      timeouts: { taskTimeoutMs: 120_000, attemptTimeoutMs: 1_000, externalCallTimeoutMs: 500 },
    });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 60_000 });
    assert.ok(claimed);

    clock.advance(1_500);
    const beat = await runtime.heartbeat({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
    });
    assert.equal(beat.ok, false);
    assert.equal(beat.ok ? null : beat.reason, 'attempt_timeout');
    const after = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(after?.status, 'retrying');
    assert.equal(after?.attempts[0]?.outcome, 'timed_out');
    assert.equal(await store.readLease(ENTERPRISE_A, record.taskId), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the whole-task deadline expires a task and keeps it terminal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, {
      timeouts: { taskTimeoutMs: 1_000, attemptTimeoutMs: 1_000, externalCallTimeoutMs: 500 },
    });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 60_000 });
    assert.ok(claimed);

    clock.advance(1_500);
    const beat = await runtime.heartbeat({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
    });
    assert.equal(beat.ok, false);
    assert.equal(beat.ok ? null : beat.reason, 'task_timeout');
    const expired = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(expired?.status, 'expired');
    assert.equal(await store.readLease(ENTERPRISE_A, record.taskId), null);
    assert.equal(await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId }), null);
    const again = await runtime.recover(ENTERPRISE_A);
    assert.equal(again.expired, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transient failures retry with exponential backoff and stop at the attempt limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, {
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        jitterRatio: 0,
        stormWindowMs: 60_000,
        stormLimit: 50,
      },
    });
    const first = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a' });
    assert.ok(first);
    const retrying = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: first.lease.token,
      errorClass: 'transient',
      code: 'db_timeout',
      message: 'database timed out',
    });
    assert.equal(retrying.status, 'retrying');
    assert.equal(retrying.nextAttemptAt, '2026-11-12T02:00:01.000Z');
    assert.equal(retrying.attempts[0]?.errorClass, 'transient');
    assert.equal(await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId }), null);

    clock.advance(1_000);
    const second = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId });
    assert.ok(second);
    const failed = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-b',
      token: second.lease.token,
      errorClass: 'transient',
      code: 'db_timeout',
      message: 'database timed out again',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.manual?.reason, 'retry_exhausted');
    assert.equal(failed.attempts.length, 2);
    assert.equal(await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-c', taskId: record.taskId }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('permanent errors and business rejections are not retried', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const permanent = await createTask(runtime, { businessKey: 'permanent-1' });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: permanent.taskId });
    assert.ok(claimed);
    const failed = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: permanent.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
      errorClass: 'permanent',
      code: 'invalid_definition',
      message: 'definition can never run',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.manual?.reason, 'permanent_failure');
    assert.equal(failed.attempts.length, 1);

    const rejected = await createTask(runtime, { businessKey: 'rejected-1' });
    const rejectedClaim = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: rejected.taskId });
    assert.ok(rejectedClaim);
    const rejectedResult = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: rejected.taskId,
      owner: 'worker-a',
      token: rejectedClaim.lease.token,
      errorClass: 'business_rejection',
      code: 'project_revoked',
      message: 'the receiver lost project access',
    });
    assert.equal(rejectedResult.status, 'failed');
    assert.equal(rejectedResult.manual, null);
    assert.equal(rejectedResult.attempts.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the retry storm guard is per tenant and sends the task to the manual queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const retry = {
      maxAttempts: 5,
      baseDelayMs: 0,
      maxDelayMs: 1_000,
      jitterRatio: 0,
      stormWindowMs: 60_000,
      stormLimit: 2,
    };
    const taskA = await createTask(runtime, { businessKey: 'storm-a', retry });
    const firstA = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: taskA.taskId });
    assert.ok(firstA);
    await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: taskA.taskId,
      owner: 'worker-a',
      token: firstA.lease.token,
      errorClass: 'transient',
      code: 'flaky',
      message: 'flaky dependency',
    });
    const secondA = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: taskA.taskId });
    assert.ok(secondA);
    const stormed = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: taskA.taskId,
      owner: 'worker-a',
      token: secondA.lease.token,
      errorClass: 'transient',
      code: 'flaky',
      message: 'flaky dependency',
    });
    assert.equal(stormed.status, 'failed');
    assert.equal(stormed.manual?.reason, 'retry_storm');
    assert.equal(stormed.lastError?.code, 'retry_storm');

    const taskB = await createTask(runtime, {
      enterpriseId: ENTERPRISE_B,
      projectId: OTHER_PROJECT_ID,
      businessKey: 'storm-b',
      retry,
    });
    const firstB = await runtime.claim({ enterpriseId: ENTERPRISE_B, owner: 'worker-b', taskId: taskB.taskId });
    assert.ok(firstB);
    const isolated = await runtime.fail({
      enterpriseId: ENTERPRISE_B,
      taskId: taskB.taskId,
      owner: 'worker-b',
      token: firstB.lease.token,
      errorClass: 'transient',
      code: 'flaky',
      message: 'flaky dependency',
    });
    assert.equal(isolated.status, 'retrying');
    assert.equal(isolated.manual, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a terminal task is never re-executed by an ordinary retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, { businessKey: 'terminal-1' });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: record.taskId });
    assert.ok(claimed);
    await runtime.complete({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
      data: { result: { ok: true } },
    });
    const before = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(before?.status, 'succeeded');
    const attemptCount = before?.attempts.length;

    await runtime.enqueue({ enterpriseId: ENTERPRISE_A, taskId: record.taskId });
    const afterEnqueue = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(afterEnqueue?.status, 'succeeded');
    assert.equal(afterEnqueue?.attempts.length, attemptCount);
    assert.equal(await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId }), null);
    const recovery = await runtime.recover(ENTERPRISE_A);
    assert.equal(recovery.reclaimed, 0);
    await assert.rejects(
      () => runtime.resolveManual({
        enterpriseId: ENTERPRISE_A,
        taskId: record.taskId,
        resolution: 'retry',
        resolvedBy: 'admin-1',
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'durable_task_manual_missing',
    );
    const final = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(final?.attempts.length, attemptCount);
    assert.ok(final);
    await assert.rejects(
      () => store.update({ ...final, status: 'queued', updatedAt: '2026-11-12T09:00:00.000Z' }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'durable_task_terminal',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation is terminal and a stale completion cannot revive the task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, { businessKey: 'cancel-1' });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', leaseTtlMs: 60_000 });
    assert.ok(claimed);

    const cancelled = await runtime.cancel({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      reason: 'the tenant cancelled the report',
      by: 'admin-1',
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelReason, 'the tenant cancelled the report');
    assert.equal(cancelled.attempts[0]?.outcome, 'cancelled');
    assert.equal(await store.readLease(ENTERPRISE_A, record.taskId), null);
    await assert.rejects(
      () => runtime.complete({
        enterpriseId: ENTERPRISE_A,
        taskId: record.taskId,
        owner: 'worker-a',
        token: claimed.lease.token,
        data: { result: { late: true } },
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'durable_task_lease_lost',
    );
    const repeated = await runtime.cancel({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      reason: 'again',
      by: 'admin-1',
    });
    assert.equal(repeated.status, 'cancelled');
    assert.equal(repeated.data.result, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compensation requires authorization and records execution failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, { businessKey: 'compensation-1' });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: record.taskId });
    assert.ok(claimed);
    await runtime.checkpoint({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
      steps: [stepFixture('save'), stepFixture('deliver')],
    });
    const failed = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
      errorClass: 'permanent',
      code: 'report_rejected',
      message: 'report composition rejected',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.steps.length, 2);
    assert.equal(failed.steps.every((item) => item.status === 'succeeded'), true);

    const planned = await runtime.planCompensation({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      by: 'admin-1',
      entries: [
        { stepKey: 'save', action: 'undo-save', effect: 'reversible', evidence: { reportId: '9' } },
        { stepKey: 'deliver', action: 'revoke-delivery', effect: 'requires_authorization', evidence: { messageId: '124' } },
      ],
    });
    assert.equal(planned.compensations.length, 2);
    const reversible = planned.compensations.find((item) => item.action === 'undo-save');
    const guarded = planned.compensations.find((item) => item.action === 'revoke-delivery');
    assert.ok(guarded);
    assert.equal(reversible?.status, 'ready');
    assert.equal(guarded.status, 'pending_authorization');

    const calls: string[] = [];
    const firstRun = await runtime.executeCompensations({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      execute: async ({ compensation }) => {
        calls.push(compensation.action);
        if (compensation.action === 'revoke-delivery') throw new Error('delivery provider rejected the revoke');
      },
    });
    assert.deepEqual(calls, ['undo-save']);
    assert.equal(firstRun.executed, 1);
    assert.equal(firstRun.skipped, 1);
    assert.equal(firstRun.record.compensations.find((item) => item.action === 'revoke-delivery')?.status, 'pending_authorization');

    const authorized = await runtime.authorizeCompensation({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      compensationId: guarded.compensationId,
      grantedBy: 'owner-1',
      reason: 'the customer already received the report',
    });
    const authorizedEntry = authorized.compensations.find((item) => item.action === 'revoke-delivery');
    assert.equal(authorizedEntry?.status, 'ready');
    assert.equal(authorizedEntry?.authorization?.grantedBy, 'owner-1');

    calls.length = 0;
    const secondRun = await runtime.executeCompensations({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      execute: async ({ compensation }) => {
        calls.push(compensation.action);
        throw new Error('delivery provider rejected the revoke');
      },
    });
    assert.deepEqual(calls, ['revoke-delivery']);
    assert.equal(secondRun.failed, 1);
    assert.equal(secondRun.record.manual?.reason, 'compensation_failed');
    assert.equal(secondRun.record.compensations.find((item) => item.action === 'revoke-delivery')?.status, 'failed');
    assert.equal(secondRun.record.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('one tenant failure never blocks another tenant recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const taskA = await createTask(runtime, { businessKey: 'tenant-a' });
    const taskB = await createTask(runtime, {
      enterpriseId: ENTERPRISE_B,
      projectId: OTHER_PROJECT_ID,
      businessKey: 'tenant-b',
    });
    const claimA = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: taskA.taskId, leaseTtlMs: 10_000 });
    const claimB = await runtime.claim({ enterpriseId: ENTERPRISE_B, owner: 'worker-b', taskId: taskB.taskId, leaseTtlMs: 10_000 });
    assert.ok(claimA);
    assert.ok(claimB);

    assert.equal(await runtime.get(ENTERPRISE_B, taskA.taskId), null);
    assert.equal(await runtime.get(ENTERPRISE_A, taskB.taskId), null);

    // Concurrent workers on two tenants claim only their own tenant's task.
    const concurrentA = await createTask(runtime, { businessKey: 'tenant-a-concurrent' });
    const concurrentB = await createTask(runtime, {
      enterpriseId: ENTERPRISE_B,
      projectId: OTHER_PROJECT_ID,
      businessKey: 'tenant-b-concurrent',
    });
    const [claimConcurrentA, claimConcurrentB] = await Promise.all([
      runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: concurrentA.taskId }),
      runtime.claim({ enterpriseId: ENTERPRISE_B, owner: 'worker-b', taskId: concurrentB.taskId }),
    ]);
    assert.equal(claimConcurrentA?.record.enterpriseId, ENTERPRISE_A);
    assert.equal(claimConcurrentB?.record.enterpriseId, ENTERPRISE_B);
    assert.notEqual(claimConcurrentA?.record.taskId, claimConcurrentB?.record.taskId);

    await writeFile(taskFile(root, ENTERPRISE_A, taskA.taskId), '{not json', 'utf8');
    clock.advance(10_001);
    const summaries = await runtime.recoverAll([ENTERPRISE_A, ENTERPRISE_B]);
    const summaryA = summaries.find((item) => item.enterpriseId === ENTERPRISE_A);
    const summaryB = summaries.find((item) => item.enterpriseId === ENTERPRISE_B);
    assert.equal(summaryA?.errors.length, 1);
    assert.equal(summaryB?.reclaimed, 1);
    assert.equal(summaryB?.errors.length, 0);
    const storedB = await runtime.get(ENTERPRISE_B, taskB.taskId);
    assert.equal(storedB?.status, 'retrying');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the manual queue supports an explicit operator retry with a fresh deadline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, {
      businessKey: 'manual-1',
      retry: {
        maxAttempts: 1,
        baseDelayMs: 1_000,
        maxDelayMs: 1_000,
        jitterRatio: 0,
        stormWindowMs: 60_000,
        stormLimit: 50,
      },
    });
    const claimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-a', taskId: record.taskId });
    assert.ok(claimed);
    const failed = await runtime.fail({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-a',
      token: claimed.lease.token,
      errorClass: 'transient',
      code: 'dependency_down',
      message: 'dependency unavailable',
    });
    assert.equal(failed.manual?.reason, 'retry_exhausted');
    const manualQueue = await runtime.list({ enterpriseId: ENTERPRISE_A, manualOnly: true });
    assert.equal(manualQueue.length, 1);
    assert.equal(manualQueue[0]?.taskId, record.taskId);

    clock.advance(300_000);
    const retried = await runtime.resolveManual({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      resolution: 'retry',
      resolvedBy: 'operator-1',
    });
    assert.equal(retried.status, 'queued');
    assert.equal(retried.manual?.resolution, 'retry');
    assert.equal(retried.manual?.resolvedBy, 'operator-1');
    assert.ok(Date.parse(retried.deadlineAt) > clock.now().getTime());
    const reclaimed = await runtime.claim({ enterpriseId: ENTERPRISE_A, owner: 'worker-b', taskId: record.taskId });
    assert.ok(reclaimed);
    await runtime.complete({
      enterpriseId: ENTERPRISE_A,
      taskId: record.taskId,
      owner: 'worker-b',
      token: reclaimed.lease.token,
    });
    assert.equal((await runtime.get(ENTERPRISE_A, record.taskId))?.status, 'succeeded');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('delegation is persisted and observation logs are redacted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-task-'));
  try {
    const store = createFileDurableTaskStore({ rootDir: root });
    const clock = fakeClock();
    const runtime = runtimeFor(store, clock);
    const record = await createTask(runtime, {
      businessKey: 'delegation-secret-business-key',
      delegation: {
        requestedBy: 'admin-secret-id',
        conversationId: 'conv-secret',
        messageId: 'msg-secret',
        runId: 'run-secret',
      },
      data: { customerNote: 'private-floor-plan-text' },
    });
    const stored = await runtime.get(ENTERPRISE_A, record.taskId);
    assert.equal(stored?.delegation.conversationId, 'conv-secret');
    assert.equal(stored?.data.customerNote, 'private-floor-plan-text');
    assert.equal(record.taskId, durableTaskId(ENTERPRISE_A, 'test.task', 'delegation-secret-business-key'));
    assert.ok(stored);

    const payload = durableTaskTracePayload(stored);
    const text = JSON.stringify(payload);
    assert.equal(payload.tenantId, ENTERPRISE_A);
    assert.equal(payload.taskId, record.taskId);
    assert.equal(text.includes('conv-secret'), false);
    assert.equal(text.includes('private-floor-plan-text'), false);
    assert.equal(text.includes('delegation-secret-business-key'), false);
    assert.equal(text.includes('admin-secret-id'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
