import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import {
  EvaluationBatchCoordinator, evaluationBatchCases, evaluationBatchManifest,
  type EvaluationBatchManifest, type EvaluationBatchObservation,
  type EvaluationBatchPort, type EvaluationBatchPreparation,
} from '../knowledge/evaluation-batch';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function fixture(size = 5) {
  const preparation: EvaluationBatchPreparation = {
    batchId: 'synthetic-kb-batch', enterpriseId: '10', adminId: '20', knowledgeEpoch: 3,
    profileId: '30', profileHash: fingerprint({ model: 'synthetic-embedding', revision: 1 }), policyVersion: 1,
    items: Array.from({ length: size }, (_, i) => ({ caseId: String(i + 1), caseVersion: 2, caseRevision: 1,
      evaluationId: String(i + 101), snapshotHash: fingerprint({ question: 'synthetic only', i }) })),
  };
  const manifest = evaluationBatchManifest(preparation, fingerprint({ model: 'synthetic-only', prompt: 'preview-v1' }));
  const state = new Map(manifest.items.map(i => [i.evaluationId, {
    evaluationId: i.evaluationId, runId: null, status: 'dispatch_pending', awaitingReconciliation: false,
    usageKnown: false, structuralPassed: null,
  } as EvaluationBatchObservation]));
  const resumed: string[] = [], cancelled: Array<{ id: string; key: string }> = [];
  let preflights = 0;
  const port: EvaluationBatchPort = {
    preflight: async m => { preflights++; assert.equal(m.hash, manifest.hash); },
    observe: async (_m, i) => ({ ...state.get(i.evaluationId)! }),
    resume: async (_m, i) => {
      resumed.push(i.evaluationId);
      const s = state.get(i.evaluationId)!;
      s.runId ??= String(Number(i.evaluationId) + 1000);
      s.status = 'queued';
    },
    cancel: async (_m, i, key) => { cancelled.push({ id: i.evaluationId, key }); state.get(i.evaluationId)!.status = 'cancelled'; },
  };
  const update = (index: number, status: EvaluationBatchObservation['status'], extra: Partial<EvaluationBatchObservation> = {}) => {
    const item = manifest.items[index], s = state.get(item.evaluationId)!;
    Object.assign(s, { status, runId: status === 'dispatch_pending' || status === 'source_changed' ? null : String(Number(item.evaluationId) + 1000) }, extra);
  };
  return { preparation, manifest, port, state, update, resumed, cancelled, preflights: () => preflights };
}

test('batch selection rejects duplicates, arbitrary fields, oversized sets and unsafe identities', () => {
  const valid = [{ caseId: '1', expectedVersion: 1 }];
  assert.deepEqual(evaluationBatchCases(valid), valid);
  for (const bad of [[], Array(51).fill(valid[0]), [valid[0], valid[0]], [{ ...valid[0], tenantId: '2' }],
    [{ caseId: '0', expectedVersion: 1 }], [{ caseId: '9223372036854775808', expectedVersion: 1 }], [{ caseId: '1', expectedVersion: 0 }]]) {
    assert.throws(() => evaluationBatchCases(bad), /invalid_message/);
  }
});

test('manifest binds actor, revisions, source/profile/policy and server execution revision', () => {
  const f = fixture(1), original = f.manifest;
  assert.deepEqual(evaluationBatchManifest(JSON.parse(JSON.stringify(f.preparation)), original.executionRevision), original);
  for (const change of [{ adminId: '21' }, { enterpriseId: '11' }, { knowledgeEpoch: 4 }, { profileHash: fingerprint('new') }, { policyVersion: 2 }]) {
    assert.notEqual(evaluationBatchManifest({ ...f.preparation, ...change }, original.executionRevision).hash, original.hash);
  }
  assert.notEqual(evaluationBatchManifest(f.preparation, fingerprint('new model')).hash, original.hash);
  assert.throws(() => evaluationBatchManifest(f.preparation, 'unknown'), /invalid_message/);
  assert.throws(() => evaluationBatchManifest({ ...f.preparation, items: [f.preparation.items[0], f.preparation.items[0]] }, original.executionRevision), /invalid_message/);
});

test('coordinator rejects corrupt manifests, invalid concurrency and freezes detached input', () => {
  const f = fixture();
  assert.throws(() => new EvaluationBatchCoordinator({ ...f.manifest, knowledgeEpoch: 100 }, f.port), /invalid_batch_manifest/);
  assert.throws(() => new EvaluationBatchCoordinator({ ...f.manifest, version: 2 } as unknown as EvaluationBatchManifest, f.port), /invalid_batch_manifest/);
  for (const n of [0, 5, 1.5, NaN]) assert.throws(() => new EvaluationBatchCoordinator(f.manifest, f.port, n), /invalid_message/);
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port);
  f.manifest.items[0].caseRevision = 20;
  assert.equal(coordinator.manifest.items[0].caseRevision, 1);
  assert.ok(Object.isFrozen(coordinator.manifest.items[0]));
});

test('active runs occupy slots until actually terminal; polling is bounded and stable in selection order', async () => {
  const f = fixture(), coordinator = new EvaluationBatchCoordinator(f.manifest, f.port, 2);
  const first = await coordinator.advance();
  assert.deepEqual(f.resumed, ['101', '102']); assert.equal(first.active, 2); assert.equal(first.counts.dispatch_pending, 3);
  await coordinator.advance(); assert.deepEqual(f.resumed, ['101', '102']);
  f.update(0, 'succeeded', { structuralPassed: true });
  const next = await coordinator.advance();
  assert.deepEqual(f.resumed, ['101', '102', '103']); assert.equal(next.active, 2); assert.equal(next.structuralPassed, 1);
  assert.equal(next.semanticCorrectness, 'requires_review'); assert.equal(next.costMicros, null);
  assert.equal(next.unknownUsageItems, 3); assert.ok(f.preflights() >= 6);
});

test('serialized manifest reentry rereads the same run IDs and does not create duplicate dispatches', async () => {
  const f = fixture(3);
  await new EvaluationBatchCoordinator(f.manifest, f.port, 2).advance();
  const reopened = new EvaluationBatchCoordinator(JSON.parse(JSON.stringify(f.manifest)), f.port, 2);
  const result = await reopened.advance();
  assert.deepEqual(f.resumed, ['101', '102']); assert.equal(result.items[0].runId, '1101');
  f.update(0, 'succeeded'); f.update(1, 'failed');
  await reopened.advance(); assert.deepEqual(f.resumed, ['101', '102', '103']);
});

for (const [status, extra] of [
  ['indeterminate', {}], ['failed', { awaitingReconciliation: true }],
  ['cancelled', { awaitingReconciliation: true }], ['dispatch_pending', { awaitingReconciliation: true }],
] as const) test(`${status} with an unresolved outcome consumes capacity and is never automatically retried`, async () => {
  const f = fixture(2); f.update(0, status, extra);
  const result = await new EvaluationBatchCoordinator(f.manifest, f.port, 1).advance();
  assert.deepEqual(f.resumed, []); assert.equal(result.needsReconciliation, 1); assert.equal(result.completed, false);
});

test('reopened runs already above the requested cap cause no additional dispatch', async () => {
  const f = fixture(4); f.update(0, 'running'); f.update(1, 'queued'); f.update(2, 'running');
  const result = await new EvaluationBatchCoordinator(f.manifest, f.port, 1).advance();
  assert.equal(result.active, 3); assert.deepEqual(f.resumed, []);
});

test('a failed observation blocks all dispatch and drains reads before rejecting', async () => {
  const f = fixture(3), gate = deferred(), entered = deferred();
  const original = f.port.observe;
  f.port.observe = async (m, i) => {
    if (i.evaluationId === '101') { entered.resolve(); await gate.promise; return original(m, i); }
    throw Error('synthetic read unavailable');
  };
  let settled = false;
  const work = new EvaluationBatchCoordinator(f.manifest, f.port).advance().finally(() => { settled = true; });
  await entered.promise; await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(f.resumed, []);
  gate.resolve(); await assert.rejects(work, /synthetic read unavailable/);
});

for (const reason of ['assistant_capability_forbidden', 'context_changed', 'execution_revision_changed']) {
  test(`${reason} fails closed before dispatch`, async () => {
    const f = fixture(); f.port.preflight = async () => { throw Error(reason); };
    await assert.rejects(new EvaluationBatchCoordinator(f.manifest, f.port).advance(), new RegExp(reason));
    assert.deepEqual(f.resumed, []);
  });
}

test('source invalidation returns no old run, answer, diagnostic, professional review or raw errors', async () => {
  const f = fixture(1); f.update(0, 'source_changed', { runId: '999', structuralPassed: null });
  const original = f.port.observe;
  f.port.observe = async (m, i) => ({ ...await original(m, i), answer: 'secret old answer', review: 'old review', diagnostic: 'old sources' });
  const result = await new EvaluationBatchCoordinator(f.manifest, f.port).advance();
  assert.equal(result.items[0].runId, null); assert.equal(result.structuralPassed, 0);
  assert.equal(result.unknownUsageItems, 0, 'a hidden source alone is not evidence of a model/usage attempt');
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('old review'));
  assert.deepEqual(f.resumed, []);
});

test('wrong evaluation/run identities or invalid status evidence are rejected before any dispatch', async () => {
  for (const change of [{ evaluationId: '999' }, { status: 'invented' }, { runId: '0' }, { structuralPassed: true }]) {
    const f = fixture(1); f.update(0, 'running');
    const original = f.port.observe;
    f.port.observe = async (m, i) => ({ ...await original(m, i), ...change } as EvaluationBatchObservation);
    await assert.rejects(new EvaluationBatchCoordinator(f.manifest, f.port).advance()); assert.deepEqual(f.resumed, []);
  }
});

test('cancel before dispatch pauses waiting evaluations without inventing cancelled runs', async () => {
  const f = fixture(3), coordinator = new EvaluationBatchCoordinator(f.manifest, f.port);
  coordinator.requestCancel(); const result = await coordinator.advance();
  assert.deepEqual(f.resumed, []); assert.deepEqual(f.cancelled, []);
  assert.equal(result.counts.cancelled, 0); assert.equal(result.counts.dispatch_pending, 3);
  assert.equal(result.cancelRequested, true); assert.equal(result.completed, false);
});

test('cancel during a resume cancels its late known run and never starts the remaining items', async () => {
  const f = fixture(3), entered = deferred(), gate = deferred(), original = f.port.resume;
  f.port.resume = async (m, i) => { entered.resolve(); await gate.promise; await original(m, i); };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port, 1), work = coordinator.advance();
  await entered.promise; coordinator.requestCancel(); gate.resolve();
  const result = await work;
  assert.deepEqual(f.resumed, ['101']); assert.equal(f.cancelled.length, 1); assert.equal(result.items[0].status, 'cancelled');
  assert.equal(result.items[1].status, 'dispatch_pending');
  await coordinator.advance(); assert.deepEqual(f.resumed, ['101']);
  // Explicitly constructing a fresh controller continues the same prepared pending IDs.
  await new EvaluationBatchCoordinator(f.manifest, f.port, 1).advance(); assert.deepEqual(f.resumed, ['101', '102']);
});

test('cancel arriving during preflight prevents the dispatch it guarded', async () => {
  const f = fixture(1), entered = deferred(), gate = deferred(); let calls = 0;
  f.port.preflight = async () => { if (++calls === 2) { entered.resolve(); await gate.promise; } };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port, 1), work = coordinator.advance();
  await entered.promise; coordinator.requestCancel(); gate.resolve();
  await work; assert.deepEqual(f.resumed, []);
});

test('unknown outcomes are not retried/cancelled; uncertain costs and reservations stay explicit', async () => {
  const f = fixture(2); f.update(0, 'indeterminate', { awaitingReconciliation: true });
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port); coordinator.requestCancel();
  const result = await coordinator.advance();
  assert.deepEqual(f.cancelled, []); assert.deepEqual(f.resumed, []);
  assert.equal(result.needsReconciliation, 1); assert.equal(result.unknownUsageItems, 1); assert.equal(result.costMicros, null);
});

test('lost resume receipt is reread, never silently reported as a confirmed action or automatically reissued', async () => {
  const f = fixture(2), original = f.port.resume;
  f.port.resume = async (m, i) => { await original(m, i); throw Error('secret vendor body'); };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port, 1);
  const result = await coordinator.advance();
  assert.equal(result.items[0].status, 'queued'); assert.equal(result.items[0].action, 'unconfirmed');
  assert.ok(!JSON.stringify(result).includes('secret')); assert.deepEqual(f.resumed, ['101']);
  await coordinator.advance(); assert.deepEqual(f.resumed, ['101']);
});

test('cancel receipt loss needs a later confirmed read and preserves the same cancellation key', async () => {
  const f = fixture(1); f.update(0, 'running'); let acknowledge = false;
  f.port.cancel = async (_m, i, requestKey) => {
    f.cancelled.push({ id: i.evaluationId, key: requestKey });
    if (!acknowledge) throw Error('synthetic network loss');
    f.update(0, 'cancelled');
  };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port); coordinator.requestCancel();
  const first = await coordinator.advance(); assert.equal(first.unconfirmed, 1); assert.equal(first.completed, false);
  acknowledge = true;
  const second = await coordinator.advance(); assert.equal(second.counts.cancelled, 1); assert.equal(second.completed, true);
  assert.equal(f.cancelled[0].key, f.cancelled[1].key);
});

test('overlapping sweeps are rejected and the original sweep remains usable afterwards', async () => {
  const f = fixture(1), gate = deferred(), entered = deferred(); let first = true;
  f.port.preflight = async () => { if (first) { first = false; entered.resolve(); await gate.promise; } };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port), work = coordinator.advance();
  await entered.promise; await assert.rejects(coordinator.advance(), /batch_busy/); gate.resolve();
  await work; await coordinator.advance(); assert.deepEqual(f.resumed, ['101']);
});

test('cancellation cannot replace the immutable run identity with another valid run ID', async () => {
  const f = fixture(1); f.update(0, 'running');
  f.port.cancel = async () => { f.update(0, 'cancelled', { runId: '9999' }); };
  const coordinator = new EvaluationBatchCoordinator(f.manifest, f.port); coordinator.requestCancel();
  await assert.rejects(coordinator.advance(), /invalid_batch_observation/);
});

test('a sibling preflight failure drains an already-started resume before rejecting', async () => {
  const f = fixture(2), entered = deferred(), gate = deferred(); let calls = 0, mutated = false, settled = false;
  f.port.preflight = async () => { if (++calls === 3) throw Error('synthetic preflight failure'); };
  f.port.resume = async () => { entered.resolve(); await gate.promise; mutated = true; };
  const work = new EvaluationBatchCoordinator(f.manifest, f.port, 2).advance().finally(() => { settled = true; });
  await entered.promise; await Promise.resolve(); assert.equal(settled, false); assert.equal(mutated, false);
  gate.resolve(); await assert.rejects(work, /synthetic preflight failure/); assert.equal(mutated, true);
});

test('revocation during mutation makes the response unavailable instead of returning cached progress', async () => {
  const f = fixture(1), original = f.port.resume; let revoked = false;
  f.port.resume = async (m, i) => { await original(m, i); revoked = true; };
  f.port.preflight = async () => { if (revoked) throw Error('assistant_capability_forbidden'); };
  await assert.rejects(new EvaluationBatchCoordinator(f.manifest, f.port).advance(), /assistant_capability_forbidden/);
});

test('all settled observations finish execution without claiming semantic or billing approval', async () => {
  const f = fixture(3); f.update(0, 'succeeded', { structuralPassed: true, usageKnown: true });
  f.update(1, 'failed'); f.update(2, 'cancelled');
  const result = await new EvaluationBatchCoordinator(f.manifest, f.port).advance();
  assert.equal(result.completed, true); assert.equal(result.settled, 3); assert.equal(result.structuralPassed, 1);
  assert.equal(result.semanticCorrectness, 'requires_review'); assert.equal(result.costMicros, null);
});

// These are deterministic port simulations. They do not certify DB authorization,
// distributed fencing, model output, provider billing, or the Mini Program flow.
