import assert from 'node:assert/strict';

/** Preserve wrapped PostgreSQL codes without logging SQL, parameters or credentials. */
export function safeErrorCode(error, fallback = 'SEAM_ACTION_FAILED') {
  const seen = new Set();
  for (let current = error; current && typeof current === 'object' && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (typeof current.code === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(current.code)) return current.code;
  }
  return typeof error?.message === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(error.message) ? error.message : fallback;
}

const countFields = ['runs', 'jobs', 'reservations', 'providerAttempts', 'providerMarkers'];
export function unchangedEffects(before, after) {
  for (const name of countFields) {
    assert.ok(Number.isSafeInteger(before.counts[name]) && before.counts[name] >= 0, `Missing before ${name}`);
    assert.equal(after.counts[name], before.counts[name], `${name} changed`);
  }
  assert.equal(after.dispatchCalls, before.dispatchCalls, 'Unexpected shared dispatch');
  assert.equal(after.providerFetches, before.providerFetches, 'Unexpected provider HTTP/fetch attempt');
}
export function assertTwoProcesses(pids) {
  assert.equal(pids.length, 2); assert.ok(pids.every(pid => Number.isSafeInteger(pid) && pid > 0));
  assert.notEqual(pids[0], pids[1]);
}
export function assertSameItemOnce(after) {
  assert.equal(after.counts.runs, 1); assert.equal(after.counts.jobs, 1); assert.equal(after.counts.reservations, 1);
  assert.equal(after.counts.providerAttempts, 0); assert.equal(after.dispatchCalls, 1);
  assert.equal(after.counts.providerMarkers, 0); assert.equal(after.providerFetches, 0);
}
export function assertCancellationFence(before, after) {
  assert.ok(before.intent && before.intent.cancelled === true, 'Committed canonical intent missing');
  assert.equal(after.intent?.cancelled, true, 'Committed intent was cleared');
  assert.equal(after.intent?.manifestHash, before.intent.manifestHash);
  assert.equal(after.intent?.requestKey, before.intent.requestKey);
  assert.equal(after.intentCount, 1); unchangedEffects(before, after);
}
export function assertRecovered(original, before, after) {
  assert.equal(before.runId, null, 'Missing association was never exercised');
  unchangedEffects(before, after);
  assert.equal(after.runId, original.runId); assert.equal(after.conversationId, original.conversationId);
  assert.equal(after.createKey, original.createKey); assert.equal(after.sendKey, original.sendKey);
  assert.equal(after.runStatus, before.runStatus);
  assert.equal(after.reservationStatus, before.reservationStatus);
  assert.equal(after.costMicros, null, 'Unknown cost must not be zero-filled');
}
export function assertConfigurationRejected(before, after, result) {
  assert.match(result.beforeRevision, /^[a-f0-9]{64}$/); assert.match(result.afterRevision, /^[a-f0-9]{64}$/);
  assert.notEqual(result.afterRevision, result.beforeRevision, 'Actual deployed revision did not change');
  assert.ok(['execution_changed', 'context_changed'].includes(result.errorCode), 'Wrong rejection boundary');
  unchangedEffects(before, after);
}
