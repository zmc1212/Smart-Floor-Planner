import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateFreshGeneration,
  evaluateReplay,
  evaluateReportModelEvidence,
  type FreshAcceptanceInput,
  type PeriodCounts,
  type ReplayAcceptanceInput,
  type ReportEvidenceSnapshot,
  type ReportModelEvidence,
} from '../live/report-model-evidence';

const EXPECTED = { reportId: '3', revision: 1, factsRunId: '5' };
const BODY_RUN_ID = '6';

function snapshot(overrides: Partial<ReportEvidenceSnapshot> = {}): ReportEvidenceSnapshot {
  return {
    report: { id: '3', latest_revision: 1 },
    version: {
      report_id: '3',
      revision: 1,
      run_id: '5',
      body_run_id: BODY_RUN_ID,
      status: 'facts_ready',
      knowledge_status: 'ready',
    },
    factsRun: { id: '5', purpose: 'construction.report.facts', status: 'succeeded' },
    bodyRun: { id: BODY_RUN_ID, purpose: 'construction.report.compose', status: 'succeeded' },
    steps: [
      { run_id: '5', step_seq: 100, kind: 'agent_knowledge', status: 'succeeded', provider_attempt_id: null },
      { run_id: BODY_RUN_ID, step_seq: 1100, kind: 'agent_model', status: 'succeeded', provider_attempt_id: '900' },
      { run_id: BODY_RUN_ID, step_seq: 1110, kind: 'agent_model', status: 'succeeded', provider_attempt_id: '901' },
    ],
    attempts: [
      { id: '900', assistant_run_id: BODY_RUN_ID, provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
      { id: '901', assistant_run_id: BODY_RUN_ID, provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
    ],
    usage: [
      { id: 'u1', run_id: BODY_RUN_ID, provider_attempt_id: '900', category: 'tokens', measurement_kind: 'observed', quantity: 2842, input_tokens: 1105, output_tokens: 1737 },
      { id: 'u2', run_id: BODY_RUN_ID, provider_attempt_id: '901', category: 'tokens', measurement_kind: 'observed', quantity: 500, input_tokens: 200, output_tokens: 300 },
    ],
    ...overrides,
  };
}

function evaluate(overrides: Partial<ReportEvidenceSnapshot> = {}): ReportModelEvidence {
  return evaluateReportModelEvidence(EXPECTED, snapshot(overrides));
}

function reasons(evidence: ReportModelEvidence): readonly string[] {
  return evidence.reasons;
}

test('a fully bound snapshot passes and reports the real attempts, usage and tokens', () => {
  const evidence = evaluate();
  assert.equal(evidence.ok, true);
  assert.deepEqual(reasons(evidence), []);
  assert.deepEqual(evidence.binding, {
    reportId: '3',
    revision: 1,
    factsRunId: '5',
    bodyRunId: BODY_RUN_ID,
    attemptIds: ['900', '901'],
    usageIds: ['u1', 'u2'],
    inputTokens: 1305,
    outputTokens: 2037,
  });
});

test('non-token usage from the same body run neither proves nor invalidates model evidence', () => {
  const evidence = evaluate({
    usage: [
      ...snapshot().usage,
      { id: 'u3', run_id: BODY_RUN_ID, provider_attempt_id: null, category: 'query_embedding', measurement_kind: 'observed', quantity: 320, input_tokens: 320, output_tokens: null },
    ],
  });
  assert.equal(evidence.ok, true);
  assert.deepEqual(reasons(evidence), []);
  assert.deepEqual(evidence.binding?.usageIds, ['u1', 'u2']);
});

test('report, version and facts-run identity must match the expected report', () => {
  const evidence = evaluate({
    report: { id: '4', latest_revision: 2 },
    version: {
      report_id: '4',
      revision: 2,
      run_id: '7',
      body_run_id: BODY_RUN_ID,
      status: 'facts_pending',
      knowledge_status: 'pending',
    },
  });
  assert.equal(evidence.ok, false);
  for (const code of [
    'report_id_mismatch',
    'report_revision_mismatch',
    'version_report_id_mismatch',
    'version_revision_mismatch',
    'version_facts_run_mismatch',
    'version_status_mismatch',
    'version_knowledge_not_ready',
  ]) assert.ok(reasons(evidence).includes(code), `missing ${code}`);
});

test('a missing report or version fails instead of silently passing', () => {
  assert.deepEqual(reasons(evaluate({ report: null })), ['report_missing']);
  assert.deepEqual(reasons(evaluate({ version: null })), ['version_missing']);
});

test('the version body run must be present and be the composition run', () => {
  const evidence = evaluate({
    version: {
      report_id: '3',
      revision: 1,
      run_id: '5',
      body_run_id: '7',
      status: 'facts_ready',
      knowledge_status: 'ready',
    },
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('body_run_id_mismatch'));
  assert.ok(reasons(evidence).includes('model_step_missing'));
});

test('a report whose body run has no composed model step fails', () => {
  const evidence = evaluate({
    steps: [{ run_id: '5', step_seq: 100, kind: 'agent_knowledge', status: 'succeeded', provider_attempt_id: null }],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('model_step_missing'));
});

test('a failed agent_model step fails the evidence', () => {
  const evidence = evaluate({
    steps: [
      { run_id: BODY_RUN_ID, step_seq: 1100, kind: 'agent_model', status: 'failed', provider_attempt_id: null },
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('model_step_not_succeeded'));
  assert.ok(reasons(evidence).includes('model_step_attempt_missing'));
});

test('every model step must carry a provider attempt id', () => {
  const evidence = evaluate({
    steps: [
      { run_id: BODY_RUN_ID, step_seq: 1100, kind: 'agent_model', status: 'succeeded', provider_attempt_id: '900' },
      { run_id: BODY_RUN_ID, step_seq: 1110, kind: 'agent_model', status: 'succeeded', provider_attempt_id: null },
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('model_step_attempt_missing'));
});

test('an unrelated historical attempt can never be accepted as this run evidence', () => {
  const evidence = evaluate({
    attempts: [
      ...snapshot().attempts,
      { id: '999', assistant_run_id: '7', provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('attempt_run_mismatch'));
});

test('a model step pointing at another run attempt fails', () => {
  const evidence = evaluate({
    steps: [
      { run_id: BODY_RUN_ID, step_seq: 1100, kind: 'agent_model', status: 'succeeded', provider_attempt_id: '999' },
    ],
    attempts: [
      { id: '999', assistant_run_id: '7', provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
    ],
    usage: [],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('attempt_run_mismatch'));
});

test('a failed attempt fails even when the step is marked succeeded', () => {
  const evidence = evaluate({
    attempts: [
      { id: '900', assistant_run_id: BODY_RUN_ID, provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'failed', accepted: false },
      snapshot().attempts[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('attempt_not_succeeded'));
  assert.ok(reasons(evidence).includes('attempt_not_accepted'));
});

test('an attempt that was not accepted fails', () => {
  const evidence = evaluate({
    attempts: [
      { id: '900', assistant_run_id: BODY_RUN_ID, provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: false },
      snapshot().attempts[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.deepEqual(reasons(evidence), ['attempt_not_accepted']);
});

test('a FastGPT attempt fails the native model evidence', () => {
  const evidence = evaluate({
    attempts: [
      { id: '900', assistant_run_id: BODY_RUN_ID, provider_key: 'fastgpt-workflow', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
      snapshot().attempts[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('fastgpt_attempt'));
});

test('usage from another run cannot stand in for this body run', () => {
  const evidence = evaluate({
    usage: [
      { id: 'u1', run_id: '5', provider_attempt_id: '900', category: 'tokens', measurement_kind: 'observed', quantity: 2842, input_tokens: 1105, output_tokens: 1737 },
      snapshot().usage[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('usage_run_mismatch'));
});

test('usage bound to another attempt cannot stand in for the step attempt', () => {
  const evidence = evaluate({
    attempts: [
      ...snapshot().attempts,
      { id: '902', assistant_run_id: BODY_RUN_ID, provider_key: 'llm-settings-override', adapter_type: 'openai_compatible', status: 'succeeded', accepted: true },
    ],
    usage: [
      { id: 'u1', run_id: BODY_RUN_ID, provider_attempt_id: '902', category: 'tokens', measurement_kind: 'observed', quantity: 2842, input_tokens: 1105, output_tokens: 1737 },
      snapshot().usage[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('usage_attempt_mismatch'));
});

test('usage without a provider attempt id cannot be used as evidence', () => {
  const evidence = evaluate({
    usage: [
      { id: 'u1', run_id: BODY_RUN_ID, provider_attempt_id: null, category: 'tokens', measurement_kind: 'observed', quantity: 2842, input_tokens: 1105, output_tokens: 1737 },
      snapshot().usage[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('usage_attempt_mismatch'));
});

test('unknown or unavailable token measurement fails', () => {
  for (const measurement of ['unknown', 'unavailable']) {
    const evidence = evaluate({
      usage: [
        { id: 'u1', run_id: BODY_RUN_ID, provider_attempt_id: '900', category: 'tokens', measurement_kind: measurement, quantity: null, input_tokens: null, output_tokens: null },
        snapshot().usage[1],
      ],
    });
    assert.equal(evidence.ok, false, measurement);
    assert.ok(reasons(evidence).includes('usage_not_observed'), measurement);
  }
});

test('observed usage without both token counts fails', () => {
  const evidence = evaluate({
    usage: [
      { id: 'u1', run_id: BODY_RUN_ID, provider_attempt_id: '900', category: 'tokens', measurement_kind: 'observed', quantity: 1105, input_tokens: 1105, output_tokens: null },
      snapshot().usage[1],
    ],
  });
  assert.equal(evidence.ok, false);
  assert.ok(reasons(evidence).includes('usage_tokens_missing'));
});

test('a missing usage row for a model attempt fails', () => {
  const evidence = evaluate({ usage: [snapshot().usage[0]] });
  assert.equal(evidence.ok, false);
  assert.deepEqual(reasons(evidence), ['usage_missing']);
});

function counts(value: number): PeriodCounts {
  return {
    assistantUsageRecords: value,
    aiProviderAttempts: value,
    assistantJobs: value,
    assistantRuns: value,
    constructionReports: value,
    reportDeliveries: value,
    reportMessages: value,
  };
}

function freshInput(overrides: Partial<FreshAcceptanceInput> = {}): FreshAcceptanceInput {
  return {
    saveReceipt: { reportId: '3', revision: 1, runId: '5', reportKey: 'daily:2026-11-05:3', reused: false },
    evidence: evaluate(),
    countsBefore: counts(10),
    countsAfter: counts(11),
    worker: {
      factsJob: { status: 'succeeded', attempts: 1 },
      bodyJob: { status: 'succeeded', attempts: 1 },
    },
    ...overrides,
  };
}

test('fresh acceptance passes when a new report, jobs and model evidence are real', () => {
  const result = evaluateFreshGeneration(freshInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('fresh acceptance rejects a reused save receipt', () => {
  const result = evaluateFreshGeneration(freshInput({
    saveReceipt: { reportId: '3', revision: 1, runId: '5', reused: true },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('fresh_receipt_reused'));
});

test('fresh acceptance rejects a missing or incomplete save receipt', () => {
  const missing = evaluateFreshGeneration(freshInput({ saveReceipt: null }));
  assert.ok(missing.reasons.includes('fresh_receipt_missing'));
  const incomplete = evaluateFreshGeneration(freshInput({ saveReceipt: { reused: false } }));
  assert.ok(incomplete.reasons.includes('fresh_receipt_incomplete'));
});

test('fresh acceptance rejects a save receipt that disagrees with the model evidence', () => {
  const result = evaluateFreshGeneration(freshInput({
    saveReceipt: { reportId: '4', revision: 2, runId: '5', reused: false },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('fresh_evidence_mismatch'));
});

test('fresh acceptance rejects unchanged counters', () => {
  const result = evaluateFreshGeneration(freshInput({ countsAfter: counts(10) }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('fresh_counts_not_increased:assistantJobs'));
  assert.ok(result.reasons.includes('fresh_counts_not_increased:reportMessages'));
});

test('fresh acceptance rejects failed or attempt-less worker jobs', () => {
  const result = evaluateFreshGeneration(freshInput({
    worker: {
      factsJob: { status: 'failed', attempts: 0 },
      bodyJob: null,
    },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('worker_facts_job_not_succeeded'));
  assert.ok(result.reasons.includes('worker_facts_job_attempts_zero'));
  assert.ok(result.reasons.includes('worker_body_job_missing'));
});

test('fresh acceptance carries the model evidence failure reasons', () => {
  const evidence = evaluate({ report: null });
  const result = evaluateFreshGeneration(freshInput({ evidence }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('model_evidence_failed'));
  assert.ok(result.reasons.includes('report_missing'));
});

function replayInput(overrides: Partial<ReplayAcceptanceInput> = {}): ReplayAcceptanceInput {
  return {
    expected: { reportId: '3', revision: 1, factsRunId: '5', reportKey: 'daily:2026-11-05:3' },
    saveReceipt: { reportId: '3', revision: 1, runId: '5', reportKey: 'daily:2026-11-05:3', reused: true },
    deliveryReceipt: { status: 'delivered', messageId: '114', conversationId: '1454000007' },
    expectedDelivery: { messageId: '114', conversationId: '1454000007' },
    countsBefore: counts(11),
    countsAfter: counts(11),
    ...overrides,
  };
}

test('replay acceptance passes without new rows or token growth', () => {
  const result = evaluateReplay(replayInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('replay acceptance rejects a receipt that claims a fresh generation', () => {
  const result = evaluateReplay(replayInput({
    saveReceipt: { reportId: '3', revision: 1, runId: '5', reportKey: 'daily:2026-11-05:3', reused: false },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('replay_receipt_not_reused'));
});

test('replay acceptance rejects a different report binding', () => {
  const result = evaluateReplay(replayInput({
    saveReceipt: { reportId: '3', revision: 2, runId: '8', reportKey: 'other', reused: true },
  }));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('replay_receipt_mismatch'));
});

test('replay acceptance rejects any counter change', () => {
  const result = evaluateReplay(replayInput({
    countsAfter: { ...counts(11), reportMessages: 12 },
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['replay_counts_changed:reportMessages']);
});

test('replay acceptance rejects a missing or different delivery receipt', () => {
  const missing = evaluateReplay(replayInput({ deliveryReceipt: null }));
  assert.ok(missing.reasons.includes('replay_delivery_missing'));
  const noExpected = evaluateReplay(replayInput({ expectedDelivery: null }));
  assert.ok(noExpected.reasons.includes('replay_delivery_missing'));
  const pending = evaluateReplay(replayInput({
    deliveryReceipt: { status: 'pending', messageId: '114', conversationId: '1454000007' },
  }));
  assert.ok(pending.reasons.includes('replay_delivery_not_delivered'));
  const otherMessage = evaluateReplay(replayInput({
    deliveryReceipt: { status: 'delivered', messageId: '115', conversationId: '1454000007' },
  }));
  assert.ok(otherMessage.reasons.includes('replay_delivery_mismatch'));
  const otherConversation = evaluateReplay(replayInput({
    deliveryReceipt: { status: 'delivered', messageId: '114', conversationId: '1454000008' },
  }));
  assert.ok(otherConversation.reasons.includes('replay_delivery_mismatch'));
});
