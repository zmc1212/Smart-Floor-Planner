import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDeployment, auditKindCounts, auditNonStageKinds, auditPrefixHash, auditWindowEntries,
  AuditSourceError, openAuditWindow } from '../fastgpt/agent-v2/audit-window';

const workflowsFile = 'C:/deployment/runtime.private.json';
const auditFile = 'C:/deployment/agent-v2-audit.jsonl';
const serviceBase = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const workflows = { auditFile, baseUrl: 'http://127.0.0.1:18300', agentV2: { enterpriseId: '1454', appId: 'a'.repeat(24),
  model: 'labelled-model', runtime: 'fastgpt-agent-v2' } };
const deployment = auditDeployment(workflowsFile, workflows, serviceBase);
const line = (kind: string, runId: string) => JSON.stringify({ kind, at: '2026-11-11T00:00:00.000Z',
  value: { enterpriseId: '1454', runId } });
/** `history` is the ledger before the probe; the probe adds one correlated
 * agentV2 record and the receipt anchors the prefix that includes it. */
const probeLedger = (history: string[]) => [...history, line('agentV2', '9001')];
const receipt = (history: string[], overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2, batchId: 'batch-r16', probeRunId: '9001', conversationId: '5001',
  auditFile, deployment: { workflowsFile, auditFile, serviceBase, fingerprint: deployment.fingerprint },
  probe: { mode: 'fastgpt-agent-v2', binding: 'v2-binding', verifiedAt: '2026-11-11T00:00:01.000Z' },
  window: { before: history.length, after: history.length + 1, prefixHash: auditPrefixHash(probeLedger(history), history.length + 1) },
  ...overrides });
const expected = { batchId: 'batch-r16', workflowsFile, auditFile, serviceBase,
  deploymentFingerprint: deployment.fingerprint, roundMode: 'xiaok-native-executor-v1' };
const codeOf = (fn: () => unknown, code: string) => assert.throws(fn, (error: AuditSourceError) => error.code === code);

test('a receipt from another batch or deployment is not this round positive control', () => {
  const lines = probeLedger([]);
  codeOf(() => openAuditWindow({ receipt: receipt([], { batchId: 'batch-r15' }), expected, lines }), 'batch_mismatch');
  codeOf(() => openAuditWindow({ receipt: receipt([], { deployment: { workflowsFile, auditFile, serviceBase,
    fingerprint: 'f'.repeat(64) } }), expected, lines }), 'deployment_mismatch');
  const legacy = receipt([]) as Record<string, unknown>;
  delete legacy.schemaVersion;
  codeOf(() => openAuditWindow({ receipt: legacy, expected, lines }), 'receipt_invalid');
});

test('a stale watermark beyond a shortened log is an invalid audit source, not zero calls', () => {
  const stale = receipt([], { window: { before: 98, after: 100, prefixHash: 'a'.repeat(64) } });
  const lines = [line('stage', '7001'), line('agentV2', '9100')];
  codeOf(() => openAuditWindow({ receipt: stale, expected, lines }), 'ledger_truncated');
});

test('a rebuilt log with the same length fails the continuity check', () => {
  const original = [line('stage', '7001')];
  const value = receipt(original);
  const rebuilt = [line('stage', '7002'), line('agentV2', '9001')];
  codeOf(() => openAuditWindow({ receipt: value, expected, lines: rebuilt }), 'ledger_rewritten');
});

test('history before the round window is never attributed to this round', () => {
  const history = [...probeLedger([line('agentV2', '8001'), line('agentV2', '8002')])];
  const value = receipt([line('agentV2', '8001'), line('agentV2', '8002')]);
  const opened = openAuditWindow({ receipt: value, expected, lines: history });
  assert.equal(opened.windowStart, history.length);
  assert.equal(opened.probeRunId, '9001');
  assert.equal(opened.modeTransition, 'fastgpt-agent-v2 -> xiaok-native-executor-v1');
  const entries = auditWindowEntries(history, opened.windowStart);
  assert.deepEqual(entries, []);
  assert.deepEqual(auditKindCounts(entries), {});
  assert.deepEqual(auditNonStageKinds(auditKindCounts(entries)), []);
});

test('a new agentV2 record after the round window is rejected by the zero-call rule', () => {
  const history = [line('stage', '7001')];
  const value = receipt(history);
  const opened = openAuditWindow({ receipt: value, expected, lines: probeLedger(history) });
  const lines = [...probeLedger(history), line('agentV2', '9101')];
  const kinds = auditKindCounts(auditWindowEntries(lines, opened.windowStart));
  assert.deepEqual(kinds, { agentV2: 1 });
  assert.deepEqual(auditNonStageKinds(kinds), ['agentV2']);
});

test('a valid receipt with a continuous log and only stage records passes the round window', () => {
  const history = [line('stage', '7001')];
  const value = receipt(history);
  const opened = openAuditWindow({ receipt: value, expected, lines: probeLedger(history) });
  const lines = [...probeLedger(history), line('stage', '7002')];
  const kinds = auditKindCounts(auditWindowEntries(lines, opened.windowStart));
  assert.deepEqual(kinds, { stage: 1 });
  assert.deepEqual(auditNonStageKinds(kinds), []);
  assert.equal(opened.probeWindow.after, 2);
});

test('deployment identity ignores the runtime switch but not the configured app', () => {
  const switched = { ...workflows, agentV2: { ...workflows.agentV2, runtime: 'langgraph-v1' } };
  assert.equal(auditDeployment(workflowsFile, switched, serviceBase).fingerprint, deployment.fingerprint);
  const changed = { ...workflows, agentV2: { ...workflows.agentV2, appId: 'b'.repeat(24) } };
  assert.notEqual(auditDeployment(workflowsFile, changed, serviceBase).fingerprint, deployment.fingerprint);
});
