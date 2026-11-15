import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPreviewJob, type PreviewJobInput } from '../infrastructure/job-preview';

const now = new Date('2026-11-16T12:00:00.000Z');
const base: PreviewJobInput = {
  status: 'queued',
  availableAt: now,
  leaseExpiresAt: null,
  providerStartedAt: null,
  agentSteps: 0,
  incompleteAgentSteps: 0,
  localSpeech: false,
  now,
};

test('I7.5.8 a due queued job is reclaimable and a future one only waits', () => {
  assert.deepEqual(classifyPreviewJob(base),
    { classification: 'reclaimable', reason: 'queued_ready', reclaimable: true });
  assert.deepEqual(classifyPreviewJob({ ...base, availableAt: new Date(now.getTime() + 60000) }),
    { classification: 'waiting', reason: 'queued_not_due', reclaimable: false });
});

test('I7.5.8 an active lease is not reclaimable', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'running',
    leaseExpiresAt: new Date(now.getTime() + 60000) }),
  { classification: 'running', reason: 'lease_active', reclaimable: false });
});

test('I7.5.8 a running job without a lease is not automatically recoverable', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'running', leaseExpiresAt: null }),
    { classification: 'indeterminate', reason: 'lease_missing', reclaimable: false });
});

test('I7.5.8 an expired running job without provider dispatch is safe to reclaim', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'running',
    leaseExpiresAt: new Date(now.getTime() - 1000) }),
  { classification: 'reclaimable', reason: 'expired_without_provider', reclaimable: true });
});

test('I7.5.8 provider started with an unknown outcome stays indeterminate', () => {
  const expired = { ...base, status: 'running', leaseExpiresAt: new Date(now.getTime() - 1000),
    providerStartedAt: new Date(now.getTime() - 5000) };
  assert.deepEqual(classifyPreviewJob(expired),
    { classification: 'indeterminate', reason: 'provider_outcome_unknown', reclaimable: false });
  assert.deepEqual(classifyPreviewJob({ ...expired, agentSteps: 1, incompleteAgentSteps: 1 }),
    { classification: 'indeterminate', reason: 'provider_outcome_unknown', reclaimable: false });
});

test('I7.5.8 provider started with a fully recorded agent outcome is safe to reclaim', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'running',
    leaseExpiresAt: new Date(now.getTime() - 1000), providerStartedAt: new Date(now.getTime() - 5000),
    agentSteps: 2, incompleteAgentSteps: 0 }),
  { classification: 'reclaimable', reason: 'expired_with_known_agent_outcome', reclaimable: true });
});

test('I7.5.8 lost local speech never becomes a replay', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'running',
    leaseExpiresAt: new Date(now.getTime() - 1000), localSpeech: true }),
  { classification: 'terminal', reason: 'local_speech_result_unknown', reclaimable: false });
});

test('I7.5.8 failed and indeterminate jobs are terminal and never auto-retried', () => {
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'failed' }),
    { classification: 'terminal', reason: 'failed_terminal', reclaimable: false });
  assert.deepEqual(classifyPreviewJob({ ...base, status: 'indeterminate' }),
    { classification: 'terminal', reason: 'indeterminate_terminal', reclaimable: false });
});
