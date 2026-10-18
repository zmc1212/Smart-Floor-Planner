import assert from 'node:assert/strict';
import { fingerprint, type ActorContext } from '../../src/lib/assistant/contracts';
import { evaluationBatchManifest } from '../../src/lib/assistant/knowledge/evaluation-batch';
import type { BatchExecutionContext, BatchExecutionState, BatchRunReceipt, BatchRunState } from '../../src/lib/assistant/knowledge/batch-execution-adapter';
import type { AcceptanceEvent } from './types';

type Database = { batches: Map<string, BatchExecutionState>; receipts: Map<string, BatchRunReceipt>;
  runs: Map<string, BatchRunState>; reservationStatus: Map<string, string>; markers: Set<string> };
type Transaction = { owner: number; database: Database; release(): void; batchId?: string };
export function createOfflineStore() {
  const actor: ActorContext = { enterpriseId: '1', principal: { kind: 'admin', adminId: '2' }, contextVersion: 1, capabilities: ['assistant.preview.self'] };
  let database: Database = { batches: new Map(), receipts: new Map(), runs: new Map(), reservationStatus: new Map(), markers: new Set() };
  let serial = Promise.resolve(), next = 0, batches = 0;
  const transactions = new Map<number, Transaction>();
  const revision = (context: BatchExecutionContext, model = 'synthetic-default') => fingerprint({ mode: context.mode, model, profile: context.profile, retrieval: context.retrievalConfiguration });
  function prepare() {
    const ordinal = batches++, batchId = 'synthetic-process-' + ordinal;
    const context: BatchExecutionContext = { mode: 'knowledge_preview', profile: { id: '4', hash: fingerprint('synthetic-profile') }, retrievalConfiguration: { version: 'synthetic-offline', limit: 5 } };
    const manifest = evaluationBatchManifest({ batchId, enterpriseId: '1', adminId: '2', knowledgeEpoch: 1, profileId: '4', profileHash: context.profile.hash,
      policyVersion: 1, items: Array.from({ length: 2 }, (_, i) => ({ caseId: String(10 + ordinal * 2 + i), caseVersion: 1, caseRevision: 1,
        evaluationId: String(30 + ordinal * 2 + i), snapshotHash: fingerprint('synthetic-case-' + ordinal + ':' + i) })) }, revision(context));
    database.batches.set(batchId, { receipt: { version: 1, manifest, concurrency: 1 }, current: true, enabled: true, context, cancellation: null,
      items: manifest.items.map((item, i) => ({ ...item, createKey: 'create-' + batchId + ':' + i, sendKey: 'send-' + batchId + ':' + i,
        question: '合成接缝检查，无客户资料', conversationId: null, runId: null })) });
    return manifest;
  }
  const find = (evaluationId: string, db = database) => {
    const state = [...db.batches.values()].find(s => s.items.some(i => i.evaluationId === evaluationId));
    if (!state) throw Error('assistant_resource_not_found');
    return { state, item: state.items.find(i => i.evaluationId === evaluationId)! };
  };
  async function rpc(method: string, input: Record<string, unknown>, owner: number): Promise<unknown> {
    if (method === 'begin') {
      const previous = serial; let release!: () => void; serial = new Promise(resolve => { release = resolve; }); await previous;
      const token = ++next; transactions.set(token, { owner, release, database: structuredClone(database) }); return token;
    }
    if (method === 'find') return { batchId: find(String(input.evaluationId)).state.receipt.manifest.batchId };
    if (method === 'recover') {
      const tx = Number(await rpc('begin', {}, owner));
      try {
        const db = transactions.get(tx)!.database, { item } = find(String(input.evaluationId), db), receipt = db.receipts.get(item.sendKey);
        assert.ok(receipt); assert.equal(receipt.runId, input.expectedRunId); Object.assign(item, receipt);
        await rpc('commit', { tx }, owner); return { evaluationId: item.evaluationId, ...receipt, recovered: true };
      } catch (error) { await rpc('rollback', { tx }, owner); throw error; }
    }
    const token = Number(input.tx), transaction = transactions.get(token);
    if (!transaction || transaction.owner !== owner) throw Error('invalid_transaction_identity');
    const db = transaction.database;
    if (method === 'commit' || method === 'rollback') {
      if (method === 'commit') database = db;
      transactions.delete(token); transaction.release(); return;
    }
    if (method === 'load') { transaction.batchId = String(input.batchId); return db.batches.get(transaction.batchId); }
    if (method === 'revision') return { mode: 'knowledge_preview', revision: revision(input.context as BatchExecutionContext, String(input.model)) };
    if (method === 'lookup') return db.receipts.get((input.value as { sendKey: string }).sendKey) ?? null;
    if (method === 'observe') return db.runs.get((input.value as BatchRunReceipt).runId);
    if (method === 'link') {
      const { item } = find((input.binding as { evaluationId: string }).evaluationId, db);
      Object.assign(item, input.receipt); return;
    }
    if (method === 'intent') {
      const state = db.batches.get(String(input.batchId))!;
      return state.cancellation ??= { batchId: String(input.batchId), manifestHash: state.receipt.manifest.hash, requestKey: String(input.requestKey), cancelled: true };
    }
    if (method === 'dispatch') {
      const value = input.value as { sendKey: string; expectedExecutionRevision: string; batch: { batchId: string } };
      const state = db.batches.get(value.batch.batchId)!;
      if (state.cancellation) throw Error('batch_cancelled');
      if (value.expectedExecutionRevision !== state.receipt.manifest.executionRevision) throw Error('execution_changed');
      const receipt = { conversationId: String(100 + db.runs.size), runId: String(200 + db.runs.size) };
      db.receipts.set(value.sendKey, receipt); db.runs.set(receipt.runId, { status: 'queued', usageKnown: false, awaitingReconciliation: false });
      db.reservationStatus.set(receipt.runId, 'held'); return receipt;
    }
    if (method === 'cancel') {
      const runId = (input.value as BatchRunReceipt).runId, run = db.runs.get(runId)!;
      if (run.status !== 'indeterminate') run.status = 'cancelled';
      db.reservationStatus.set(runId, run.awaitingReconciliation ? 'reconciling' : 'released'); return;
    }
    throw Error('SEAM_UNKNOWN_RPC');
  }
  function snapshot(batchId: string, events: Array<{ name: string }>) {
    const state = database.batches.get(batchId)!, item = state.items[0];
    const known = database.receipts.get(item.sendKey), run = known && database.runs.get(known.runId);
    return { counts: { runs: database.runs.size, jobs: database.runs.size, reservations: database.runs.size, providerAttempts: 0, providerMarkers: database.markers.size },
      intent: state.cancellation, intentCount: Number(Boolean(state.cancellation)), dispatchCalls: events.filter(e => e.name === 'dispatch').length,
      providerFetches: 0, runId: item.runId, conversationId: item.conversationId, createKey: item.createKey, sendKey: item.sendKey,
      runStatus: run?.status, reservationStatus: known && database.reservationStatus.get(known.runId), costMicros: null };
  }
  async function stageUnlinkedReceipt(batchId: string, events: AcceptanceEvent[]) {
    const state = database.batches.get(batchId)!, item = state.items[0];
    assert.equal(item.runId, null); assert.equal(item.conversationId, null);
    const tx = Number(await rpc('begin', {}, -1));
    try {
      events.push({ name: 'dispatch', pid: process.pid, index: -1, commandId: 0 });
      const receipt = await rpc('dispatch', { tx, value: { sendKey: item.sendKey,
        expectedExecutionRevision: state.receipt.manifest.executionRevision, batch: { batchId } } }, -1) as BatchRunReceipt;
      await rpc('commit', { tx }, -1); return receipt;
    } catch (error) { await rpc('rollback', { tx }, -1); throw error; }
  }
  function markOutcomeUnknown(batchId: string) {
    const state = database.batches.get(batchId)!, item = state.items[0], receipt = database.receipts.get(item.sendKey)!;
    assert.equal(item.runId, null); assert.equal(item.conversationId, null);
    const run = database.runs.get(receipt.runId)!;
    run.status = 'indeterminate'; run.awaitingReconciliation = true;
    database.markers.add(receipt.runId);
    database.reservationStatus.set(receipt.runId, 'reconciling');
  }
  return { actor, prepare, rpc, snapshot, stageUnlinkedReceipt, markOutcomeUnknown, activeTransactions: () => transactions.size };
}
