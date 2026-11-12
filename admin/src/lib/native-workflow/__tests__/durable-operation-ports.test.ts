import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowIssue } from '../errors';
import { createMemoryDurableTaskStore } from '../live/durable-task-store';
import {
  createDurableLiveOperationPorts,
  type DurableLiveOperationPortsOptions,
} from '../live/durable-operation-ports';
import {
  LiveOperationFailure,
  LiveOperationTransientError,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LiveRunContext,
} from '../live/types';
import type { PendingOperation, WorkflowValue } from '../types';

const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';

function operationFixture(overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
    nodeId: 'deliver',
    nodeType: 'deliver_inapp',
    capabilityRef: 'construction.notify',
    nodeVersion: 'v1',
    effect: 'deliver',
    input: { message: 'stage done' },
    mode: 'live',
    simulation: false,
    idempotencyKey: 'op-1',
    ...overrides,
  };
}

function contextFixture(overrides: Partial<LiveRunContext> = {}): LiveRunContext {
  return {
    runId: 'run-1',
    definitionId: 'period-report-weekly',
    revision: 1,
    digest: 'digest-1',
    nodeVersions: { deliver: 'v1' },
    event: {
      eventId: 'event-1',
      eventType: 'stage_changed',
      occurredAt: '2026-11-12T02:00:00.000Z',
      stageKey: 'water',
    },
    businessEvent: {
      outboxEventId: '1',
      progressRevision: 3,
      stageKey: 'water',
      settingsVersion: 1,
      source: 'outbox',
    },
    enterpriseId: ENTERPRISE_ID,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function basePorts(execute: (operation: PendingOperation, context: LiveRunContext) => Promise<Readonly<Record<string, WorkflowValue>>>): LiveOperationPorts & { calls: number } {
  const ports = {
    calls: 0,
    async execute(operation: PendingOperation, context: LiveRunContext) {
      ports.calls += 1;
      return execute(operation, context);
    },
  };
  return ports;
}

function adapterOptions(
  base: LiveOperationPorts,
  overrides: Partial<DurableLiveOperationPortsOptions> = {},
): DurableLiveOperationPortsOptions {
  return {
    store: createMemoryDurableTaskStore(),
    base,
    owner: 'worker-a',
    sleep: async () => undefined,
    timeouts: { taskTimeoutMs: 600_000, attemptTimeoutMs: 60_000, externalCallTimeoutMs: 1_000 },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 10,
      jitterRatio: 0,
      stormWindowMs: 60_000,
      stormLimit: 50,
    },
    ...overrides,
  };
}

test('a stored operation result is replayed without calling the business port twice', async () => {
  const base = basePorts(async () => ({ messageId: '501' }));
  const options = adapterOptions(base);
  const ports = createDurableLiveOperationPorts(options);
  const operation = operationFixture();
  const context = contextFixture();

  const first = await ports.execute(operation, context);
  assert.deepEqual(first, { messageId: '501' });
  assert.equal(base.calls, 1);

  const replay = await ports.execute(operation, context);
  assert.deepEqual(replay, { messageId: '501' });
  assert.equal(base.calls, 1);

  const tasks = await options.store.list({ enterpriseId: ENTERPRISE_ID });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.status, 'succeeded');
  assert.equal(tasks[0]?.attempts.length, 1);
  assert.equal(tasks[0]?.delegation.runId, 'run-1');
  assert.equal(tasks[0]?.kind, 'live.operation');
});

test('a declared transient failure retries inside one submission and records every attempt', async () => {
  let calls = 0;
  const base = basePorts(async () => {
    calls += 1;
    if (calls < 3) {
      throw new LiveOperationTransientError(workflowIssue('not_sent', '$', 'the request never reached the service'));
    }
    return { delivered: true };
  });
  const options = adapterOptions(base);
  const ports = createDurableLiveOperationPorts(options);

  const result = await ports.execute(operationFixture(), contextFixture());
  assert.deepEqual(result, { delivered: true });
  assert.equal(base.calls, 3);
  const tasks = await options.store.list({ enterpriseId: ENTERPRISE_ID });
  assert.equal(tasks[0]?.status, 'succeeded');
  assert.equal(tasks[0]?.attempts.length, 3);
  assert.equal(tasks[0]?.attempts.every((attempt) => attempt.outcome === 'succeeded' || attempt.outcome === 'failed'), true);
});

test('an unknown outcome halts and is never replayed automatically', async () => {
  const base = basePorts(async () => {
    throw new Error('socket hang up after request was written');
  });
  const options = adapterOptions(base);
  const ports = createDurableLiveOperationPorts(options);
  const operation = operationFixture();
  const context = contextFixture();

  await assert.rejects(
    () => ports.execute(operation, context),
    (error: unknown) => error instanceof LiveOperationUnknownError
      && error.issue.code === 'live_operation_unknown',
  );
  assert.equal(base.calls, 1);
  const waiting = await options.store.list({ enterpriseId: ENTERPRISE_ID });
  assert.equal(waiting[0]?.status, 'waiting');

  await assert.rejects(
    () => ports.execute(operation, context),
    (error: unknown) => error instanceof LiveOperationUnknownError
      && error.issue.code === 'operation_busy',
  );
  assert.equal(base.calls, 1);
});

test('a known business rejection is not retried and cannot be replayed', async () => {
  const base = basePorts(async () => {
    throw new LiveOperationFailure(workflowIssue('permission_denied', 'nodes.deliver', 'the receiver lost access'));
  });
  const options = adapterOptions(base);
  const ports = createDurableLiveOperationPorts(options);
  const operation = operationFixture();
  const context = contextFixture();

  await assert.rejects(
    () => ports.execute(operation, context),
    (error: unknown) => error instanceof LiveOperationFailure,
  );
  assert.equal(base.calls, 1);
  const tasks = await options.store.list({ enterpriseId: ENTERPRISE_ID });
  assert.equal(tasks[0]?.status, 'failed');
  assert.equal(tasks[0]?.lastError?.class, 'business_rejection');

  await assert.rejects(
    () => ports.execute(operation, context),
    (error: unknown) => error instanceof LiveOperationUnknownError
      && error.issue.code === 'durable_operation_terminal',
  );
  assert.equal(base.calls, 1);
});
