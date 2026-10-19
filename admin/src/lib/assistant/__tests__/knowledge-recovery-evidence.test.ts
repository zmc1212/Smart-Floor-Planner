import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { assertOriginalReceiptRecovery, archivedRecoveryPlan } from '../../../../scripts/assistant-knowledge-revocation';

const snapshot = () => ({ createKey: 'original-create', sendKey: 'original-send', conversationId: '1', messageId: '2', runId: '3', requestHash: 'a'.repeat(64),
  counts: { runs: 1, jobs: 1, reservations: 1, providerAttempts: 0 }, calls: { chunk: 1, embedding: 1, retrieval: 1, model: 1 },
  reservations: [{ status: 'reconciling', settled_tokens: null, settled_cost_micros: null }], costMicros: null });

test('original-receipt lookup rejects changed identities, missing counters and any new effect', () => {
  const before = snapshot(); assertOriginalReceiptRecovery(before, structuredClone(before));
  for (const field of ['createKey','sendKey','conversationId','messageId','runId','requestHash'])
    assert.throws(() => assertOriginalReceiptRecovery(before, { ...before, [field]: 'changed' }));
  for (const field of Object.keys(before.counts) as Array<keyof typeof before.counts>) {
    const bad = structuredClone(before); bad.counts[field]++; assert.throws(() => assertOriginalReceiptRecovery(before, bad));
  }
  assert.throws(() => assertOriginalReceiptRecovery({ ...before, counts: {} }, before));
});
test('recovery cannot silently invoke a provider, release reconciliation or fill unknown fees with zero', () => {
  const before = snapshot();
  for (const field of Object.keys(before.calls) as Array<keyof typeof before.calls>) {
    const bad = structuredClone(before); bad.calls[field]++; assert.throws(() => assertOriginalReceiptRecovery(before, bad));
  }
  assert.throws(() => assertOriginalReceiptRecovery(before, { ...before, reservations: [{ status: 'released', settled_cost_micros: '0' }] }));
  assert.throws(() => assertOriginalReceiptRecovery(before, { ...before, costMicros: 0 }));
});
test('failed/unaccepted attempts do not authorize a new request when the original run is unresolved', () => {
  const plan = archivedRecoveryPlan({ runId: '4369', currentRowExists: false, runStatus: 'indeterminate', reservationStatus: 'reconciling',
    attemptStatus: 'failed', accepted: false, originalSendKey: 'original-send', requestHash: 'a'.repeat(64) });
  assert.equal(plan.dispatchApproved, false); assert.equal(plan.maximumFutureExecutions, 1);
  assert.equal(plan.state, 'archive_only_wait_shared_review'); assert.equal(plan.original.attemptStatus, 'failed'); assert.equal(plan.costMicros, null);
  assert.deepEqual(plan.missingEvidence, ['originalCreateKey']);
});
test('missing archived keys remain missing rather than becoming fabricated recovery identities', () => {
  const plan = archivedRecoveryPlan({ runId: '4242', currentRowExists: false, runStatus: 'indeterminate', reservationStatus: 'reconciling',
    attemptStatus: 'unknown', accepted: true, originalSendKey: null, requestHash: null });
  assert.equal(plan.dispatchApproved, false); assert.equal(plan.originalSendKey, null);
  assert.deepEqual(plan.missingEvidence, ['originalCreateKey', 'originalSendKey', 'requestHash']);
});
test('revocation mode cannot enable paid execution or mix another nonpaid mode', () => {
  for (const args of [['--followup','--revocation-only','--live'],['--followup','--revocation-only','--budget-only'],['--revocation-only']]) {
    const result = spawnSync(process.execPath, ['scripts/assistant-knowledge-semantics-acceptance.mjs',...args,'--connection-file','PRIVATE-MUST-NOT-READ'],
      { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /Followup modes must be explicit and separate/); assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});
