import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, type ActorContext } from '../contracts';
import { evaluationBatchManifest, EvaluationBatchCoordinator, type EvaluationBatchObservation } from '../knowledge/evaluation-batch';
import { KnowledgeBatchExecutionAdapter, executionCancelOperation, type BatchExecutionState, type BatchRunReceipt,
  type BatchRunState, type KnowledgeBatchSharedPort, type KnowledgeBatchExecutionStore } from '../knowledge/batch-execution-adapter';

type Database = { state: BatchExecutionState; receipts: Map<string, BatchRunReceipt>; runs: Map<string, BatchRunState> };
type Tx = { database: Database; token: number };
function fixture(count = 3, concurrency = 2) {
  const revision = fingerprint('synthetic deployed preview configuration');
  const actor: ActorContext = { enterpriseId: '1', principal: { kind: 'admin', adminId: '2' }, contextVersion: 1, capabilities: ['assistant.preview.self'] };
  const preparation = { batchId: 'synthetic-batch', enterpriseId: '1', adminId: '2', knowledgeEpoch: 3,
    profileId: '4', profileHash: fingerprint('profile'), policyVersion: 5,
    items: Array.from({ length: count }, (_, i) => ({ caseId: String(10 + i), caseVersion: 1, caseRevision: 1,
      evaluationId: String(20 + i), snapshotHash: fingerprint('snapshot' + i) })) };
  const manifest = evaluationBatchManifest(preparation, revision);
  let database: Database = { state: { receipt: { version: 1, manifest, concurrency }, enabled: true, current: true,
    context: { mode: 'knowledge_preview', profile: { id: preparation.profileId, hash: preparation.profileHash },
      retrievalConfiguration: { version: 'synthetic-retrieval', limit: 5 } }, cancellation: null,
    items: manifest.items.map((item, i) => ({ ...item, createKey: 'create-' + i, sendKey: 'send-' + i,
      question: '合成问题' + i, conversationId: null, runId: null })) }, receipts: new Map(), runs: new Map() };
  let queue = Promise.resolve(), next = 0;
  const active = new Set<Tx>(), calls: Array<{ name: string; tx: number; input?: unknown }> = [];
  const controls = { allowed: true, participant: true, revision, failLink: false, failCancel: false, lateRevisionChange: false };
  const record = (name: string, tx: Tx, input?: unknown) => {
    assert.ok(active.has(tx), 'Every shared/store operation uses the exact caller transaction');
    calls.push({ name, tx: tx.token, input });
  };
  const store: KnowledgeBatchExecutionStore<Tx> = {
    actor,
    async transaction(work) {
      const previous = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const tx = { database: structuredClone(database), token: ++next }; active.add(tx);
      try { if (!controls.allowed) throw Error('assistant_resource_not_found'); const result = await work(tx); database = tx.database; return result; }
      finally { active.delete(tx); release(); }
    },
    async load(tx) { record('load', tx); return tx.database.state; },
    async link(tx, binding, receipt) {
      record('link', tx, receipt); if (controls.failLink) throw Error('synthetic_link_failure');
      Object.assign(tx.database.state.items.find(i => i.evaluationId === binding.evaluationId)!, receipt);
    },
    async persistCancellation(tx, state, requestKey) {
      record('intent', tx);
      return tx.database.state.cancellation ??= { batchId: manifest.batchId, manifestHash: state.receipt.manifest.hash, requestKey, cancelled: true };
    },
  };
  const shared: KnowledgeBatchSharedPort<Tx> = {
    async executionRevision(tx, _actor, context) { record('revision', tx, context); return { mode: 'knowledge_preview', revision: controls.revision }; },
    async lookupReceipt(tx, _actor, input) {
      record('lookup', tx, input); if (!controls.participant) throw Error('assistant_resource_not_found');
      return tx.database.receipts.get(input.sendKey) ?? null;
    },
    async dispatch(tx, _actor, input) {
      record('dispatch', tx, input);
      if (controls.lateRevisionChange) controls.revision = fingerprint('changed after preparation');
      if (input.expectedExecutionRevision !== controls.revision) throw Error('execution_changed');
      if (tx.database.state.cancellation) throw Error('batch_cancelled');
      const receipt = { conversationId: String(100 + tx.database.runs.size), runId: String(200 + tx.database.runs.size) };
      tx.database.receipts.set(input.sendKey, receipt);
      tx.database.runs.set(receipt.runId, { status: 'queued', awaitingReconciliation: false, usageKnown: false });
      return receipt;
    },
    async observeRun(tx, _actor, receipt) {
      record('observe', tx, receipt); if (!controls.participant) throw Error('assistant_resource_not_found');
      return tx.database.runs.get(receipt.runId)!;
    },
    async cancelRun(tx, _actor, input) {
      record('cancel', tx, input); if (!controls.participant) throw Error('assistant_resource_not_found');
      if (controls.failCancel) throw Error('PRIVATE_VENDOR_ERROR');
      const run = tx.database.runs.get(input.runId)!;
      // Simulated existing service semantics: cancellation never clears prior uncertainty.
      if (!run.awaitingReconciliation && run.status !== 'indeterminate') run.status = 'cancelled';
    },
  };
  const adapter = () => new KnowledgeBatchExecutionAdapter(store, shared);
  return { manifest, store, shared, adapter, controls, calls, get database() { return database; } };
}

test('atomic dispatch passes original keys, preview context, revision and durable cancellation identity', async () => {
  const f = fixture(); await f.adapter().resume(f.manifest, f.manifest.items[0]);
  const dispatch = f.calls.find(c => c.name === 'dispatch')!;
  const input = dispatch.input as Parameters<typeof f.shared.dispatch>[2];
  assert.equal(input.createKey, 'create-0'); assert.equal(input.sendKey, 'send-0');
  assert.equal(input.expectedExecutionRevision, f.manifest.executionRevision);
  assert.deepEqual(input.content, { version: 1, blocks: [{ type: 'text', text: '合成问题0' }] });
  assert.deepEqual(input.batch.cancellation, { operation: executionCancelOperation, key: f.manifest.batchId,
    principalKey: 'admin:2', manifestHash: f.manifest.hash });
  assert.equal(f.calls.find(c => c.name === 'link')!.tx, dispatch.tx);
  assert.equal(f.calls.find(c => c.name === 'revision')!.tx, dispatch.tx);
});

test('link failure rolls back the simulated send/run together without a second transaction', async () => {
  const f = fixture(); f.controls.failLink = true;
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[0]), /synthetic_link_failure/);
  assert.equal(f.database.runs.size, 0); assert.equal(f.database.receipts.size, 0);
  assert.equal(f.database.state.items[0].runId, null);
});

test('two controllers resuming the same item keep one original run and receipt', async () => {
  const f = fixture();
  await Promise.all([f.adapter().resume(f.manifest, f.manifest.items[0]), f.adapter().resume(f.manifest, f.manifest.items[0])]);
  assert.equal(f.database.runs.size, 1); assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('a returned run cannot replace an already known conversation binding', async () => {
  const f = fixture(); f.database.state.items[0].conversationId = '99';
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[0]), /invalid_batch_receipt/);
  assert.equal(f.database.runs.size, 0); assert.equal(f.database.state.items[0].conversationId, '99');
});

test('lost evaluation association is observed read-only and resumed only by linking the original receipt', async () => {
  const f = fixture(); await f.adapter().resume(f.manifest, f.manifest.items[0]);
  Object.assign(f.database.state.items[0], { conversationId: null, runId: null });
  const observation = await f.adapter().observe(f.manifest, f.manifest.items[0]);
  assert.equal(observation.runId, '200'); assert.equal(f.database.state.items[0].runId, null);
  await f.adapter().resume(f.manifest, f.manifest.items[0]);
  assert.equal(f.database.state.items[0].runId, '200');
  assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('source, policy/profile freshness, disabled state and execution drift reject before dispatch', async () => {
  for (const change of ['current', 'enabled', 'revision'] as const) {
    const f = fixture();
    if (change === 'revision') f.controls.revision = fingerprint('new actual model'); else f.database.state[change] = false;
    await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[0]), /context_changed|assistant_disabled|execution_changed/);
    assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 0); assert.equal(f.database.runs.size, 0);
  }
});

test('shared port can reject a late actual execution change atomically using the expected revision', async () => {
  const f = fixture(); f.controls.lateRevisionChange = true;
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[0]), /execution_changed/);
  assert.equal(f.database.runs.size, 0); assert.equal(f.database.state.items[0].runId, null);
});

test('two adapter instances respect frozen concurrency under the simulated shared transaction lock', async () => {
  const f = fixture(2, 1);
  const result = await Promise.allSettled([f.adapter().resume(f.manifest, f.manifest.items[0]), f.adapter().resume(f.manifest, f.manifest.items[1])]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.database.runs.size, 1); assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('unknown or reconciling prior runs occupy capacity and are never redispatched', async () => {
  const f = fixture(2, 1); await f.adapter().resume(f.manifest, f.manifest.items[0]);
  Object.assign(f.database.runs.get('200')!, { status: 'indeterminate', awaitingReconciliation: true });
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[1]), /batch_concurrency_limit/);
  await f.adapter().resume(f.manifest, f.manifest.items[0]);
  assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('uncertain or malformed shared reads cannot become an absent run or a free slot', async () => {
  const missing = fixture();
  missing.shared.lookupReceipt = async () => undefined as unknown as null;
  await assert.rejects(missing.adapter().resume(missing.manifest, missing.manifest.items[0]), /invalid_batch_receipt/);
  assert.equal(missing.calls.filter(c => c.name === 'dispatch').length, 0);
  const bad = fixture(); await bad.adapter().resume(bad.manifest, bad.manifest.items[0]);
  bad.shared.observeRun = async () => ({ status: 'unrecognized', awaitingReconciliation: false, usageKnown: true } as unknown as BatchRunState);
  await assert.rejects(bad.adapter().resume(bad.manifest, bad.manifest.items[1]), /invalid_batch_observation/);
  assert.equal(bad.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('persisted whole-batch cancellation blocks a second controller before any send', async () => {
  const f = fixture();
  await f.adapter().cancelBatch(f.manifest.batchId, 'first-cancel');
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[0]), /batch_cancelled/);
  const again = await f.adapter().cancelBatch(f.manifest.batchId, 'different-client-key');
  assert.equal(again.requestKey, 'first-cancel'); assert.equal(f.database.runs.size, 0);
  assert.ok(again.items.every(i => i.action === 'not_dispatched'));
  const progress = await new EvaluationBatchCoordinator(f.manifest, f.adapter()).advance();
  assert.equal(progress.counts.cancelled, 3); assert.ok(progress.completed);
  assert.ok(progress.items.every(i => i.cancelledBeforeDispatch && i.runId === null));
});

test('runless cancellation needs explicit persisted-before-dispatch proof and no unresolved usage', async () => {
  for (const bad of ['missing-proof', 'unknown-usage', 'linked-proof'] as const) {
    const f = fixture(1);
    const value: EvaluationBatchObservation = { evaluationId: f.manifest.items[0].evaluationId, runId: bad === 'linked-proof' ? '200' : null,
      status: 'cancelled', awaitingReconciliation: bad === 'unknown-usage', usageKnown: true, structuralPassed: null,
      ...(bad !== 'missing-proof' ? { cancelledBeforeDispatch: true as const } : {}) };
    await assert.rejects(new EvaluationBatchCoordinator(f.manifest, { preflight: async () => {}, observe: async () => value,
      resume: async () => { throw Error('must not dispatch'); }, cancel: async () => {} }).advance(), /invalid_batch_observation/);
  }
});

test('advance/cancel order is serialized in both orders without reopening pending items', async () => {
  for (const cancelFirst of [true, false]) {
    const f = fixture(2, 1);
    const cancel = () => f.adapter().cancelBatch(f.manifest.batchId, 'cancel-race');
    const resume = () => f.adapter().resume(f.manifest, f.manifest.items[0]);
    await Promise.allSettled(cancelFirst ? [cancel(), resume()] : [resume(), cancel()]);
    await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[1]), /batch_cancelled/);
    assert.equal(f.calls.filter(c => c.name === 'dispatch').length, cancelFirst ? 0 : 1);
    assert.ok([...f.database.runs.values()].every(r => r.status === 'cancelled'));
  }
});

test('withdrawal, policy disable and execution drift do not prevent known-run cancellation or receipt recovery', async () => {
  const f = fixture(); await f.adapter().resume(f.manifest, f.manifest.items[0]);
  Object.assign(f.database.state.items[0], { runId: null, conversationId: null });
  f.database.state.current = false; f.database.state.enabled = false; f.controls.revision = fingerprint('changed');
  const count = f.calls.filter(c => c.name === 'revision').length;
  const result = await f.adapter().cancelBatch(f.manifest.batchId, 'cancel-after-source-change');
  assert.equal(result.items[0].action, 'cancel_requested'); assert.equal(f.database.state.items[0].runId, '200');
  assert.equal(f.database.runs.get('200')!.status, 'cancelled');
  assert.equal(f.calls.filter(c => c.name === 'revision').length, count);
  assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 1);
});

test('withdrawal after cancellation cannot be reported as a freshly completed advance', async () => {
  const f = fixture(); await f.adapter().cancelBatch(f.manifest.batchId, 'cancel-before-withdrawal');
  f.database.state.current = false;
  await assert.rejects(f.adapter().advance(f.manifest.batchId), /context_changed/);
  assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 0);
});

test('cancel failure retains its already committed intent and returns no vendor/private error', async () => {
  const f = fixture(); await f.adapter().resume(f.manifest, f.manifest.items[0]); f.controls.failCancel = true;
  const result = await f.adapter().cancelBatch(f.manifest.batchId, 'cancel-failure');
  assert.equal(result.items[0].action, 'unconfirmed'); assert.ok(f.database.state.cancellation);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VENDOR_ERROR|合成问题/);
  await assert.rejects(f.adapter().resume(f.manifest, f.manifest.items[1]), /batch_cancelled/);
});

test('cancellation preserves indeterminate status and earlier unsettled usage/cost', async () => {
  const f = fixture(); await f.adapter().resume(f.manifest, f.manifest.items[0]);
  Object.assign(f.database.runs.get('200')!, { status: 'indeterminate', awaitingReconciliation: true, usageKnown: false });
  const result = await f.adapter().cancelBatch(f.manifest.batchId, 'cancel-unknown');
  const observation = await f.adapter().observe(f.manifest, f.manifest.items[0]);
  assert.equal(observation.status, 'indeterminate'); assert.ok(observation.awaitingReconciliation);
  assert.equal(observation.usageKnown, false); assert.equal(result.costMicros, null);
});

test('tenant/owner/item tampering and revoked current permissions cannot reach shared dispatch', async () => {
  for (const change of ['tenant', 'owner', 'item', 'manifest', 'role', 'participant'] as const) {
    const f = fixture(); const manifest = structuredClone(f.manifest), item = structuredClone(manifest.items[0]);
    if (change === 'tenant') f.store.actor.enterpriseId = '9';
    if (change === 'owner') f.store.actor.principal = { kind: 'admin', adminId: '9' };
    if (change === 'item') item.snapshotHash = fingerprint('forged');
    if (change === 'manifest') manifest.executionRevision = fingerprint('forged');
    if (change === 'role') f.controls.allowed = false;
    if (change === 'participant') f.controls.participant = false;
    await assert.rejects(f.adapter().resume(manifest, item));
    assert.equal(f.calls.filter(c => c.name === 'dispatch').length, 0);
  }
});
