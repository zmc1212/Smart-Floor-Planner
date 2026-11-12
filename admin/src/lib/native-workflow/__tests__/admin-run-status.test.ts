import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createPeriodRunStatusController,
  formatPeriodRunState,
  INITIAL_PERIOD_RUN_STATUS_STATE,
  isPeriodRunTerminal,
  isRestrictedPeriodRunStatus,
  mergePeriodRunObservation,
  nextPeriodRunPollDelay,
  PERIOD_RUN_POLL_INTERVAL_MS,
  PERIOD_RUN_POLL_MAX_READS,
  type PeriodRunObservationResult,
  type PeriodRunStatusControllerState,
  type PeriodRunStatusState,
} from '../admin-run-status';
import type {
  PeriodOverallState,
  PeriodReportRunObservation,
} from '../live/period-report-status';

const job = {
  jobId: null,
  status: null,
  attempts: 0,
  providerStartedAt: null,
};

function observation(options: {
  overall?: PeriodOverallState;
  bound?: boolean;
  processing?: boolean;
  runId?: string;
  observedAt?: string;
} = {}): PeriodReportRunObservation {
  const bound = options.bound ?? true;
  const overall = options.overall ?? 'processing';
  const runId = options.runId ?? 'run-1';
  return {
    contract: 'period-report-run-status-v1',
    observedAt: options.observedAt ?? '2026-11-11T10:00:00.000Z',
    bound,
    binding: bound
      ? {
          runId,
          enterpriseId: '1454',
          projectId: '1455',
          projectName: '测试项目',
          definitionId: 'period-report-daily',
          definitionRevision: 1,
          digest: 'a'.repeat(64),
          periodKind: 'daily',
          periodStart: '2026-11-10',
          periodEnd: '2026-11-10',
          reportId: 'report-1',
          reportRevision: 1,
          reportKey: 'daily:1455:2026-11-10',
          factsRunId: 'facts-run-1',
          bindingId: 'binding-1',
          conversationId: 'conversation-1',
          savedReused: false,
        }
      : null,
    progress: bound
      ? {
          overall,
          completed: overall === 'completed',
          processing: options.processing ?? overall === 'processing',
          facts: {
            state: 'ready',
            runId: 'facts-run-1',
            runStatus: 'completed',
            versionStatus: 'ready',
            generatedAt: null,
            errorCode: null,
            job,
          },
          body: {
            state: 'waiting',
            runId: null,
            runStatus: null,
            knowledgeStatus: null,
            generatedAt: null,
            errorCode: null,
            job,
          },
          delivery: {
            state: 'waiting',
            deliveryState: null,
            messageId: null,
            conversationId: null,
            deliveredAt: null,
            readAt: null,
          },
          availability: { state: 'available', reason: '' },
          reasons: [],
        }
      : null,
    raw: {
      status: 'running',
      errorCode: null,
      errorMessage: null,
      updatedAt: '2026-11-11T10:00:00.000Z',
      operations: [],
    },
    reasons: bound ? [] : ['no_saved_receipt'],
  };
}

function success(value: PeriodReportRunObservation): PeriodRunObservationResult {
  return { ok: true, observation: value };
}

function failure(status: number | null, message = '读取运行状态失败'): PeriodRunObservationResult {
  return { ok: false, status, message };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Harness {
  readonly controller: ReturnType<typeof createPeriodRunStatusController>;
  readonly calls: string[];
  state(): PeriodRunStatusControllerState;
  pendingTimers(): number;
  fireTimer(): void;
}

function harness(
  respond: (call: number, runId: string) => Promise<PeriodRunObservationResult>,
  options: { maxReads?: number } = {},
): Harness {
  let state = INITIAL_PERIOD_RUN_STATUS_STATE;
  const calls: string[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const controller = createPeriodRunStatusController({
    fetchObservation: (runId) => {
      calls.push(runId);
      return respond(calls.length, runId);
    },
    onChange: (next) => {
      state = next;
    },
    now: () => '2026-11-11T12:00:00.000Z',
    intervalMs: PERIOD_RUN_POLL_INTERVAL_MS,
    maxReads: options.maxReads ?? PERIOD_RUN_POLL_MAX_READS,
    setTimeout: (handler) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  });
  return {
    controller,
    calls,
    state: () => state,
    pendingTimers: () => timers.size,
    fireTimer: () => {
      const handlers = [...timers.values()];
      timers.clear();
      handlers.forEach((handler) => handler());
    },
  };
}

// ---------------------------------------------------------------------------
// Existing polling decisions
// ---------------------------------------------------------------------------

test('processing run keeps polling within the read cap', () => {
  const current = observation({ overall: 'processing' });
  assert.equal(isPeriodRunTerminal(current), false);
  assert.equal(nextPeriodRunPollDelay(current, 1), PERIOD_RUN_POLL_INTERVAL_MS);
  assert.equal(nextPeriodRunPollDelay(current, PERIOD_RUN_POLL_MAX_READS - 1), PERIOD_RUN_POLL_INTERVAL_MS);
});

test('completed, stopped, failed, unknown and unavailable stop automatic polling', () => {
  for (const overall of ['completed', 'stopped', 'failed', 'unknown', 'unavailable'] as const) {
    const current = observation({ overall });
    assert.equal(isPeriodRunTerminal(current), true, overall);
    assert.equal(nextPeriodRunPollDelay(current, 1), null, overall);
  }
});

test('queued is not terminal but is not processing, so polling stops', () => {
  const current = observation({ overall: 'queued' });
  assert.equal(isPeriodRunTerminal(current), false);
  assert.equal(nextPeriodRunPollDelay(current, 1), null);
});

test('reaching the read cap stops polling while the run is still processing', () => {
  const current = observation({ overall: 'processing' });
  assert.equal(nextPeriodRunPollDelay(current, PERIOD_RUN_POLL_MAX_READS), null);
});

test('an unbound run stops polling and is terminal', () => {
  const current = observation({ bound: false });
  assert.equal(isPeriodRunTerminal(current), true);
  assert.equal(nextPeriodRunPollDelay(current, 1), null);
});

test('a failed read keeps the previous observation and records the error', () => {
  const previous: PeriodRunStatusState = { observation: observation(), error: null };
  const merged = mergePeriodRunObservation(previous, { error: 'network down' });
  assert.equal(merged.observation, previous.observation);
  assert.equal(merged.error, 'network down');
});

test('a successful read replaces the observation and clears the error', () => {
  const previous: PeriodRunStatusState = { observation: observation(), error: 'old failure' };
  const next = observation({ overall: 'completed' });
  const merged = mergePeriodRunObservation(previous, { observation: next });
  assert.equal(merged.observation, next);
  assert.equal(merged.error, null);
});

test('formatPeriodRunState keeps the contract semantics in short Chinese labels', () => {
  assert.equal(formatPeriodRunState(null), '未读取');
  assert.equal(formatPeriodRunState(observation({ overall: 'queued' }).progress), '排队中');
  assert.equal(formatPeriodRunState(observation({ overall: 'processing' }).progress), '处理中');
  assert.equal(formatPeriodRunState(observation({ overall: 'completed' }).progress), '已完成');
  assert.equal(formatPeriodRunState(observation({ overall: 'stopped' }).progress), '已停止投递');
  assert.equal(formatPeriodRunState(observation({ overall: 'failed' }).progress), '失败');
  assert.equal(formatPeriodRunState(observation({ overall: 'unavailable' }).progress), '不可用');
});

test('a stopped delivery is terminal and never polls again', () => {
  const stopped = observation({ overall: 'stopped' });
  assert.equal(isPeriodRunTerminal(stopped), true);
  assert.equal(nextPeriodRunPollDelay(stopped, 1), null);

  const h = harness(async () => success(stopped));
  h.controller.start('run-1');
  return flush().then(() => {
    assert.equal(h.state().halt, 'terminal');
    assert.equal(h.state().reads, 1);
    assert.equal(h.pendingTimers(), 0);
  });
});

// ---------------------------------------------------------------------------
// Controller lifecycle (manual timers, no real sleep)
// ---------------------------------------------------------------------------

test('leaving before the first read resolves resets loading and ignores the late result', async () => {
  const first = deferred<PeriodRunObservationResult>();
  const second = deferred<PeriodRunObservationResult>();
  const responses = [first, second];
  const h = harness((call) => responses[call - 1].promise);

  h.controller.start('run-1');
  assert.equal(h.state().loading, true);
  assert.equal(h.state().active, true);
  assert.equal(h.calls.length, 1);

  h.controller.deactivate();
  assert.equal(h.state().loading, false, 'leaving must clear loading');
  assert.equal(h.state().observation, null);
  assert.equal(h.state().active, false);

  first.resolve(success(observation({ overall: 'processing' })));
  await flush();
  assert.equal(h.state().observation, null, 'the late response must be dropped');
  assert.equal(h.state().loading, false);

  h.controller.activate();
  assert.equal(h.state().active, true);
  assert.equal(h.calls.length, 2, 'returning re-issues one read');
  assert.equal(h.state().loading, true);

  second.resolve(success(observation({ overall: 'completed' })));
  await flush();
  assert.equal(h.state().observation?.progress?.overall, 'completed');
  assert.equal(h.state().loading, false);
});

test('a processing run schedules a second read and stops at completed', async () => {
  const responses: Deferred<PeriodRunObservationResult>[] = [];
  const h = harness(() => {
    const next = deferred<PeriodRunObservationResult>();
    responses.push(next);
    return next.promise;
  });

  h.controller.start('run-1');
  responses[0].resolve(success(observation({ overall: 'processing' })));
  await flush();
  assert.equal(h.state().halt, 'idle');
  assert.equal(h.state().reads, 1);
  assert.equal(h.pendingTimers(), 1);

  h.fireTimer();
  assert.equal(h.calls.length, 2);
  responses[1].resolve(success(observation({ overall: 'completed' })));
  await flush();
  assert.equal(h.state().halt, 'terminal');
  assert.equal(h.state().reads, 2);
  assert.equal(h.pendingTimers(), 0, 'a terminal run schedules nothing');
});

test('the poll cap stops a still-processing run', async () => {
  const h = harness(
    async () => success(observation({ overall: 'processing' })),
    { maxReads: 2 },
  );

  h.controller.start('run-1');
  await flush();
  assert.equal(h.pendingTimers(), 1);

  h.fireTimer();
  await flush();
  assert.equal(h.state().reads, 2);
  assert.equal(h.state().halt, 'limit');
  assert.equal(h.pendingTimers(), 0);
});

test('switching runId makes the old response unable to overwrite the new run', async () => {
  const first = deferred<PeriodRunObservationResult>();
  const second = deferred<PeriodRunObservationResult>();
  const h = harness((call) => (call === 1 ? first.promise : second.promise));

  h.controller.start('run-a');
  h.controller.start('run-b');
  assert.deepEqual(h.calls, ['run-a', 'run-b']);
  assert.equal(h.state().runId, 'run-b');

  first.resolve(success(observation({ overall: 'completed', runId: 'run-a' })));
  await flush();
  assert.equal(h.state().observation, null, 'run-a must not populate run-b');
  assert.equal(h.state().halt, 'idle');

  second.resolve(success(observation({ overall: 'processing', runId: 'run-b' })));
  await flush();
  assert.equal(h.state().observation?.binding?.runId, 'run-b');
  assert.equal(h.state().halt, 'idle');
});

test('401/403/404 clears the old snapshot, stops and does not auto-retry', async () => {
  for (const status of [401, 403, 404] as const) {
    assert.equal(isRestrictedPeriodRunStatus(status), true);
    const responses: Deferred<PeriodRunObservationResult>[] = [];
    const h = harness(() => {
      const next = deferred<PeriodRunObservationResult>();
      responses.push(next);
      return next.promise;
    });

    h.controller.start('run-1');
    responses[0].resolve(success(observation({ overall: 'processing' })));
    await flush();
    assert.ok(h.state().observation);

    h.controller.start('run-1');
    responses[1].resolve(failure(status, 'forbidden'));
    await flush();

    assert.equal(h.state().observation, null, `HTTP ${status} must drop binding/progress/raw`);
    assert.equal(h.state().halt, 'restricted');
    assert.equal(h.state().error?.kind, 'restricted');
    assert.equal(h.state().error?.status, status);
    assert.equal(h.state().error?.at, '2026-11-11T12:00:00.000Z');
    assert.equal(h.pendingTimers(), 0);

    h.controller.deactivate();
    h.controller.activate();
    assert.equal(h.calls.length, 2, 'a denial is never retried by a tab switch');

    h.controller.start('run-1');
    assert.equal(h.calls.length, 3, 'the manual button can still retry');
    assert.equal(h.state().error, null);
  }
});

test('a transient failure keeps the last snapshot but stops polling', async () => {
  for (const status of [500, null] as const) {
    assert.equal(isRestrictedPeriodRunStatus(status), false);
    const responses: Deferred<PeriodRunObservationResult>[] = [];
    const h = harness(() => {
      const next = deferred<PeriodRunObservationResult>();
      responses.push(next);
      return next.promise;
    });

    h.controller.start('run-1');
    responses[0].resolve(success(observation({ overall: 'processing' })));
    await flush();
    const trusted = h.state().observation;
    assert.equal(h.pendingTimers(), 1);

    h.controller.start('run-1');
    responses[1].resolve(failure(status, status === null ? 'network down' : 'server error'));
    await flush();

    assert.equal(h.state().observation, trusted, 'the last trusted snapshot is kept');
    assert.equal(h.state().error?.kind, 'transient');
    assert.equal(h.state().error?.status, status);
    assert.equal(h.state().error?.at, '2026-11-11T12:00:00.000Z');
    assert.equal(h.state().halt, 'error');
    assert.equal(h.pendingTimers(), 0);

    h.controller.deactivate();
    h.controller.activate();
    assert.equal(h.calls.length, 2, 'a transient failure stays stopped on tab return');
  }
});

test('the admin page wires the exported controller and controlled tabs', () => {
  const page = readFileSync(
    fileURLToPath(
      new URL(
        '../../../app/(admin)/(platform)/native-workflow/[definitionId]/page.tsx',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  assert.ok(page.includes('createPeriodRunStatusController'));
  assert.ok(page.includes("from '@/lib/native-workflow/admin-run-status'"));
  assert.ok(page.includes('activeKey={activeTab}'));
  assert.ok(page.includes('runController.current'));
  assert.ok(page.includes('controller.start('));
  assert.equal(page.includes('pollGeneration'), false, 'page must not keep its own generation');
  assert.equal(page.includes('loadRunStatus'), false, 'page must not keep its own loader');
});
