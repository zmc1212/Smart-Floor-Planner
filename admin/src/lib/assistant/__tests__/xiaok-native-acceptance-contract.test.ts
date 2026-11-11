import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditKindCounts, auditPrefixHash, auditWindowEntries } from '../fastgpt/agent-v2/audit-window';
import { isNativeExecutor, nativeAuditKindViolations, stageBodyToleratedByLegacyFlag, stageBodyViolations,
  stageFastgptDownNote } from '../fastgpt/agent-v2/native-acceptance';

const native = 'xiaok-native-executor-v1';
const legacy = 'fastgpt-agent-v2-v1';
const line = (kind: string, runId: string) => JSON.stringify({ kind, at: '2026-11-11T00:00:00.000Z',
  value: { enterpriseId: '1454', runId } });

test('native mode ignores the legacy down flag for a failed stage body', () => {
  assert.equal(isNativeExecutor(native), true);
  assert.equal(stageBodyToleratedByLegacyFlag(native, true), false);
  const violations = stageBodyViolations({ reports: [{ bindingId: '422', reportId: '9001',
    bodyStatus: 'failed', bodyError: 'native_model_failed' }], readers: [] });
  assert.ok(violations.length > 0, 'a failed body is a violation even with --stage-fastgpt=down');
  assert.match(violations.join(' '), /body_status=failed/);
  assert.match(violations.join(' '), /body_error=native_model_failed/);
});

test('native mode ignores the legacy down flag for an empty reader body', () => {
  assert.equal(stageBodyToleratedByLegacyFlag(native, true), false);
  const violations = stageBodyViolations({ reports: [{ bindingId: '422', reportId: '9001', bodyStatus: 'succeeded' }],
    readers: [{ kind: 'customer', binding: '422', bodyParts: 0 }] });
  assert.deepEqual(violations, ['customer reader binding 422 body is empty']);
});

test('the down flag and its outage note are honored only in legacy FastGPT V2 mode', () => {
  assert.equal(stageBodyToleratedByLegacyFlag(legacy, true), true);
  assert.equal(stageBodyToleratedByLegacyFlag(legacy, false), false);
  assert.equal(stageBodyToleratedByLegacyFlag('unknown-executor', true), false, 'an unknown executor fails closed');
  assert.equal(stageFastgptDownNote(native, true), undefined);
  assert.match(String(stageFastgptDownNote(legacy, true)), /FastGPT deployment unreachable/);
});

test('a succeeded non-empty native stage body has no violation', () => {
  const violations = stageBodyViolations({
    reports: [{ bindingId: '59', reportId: '9002', bodyStatus: 'succeeded', bodyError: null }],
    readers: [{ kind: 'boss', binding: '59', bodyParts: 3 }] });
  assert.deepEqual(violations, []);
});

test('a succeeded body run carrying an error code is still a violation', () => {
  const violations = stageBodyViolations({ reports: [{ bindingId: '59', reportId: '9002',
    bodyStatus: 'succeeded', bodyError: 'upstream_timeout' }], readers: [{ kind: 'boss', binding: '59', bodyParts: 2 }] });
  assert.deepEqual(violations, ['binding 59 report 9002 body_error=upstream_timeout']);
});

test('a legitimate empty audit delta has no violation', () => {
  assert.deepEqual(nativeAuditKindViolations({}), []);
});

test('a continuous window that gains a stage record violates the native zero-FastGPT claim', () => {
  const history = [line('agentV2', '8001'), line('agentV2', '8002')];
  const window = { windowStart: history.length, windowPrefixHash: auditPrefixHash(history, history.length) };
  const lines = [...history, line('stage', '9001')];
  const entries = auditWindowEntries(lines, window);
  assert.equal(entries.length, 1, 'only the record appended after the window opened is judged');
  const kinds = auditKindCounts(entries);
  assert.deepEqual(kinds, { stage: 1 });
  assert.deepEqual(nativeAuditKindViolations(kinds), ['stage']);
});

test('an unchanged continuous window has an empty delta and no native violation', () => {
  const history = [line('agentV2', '8001')];
  const window = { windowStart: history.length, windowPrefixHash: auditPrefixHash(history, history.length) };
  assert.deepEqual(auditWindowEntries(history, window), []);
  assert.deepEqual(nativeAuditKindViolations(auditKindCounts([])), []);
});
