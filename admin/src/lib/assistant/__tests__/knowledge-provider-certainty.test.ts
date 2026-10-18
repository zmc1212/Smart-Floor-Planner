import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { providerFetch } from '@/lib/ai/providers/http';
import { AiProviderError, isSafeProviderFallback } from '@/lib/ai/provider-types';
import { archivedRecoveryPlan, assertOriginalReceiptRecovery } from '../../../../scripts/assistant-knowledge-revocation';

const receipts = () => JSON.parse(fs.readFileSync(path.resolve('scripts/fixtures/assistant-knowledge-recovery-receipts.json'), 'utf8'));

after(async () => {
  if (process.env.XIAOK_KNOWLEDGE_CERTAINTY_OFFLINE_GUARD !== '1') return;
  const { networkReport } = await import('../../../../scripts/knowledge-batch-seam-acceptance/network-guard.mjs');
  const report = networkReport();
  assert.equal(report.databaseConnections, 0); assert.equal(report.providerFetches, 0); assert.equal(report.blockedSockets, 0);
  console.log('KNOWLEDGE_OFFLINE_NETWORK ' + JSON.stringify(report));
});

test('future connection uncertainty reaches knowledge preparation without granting a new provider submission', async t => {
  let simulatedCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { simulatedCalls++; throw new TypeError('synthetic no-response failure'); });
  await assert.rejects(providerFetch('https://synthetic.invalid/knowledge-contract', { method: 'POST', body: '{}' }, 1000, 'Synthetic knowledge'), error => {
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.code, 'PROVIDER_CONNECTION_FAILED'); assert.equal(error.disposition, 'unknown');
    assert.equal(isSafeProviderFallback(error), false);
    const original = receipts().failed;
    const futureOnly = { ...original, attemptStatus: 'unknown' };
    assert.equal(archivedRecoveryPlan(futureOnly).dispatchApproved, false);
    assert.equal(original.attemptStatus, 'failed'); // Do not rewrite the historical attempt to the future classification.
    return true;
  });
  assert.equal(simulatedCalls, 1);
});

test('the formal future classification does not settle the historical failed/unaccepted 4369 receipt', () => {
  const original = receipts().failed, frozen = structuredClone(original), plan = archivedRecoveryPlan(original);
  assert.equal(original.runId, '4369'); assert.equal(original.attemptStatus, 'failed'); assert.equal(original.accepted, false);
  assert.equal(original.runStatus, 'indeterminate'); assert.equal(original.reservationStatus, 'reconciling');
  assert.equal(plan.dispatchApproved, false); assert.equal(plan.state, 'archive_only_wait_shared_review');
  assert.deepEqual(plan.missingEvidence, ['originalCreateKey']); assert.equal(plan.costMicros, null);
  assert.deepEqual(original, frozen);
});

test('4242 retains its unknown attempt and missing original keys after shared integration', () => {
  const original = receipts().historical, frozen = structuredClone(original), plan = archivedRecoveryPlan(original);
  assert.equal(original.runId, '4242'); assert.equal(original.attemptStatus, 'unknown'); assert.equal(original.accepted, true);
  assert.equal(original.runStatus, 'indeterminate'); assert.equal(original.reservationStatus, 'reconciling');
  assert.deepEqual(plan.missingEvidence, ['originalCreateKey', 'originalSendKey', 'requestHash']);
  assert.equal(plan.dispatchApproved, false); assert.equal(plan.maximumFutureExecutions, 1); assert.equal(plan.costMicros, null);
  assert.deepEqual(original, frozen);
});

test('successful independent withdrawal 4370 cannot substitute for unresolved 4369 execution evidence', () => {
  const { failed, independentWithdrawal } = receipts();
  assert.equal(independentWithdrawal.passed, true); assert.equal(independentWithdrawal.runId, '4370');
  assert.notEqual(independentWithdrawal.runId, failed.runId);
  const incompleteOriginal = { createKey: failed.originalCreateKey, sendKey: failed.originalSendKey, requestHash: failed.requestHash,
    conversationId: failed.conversationId, messageId: failed.messageId, runId: failed.runId, costMicros: null };
  assert.throws(() => assertOriginalReceiptRecovery(incompleteOriginal, independentWithdrawal), /RECOVERY_ORIGINAL_EVIDENCE_MISSING/);
  assert.equal(archivedRecoveryPlan(failed).dispatchApproved, false);
});
