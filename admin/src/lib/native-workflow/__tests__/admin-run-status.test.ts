import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatPeriodRunState,
  isPeriodRunTerminal,
  mergePeriodRunObservation,
  nextPeriodRunPollDelay,
  PERIOD_RUN_POLL_INTERVAL_MS,
  PERIOD_RUN_POLL_MAX_READS,
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
} = {}): PeriodReportRunObservation {
  const bound = options.bound ?? true;
  const overall = options.overall ?? 'processing';
  return {
    contract: 'period-report-run-status-v1',
    observedAt: '2026-11-11T10:00:00.000Z',
    bound,
    binding: bound
      ? {
          runId: 'run-1',
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

test('processing run keeps polling within the read cap', () => {
  const current = observation({ overall: 'processing' });
  assert.equal(isPeriodRunTerminal(current), false);
  assert.equal(nextPeriodRunPollDelay(current, 1), PERIOD_RUN_POLL_INTERVAL_MS);
  assert.equal(nextPeriodRunPollDelay(current, PERIOD_RUN_POLL_MAX_READS - 1), PERIOD_RUN_POLL_INTERVAL_MS);
});

test('completed, failed, unknown and unavailable stop automatic polling', () => {
  for (const overall of ['completed', 'failed', 'unknown', 'unavailable'] as const) {
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
  assert.equal(formatPeriodRunState(observation({ overall: 'failed' }).progress), '失败');
  assert.equal(formatPeriodRunState(observation({ overall: 'unavailable' }).progress), '不可用');
});
