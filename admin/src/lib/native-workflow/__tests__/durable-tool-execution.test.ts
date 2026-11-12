import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createFileDurableTaskStore } from '../live/durable-task-store';
import { createDurableTaskRuntime, type DurableTaskRuntime } from '../live/durable-task-runtime';
import {
  createDurableToolExecutor,
  type DurableToolCallback,
  type DurableToolDispatchInput,
  type DurableToolPort,
  type DurableToolProbeInput,
  type DurableToolProbeResult,
  type DurableToolRequest,
  type DurableToolSaveInput,
  type DurableToolWritebackInput,
} from '../live/durable-tool-execution';
import type { DurableTaskRecord } from '../live/durable-task-types';

const ENTERPRISE_A = '1454';
const ENTERPRISE_B = '1455';
const PROJECT_ID = '1454000004';
const CHECKED_AT = '2026-11-12T02:00:00.000Z';

function toolRequest(overrides: Partial<DurableToolRequest> = {}): DurableToolRequest {
  return {
    enterpriseId: ENTERPRISE_A,
    projectId: PROJECT_ID,
    tool: 'construction.notify',
    idempotencyKey: 'event-1',
    delegation: {
      requestedBy: 'admin-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      runId: 'run-1',
    },
    authorization: {
      allowed: true,
      actorId: 'admin-1',
      checkedAt: CHECKED_AT,
      scope: 'project:write',
      reason: null,
    },
    effect: 'deliver',
    payload: { recipient: 'worker-1', text: 'stage done' },
    workerId: 'worker-a',
    timeouts: {
      taskTimeoutMs: 600_000,
      attemptTimeoutMs: 60_000,
      externalCallTimeoutMs: 20,
    },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      jitterRatio: 0,
      stormWindowMs: 60_000,
      stormLimit: 50,
    },
    ...overrides,
  };
}

interface FakePortCalls {
  readonly dispatch: DurableToolDispatchInput[];
  readonly probe: DurableToolProbeInput[];
  readonly save: DurableToolSaveInput[];
  readonly writeback: DurableToolWritebackInput[];
}

interface FakePortOptions {
  readonly dispatch?: (input: DurableToolDispatchInput) => Promise<{ readonly externalId: string }>;
  readonly probe?: (input: DurableToolProbeInput) => Promise<DurableToolProbeResult>;
  readonly saveResult?: (input: DurableToolSaveInput) => Promise<{ readonly savedId: string }>;
  readonly writeback?: (input: DurableToolWritebackInput) => Promise<void>;
}

function fakePort(options: FakePortOptions = {}): { port: DurableToolPort; calls: FakePortCalls } {
  const calls: FakePortCalls = { dispatch: [], probe: [], save: [], writeback: [] };
  return {
    calls,
    port: {
      async dispatch(input) {
        calls.dispatch.push(input);
        return options.dispatch ? options.dispatch(input) : { externalId: 'ext-1' };
      },
      async probe(input) {
        calls.probe.push(input);
        return options.probe ? options.probe(input) : { status: 'unknown' };
      },
      async saveResult(input) {
        calls.save.push(input);
        return options.saveResult ? options.saveResult(input) : { savedId: 'saved-1' };
      },
      async writeback(input) {
        calls.writeback.push(input);
        return options.writeback ? options.writeback(input) : undefined;
      },
    },
  };
}

function dispatchIdOf(record: DurableTaskRecord): string {
  const dispatch = record.data.dispatch as Record<string, unknown> | null | undefined;
  assert.ok(dispatch);
  return String(dispatch.dispatchId);
}

function callbackOf(
  record: DurableTaskRecord,
  overrides: Partial<DurableToolCallback> = {},
): DurableToolCallback {
  return {
    enterpriseId: record.enterpriseId,
    taskId: record.taskId,
    callbackId: 'callback-1',
    dispatchId: dispatchIdOf(record),
    status: 'succeeded',
    result: { messageId: '501' },
    ...overrides,
  };
}

async function toolEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-durable-tool-'));
  const store = createFileDurableTaskStore({ rootDir: root });
  const runtime: DurableTaskRuntime = createDurableTaskRuntime({ store, random: () => 0.5 });
  return {
    root,
    store,
    runtime,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('an external timeout that actually succeeded is reconciled without a second dispatch', async () => {
  const env = await toolEnv();
  try {
    let probeResult: DurableToolProbeResult = { status: 'unknown' };
    const { port, calls } = fakePort({
      dispatch: () => new Promise(() => undefined),
      probe: async () => probeResult,
    });
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    assert.equal(submitted.state, 'unknown');
    assert.equal(calls.dispatch.length, 1);
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.equal(waiting?.status, 'waiting');
    assert.equal(waiting?.delegation.conversationId, 'conv-1');
    const dispatch = waiting?.data.dispatch as Record<string, unknown>;
    assert.equal(dispatch.externalId, null);

    probeResult = { status: 'succeeded', result: { messageId: '501' } };
    const reconciled = await executor.reconcile(ENTERPRISE_A, submitted.taskId);
    assert.equal(reconciled?.status, 'succeeded');
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.probe.length, 1);
    assert.equal(calls.save.length, 1);
    assert.equal(calls.writeback.length, 1);
    const receipt = reconciled?.data.receipt as Record<string, unknown>;
    assert.deepEqual(receipt.result, { messageId: '501' });

    // A later resubmission adopts the completed task and never dispatches again.
    const repeated = await executor.submit(toolRequest());
    assert.equal(repeated.state, 'succeeded');
    assert.deepEqual(repeated.result, { messageId: '501' });
    assert.equal(calls.dispatch.length, 1);
  } finally {
    await env.cleanup();
  }
});

test('duplicate callbacks are applied once', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    assert.equal(submitted.state, 'dispatched');
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.ok(waiting);
    const callback = callbackOf(waiting);

    const first = await executor.handleCallback(callback);
    assert.equal(first.applied, true);
    assert.equal(first.record?.status, 'succeeded');

    const second = await executor.handleCallback(callback);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'duplicate');
    assert.equal(second.record?.status, 'succeeded');
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.save.length, 1);
    assert.equal(calls.writeback.length, 1);

    const stored = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    const callbacks = stored?.data.callbacks as readonly Record<string, unknown>[];
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0]?.applied, true);
  } finally {
    await env.cleanup();
  }
});

test('a callback that arrives after cancellation is recorded as ignored', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.ok(waiting);
    const callback = callbackOf(waiting);
    await env.runtime.cancel({
      enterpriseId: ENTERPRISE_A,
      taskId: submitted.taskId,
      reason: 'the tenant cancelled the notification',
      by: 'admin-1',
    });

    const late = await executor.handleCallback(callback);
    assert.equal(late.applied, false);
    assert.equal(late.reason, 'terminal');
    assert.equal(late.record?.status, 'cancelled');
    assert.equal(calls.save.length, 0);
    assert.equal(calls.writeback.length, 0);
    const callbacks = late.record?.data.callbacks as readonly Record<string, unknown>[];
    assert.equal(callbacks.at(-1)?.reason, 'terminal');
  } finally {
    await env.cleanup();
  }
});

test('a failed result save keeps the receipt and retries only the save/writeback phase', async () => {
  const env = await toolEnv();
  try {
    let failSave = true;
    const { port, calls } = fakePort({
      saveResult: async () => {
        if (failSave) throw new Error('receipt store unavailable');
        return { savedId: 'saved-9' };
      },
    });
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.ok(waiting);
    const applied = await executor.handleCallback(callbackOf(waiting));
    assert.equal(applied.applied, true);
    assert.equal(applied.record?.status, 'waiting');
    assert.equal(applied.record?.data.pendingPhase, 'save_result');
    assert.equal(applied.record?.data.saved, null);
    const receipt = applied.record?.data.receipt as Record<string, unknown>;
    assert.deepEqual(receipt.result, { messageId: '501' });
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.save.length, 1);

    failSave = false;
    const resumed = await executor.resume(ENTERPRISE_A, submitted.taskId);
    assert.equal(resumed?.status, 'succeeded');
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.save.length, 2);
    assert.equal(calls.writeback.length, 1);
    const saved = resumed?.data.saved as Record<string, unknown>;
    assert.equal(saved.savedId, 'saved-9');
  } finally {
    await env.cleanup();
  }
});

test('a restart cannot confirm the external state until a bounded probe succeeds', async () => {
  const env = await toolEnv();
  try {
    let probeResult: DurableToolProbeResult = { status: 'unknown' };
    const { port, calls } = fakePort({
      dispatch: () => new Promise(() => undefined),
      probe: async () => probeResult,
    });
    const first = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await first.submit(toolRequest());
    assert.equal(submitted.state, 'unknown');
    assert.equal(calls.dispatch.length, 1);

    // A new process over the same store; it only sees the durable dispatch marker.
    const restartedRuntime = createDurableTaskRuntime({ store: env.store, random: () => 0.5 });
    const restarted = createDurableToolExecutor({ runtime: restartedRuntime, port });
    const firstProbe = await restarted.reconcile(ENTERPRISE_A, submitted.taskId);
    assert.equal(firstProbe?.status, 'waiting');
    assert.equal(firstProbe?.data.probes, 1);
    const secondProbe = await restarted.reconcile(ENTERPRISE_A, submitted.taskId);
    assert.equal(secondProbe?.status, 'waiting');
    assert.equal(secondProbe?.data.probes, 2);

    probeResult = { status: 'succeeded', result: { messageId: '777' } };
    const resolved = await restarted.reconcile(ENTERPRISE_A, submitted.taskId);
    assert.equal(resolved?.status, 'succeeded');
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.save.length, 1);
  } finally {
    await env.cleanup();
  }
});

test('a foreign tenant callback is treated as missing and changes nothing', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.ok(waiting);

    const foreign = await executor.handleCallback(callbackOf(waiting, { enterpriseId: ENTERPRISE_B }));
    assert.equal(foreign.applied, false);
    assert.equal(foreign.reason, 'not_found');
    assert.equal(foreign.record, null);
    assert.equal(calls.save.length, 0);
    const unchanged = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.equal(unchanged?.status, 'waiting');
  } finally {
    await env.cleanup();
  }
});

test('a callback that arrives while another owner holds the lease is deferred', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest());
    const waiting = await env.runtime.get(ENTERPRISE_A, submitted.taskId);
    assert.ok(waiting);
    const callback = callbackOf(waiting);

    const held = await env.runtime.acquire({
      enterpriseId: ENTERPRISE_A,
      taskId: submitted.taskId,
      owner: 'other-worker',
      token: 'other-token',
      ttlMs: 60_000,
    });
    assert.ok(held);
    const deferred = await executor.handleCallback(callback);
    assert.equal(deferred.applied, false);
    assert.equal(deferred.reason, 'busy');
    assert.equal(calls.save.length, 0);

    await env.runtime.release({
      enterpriseId: ENTERPRISE_A,
      taskId: submitted.taskId,
      owner: 'other-worker',
      token: 'other-token',
    });
    const applied = await executor.handleCallback(callback);
    assert.equal(applied.applied, true);
    assert.equal(applied.record?.status, 'succeeded');
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.save.length, 1);
  } finally {
    await env.cleanup();
  }
});

test('an unauthorized tool request is rejected before any dispatch', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const submitted = await executor.submit(toolRequest({
      authorization: {
        allowed: false,
        actorId: 'worker-x',
        checkedAt: CHECKED_AT,
        scope: 'project:write',
        reason: 'the worker cannot write this project',
      },
    }));
    assert.equal(submitted.state, 'rejected');
    assert.equal(submitted.record.status, 'failed');
    assert.equal(submitted.record.lastError?.class, 'business_rejection');
    assert.equal(submitted.record.lastError?.code, 'tool_unauthorized');
    assert.equal(calls.dispatch.length, 0);
    assert.equal(calls.save.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('a repeated submission with the same idempotency key never dispatches twice', async () => {
  const env = await toolEnv();
  try {
    const { port, calls } = fakePort();
    const executor = createDurableToolExecutor({ runtime: env.runtime, port });
    const first = await executor.submit(toolRequest());
    assert.equal(first.state, 'dispatched');
    const second = await executor.submit(toolRequest());
    assert.equal(second.state, 'in_flight');
    assert.equal(second.taskId, first.taskId);
    assert.equal(calls.dispatch.length, 1);
    const source = await env.runtime.get(ENTERPRISE_A, first.taskId);
    assert.equal(source?.data.payload ? (source.data.payload as Record<string, unknown>).text : null, 'stage done');
    assert.equal(source?.delegation.messageId, 'msg-1');
  } finally {
    await env.cleanup();
  }
});
