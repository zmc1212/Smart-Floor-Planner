import { KnowledgeBatchExecutionAdapter, type KnowledgeBatchExecutionStore, type KnowledgeBatchSharedPort } from '../../src/lib/assistant/knowledge/batch-execution-adapter';
import type { ActorContext } from '../../src/lib/assistant/contracts';
import type { EvaluationBatchManifest } from '../../src/lib/assistant/knowledge/evaluation-batch';
import { safeErrorCode } from './assertions.mjs';

if (!process.send || !['offline', 'service'].includes(process.env.XIAOK_SEAM_MODE || '')) throw Error('SEAM_IPC_BOOT_REQUIRED');
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let sequence = 0, commandId = 0, failCancel = false, closing = false;
let actor: ActorContext, adapter: KnowledgeBatchExecutionAdapter<unknown>;
let operation: { resume(id: string): Promise<unknown>; recoverEvaluation(id: string): Promise<unknown>;
  advanceExecutionBatch(id: string): Promise<unknown>; cancelExecutionBatch(id: string, key: string): Promise<unknown> };
let describe: (batchId: string) => Promise<{ mode: string; revision: string }>;
let shutdown = async () => {};
const safeCode = (error: unknown) => safeErrorCode(error, 'SEAM_CHILD_ACTION_FAILED');
function rpc<T>(method: string, input: unknown): Promise<T> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve: value => resolve(value as T), reject }); process.send!({ type: 'rpc', id, method, input }); });
}
const event = (name: string) => process.send!({ type: 'event', name, commandId });
async function initialize(input: { actor: ActorContext; factoryModule?: string; factoryExport?: string }) {
  actor = input.actor;
  if (process.env.XIAOK_SEAM_MODE === 'offline') {
    const store: KnowledgeBatchExecutionStore<unknown> = {
      actor,
      transaction: async work => {
        const tx = await rpc('begin', {});
        try { const value = await work(tx); await rpc('commit', { tx }); return value; }
        catch (error) { await rpc('rollback', { tx }); throw error; }
      },
      load: (tx, batchId) => rpc('load', { tx, batchId }),
      link: (tx, binding, receipt) => rpc('link', { tx, binding, receipt }),
      persistCancellation: (tx, state, requestKey) => rpc('intent', { tx, batchId: state.receipt.manifest.batchId, requestKey }),
    };
    const shared: KnowledgeBatchSharedPort<unknown> = {
      executionRevision: (tx, _actor, context) => rpc('revision', { tx, context, model: process.env.ASSISTANT_TEXT_MODEL || 'synthetic-default' }),
      lookupReceipt: (tx, _actor, value) => { event('lookup'); return rpc('lookup', { tx, value }); },
      dispatch: (tx, _actor, value) => { event('dispatch'); return rpc('dispatch', { tx, value }); },
      observeRun: (tx, _actor, value) => rpc('observe', { tx, value }),
      cancelRun: (tx, _actor, value) => { event('cancel'); if (failCancel) return Promise.reject(Error('synthetic_cancel_interruption')); return rpc('cancel', { tx, value }); },
    };
    adapter = new KnowledgeBatchExecutionAdapter(store, shared);
    const manifest = async (batchId: string): Promise<EvaluationBatchManifest> => (await adapter.receipt(batchId)).manifest;
    operation = {
      advanceExecutionBatch: batchId => adapter.advance(batchId), cancelExecutionBatch: (batchId, key) => adapter.cancelBatch(batchId, key),
      resume: async evaluationId => { const binding = await rpc<{ batchId: string }>('find', { evaluationId });
        const m = await manifest(binding.batchId); await adapter.resume(m, m.items.find(i => i.evaluationId === evaluationId)!); },
      recoverEvaluation: async evaluationId => {
        const binding = await rpc<{ batchId: string }>('find', { evaluationId }), m = await manifest(binding.batchId);
        const observed = await adapter.observe(m, m.items.find(i => i.evaluationId === evaluationId)!);
        return rpc('recover', { evaluationId, expectedRunId: observed.runId });
      },
    };
    describe = batchId => store.transaction(async tx => shared.executionRevision(tx, actor, (await store.load(tx, batchId)).context));
  } else {
    if (!process.env.XIAOK_SEAM_LOCK_OWNER || !input.factoryModule || !input.factoryExport) throw Error('SEAM_SERVICE_BOOT_REQUIRED');
    await (await import('./postgres-fixture')).assertIsolatedRuntime();
    const importedFactory = await import(input.factoryModule), factory = importedFactory[input.factoryExport];
    if (typeof factory !== 'function') throw Error('SEAM_FACTORY_NOT_READY');
    const raw = await factory();
    for (const method of ['executionRevision', 'lookupReceipt', 'dispatch', 'observeRun', 'cancelRun']) if (typeof raw?.[method] !== 'function') throw Error('SEAM_FACTORY_NOT_READY');
    const port = {
      executionRevision: (...args: unknown[]) => raw.executionRevision(...args),
      lookupReceipt: (...args: unknown[]) => { event('lookup'); return raw.lookupReceipt(...args); },
      dispatch: (...args: unknown[]) => { event('dispatch'); return raw.dispatch(...args); },
      observeRun: (...args: unknown[]) => raw.observeRun(...args),
      cancelRun: (...args: unknown[]) => { event('cancel'); if (failCancel) throw Error('synthetic_cancel_interruption'); return raw.cancelRun(...args); },
    };
    const { KnowledgeOperations } = await import('../../src/lib/assistant/knowledge/operations');
    const { withTenantTransaction } = await import('../../src/db/transaction');
    const { knowledgeManager } = await import('../../src/lib/assistant/knowledge/service');
    const { retrievalConfiguration } = await import('../../src/lib/assistant/knowledge/retrieval');
    const { closePostgresPool } = await import('../../src/lib/postgresql');
    const manager = { enterpriseId: actor.enterpriseId, adminId: (actor.principal as { adminId: string }).adminId };
    const ops = new KnowledgeOperations(manager, port); operation = ops; shutdown = closePostgresPool;
    describe = async batchId => {
      const { manifest } = await ops.executionBatchAdapter().receipt(batchId);
      return withTenantTransaction(actor.enterpriseId, async tx => {
        await knowledgeManager(tx, manager);
        return port.executionRevision(tx, actor, { mode: 'knowledge_preview', profile: { id: manifest.profileId, hash: manifest.profileHash }, retrievalConfiguration });
      });
    };
  }
}
process.on('message', async (message: { type: string; id: number; value?: unknown; error?: string; action?: string; input?: Record<string, string> }) => {
  if (message.type === 'rpc-result') {
    const item = pending.get(message.id); pending.delete(message.id);
    if (message.error) item?.reject(Error(message.error)); else item?.resolve(message.value);
    return;
  }
  if (message.type !== 'command') return;
  commandId = message.id; const input = message.input || {};
  try {
    let value: unknown;
    if (message.action === 'boot') await initialize(input as unknown as Parameters<typeof initialize>[0]);
    else if (message.action === 'shutdown') { await shutdown(); closing = true; process.send!({ type: 'result', id: message.id }); process.disconnect!(); return; }
    else if (message.action === 'advance') value = await operation.advanceExecutionBatch(input.batchId);
    else if (message.action === 'resume') value = await operation.resume(input.evaluationId);
    else if (message.action === 'recover') value = await operation.recoverEvaluation(input.evaluationId);
    else if (message.action === 'network') value = (await import('./network-guard.mjs')).networkReport();
    else if (message.action === 'cancel') { failCancel = input.failCancel === 'true'; try { value = await operation.cancelExecutionBatch(input.batchId, input.requestKey); } finally { failCancel = false; } }
    else if (message.action === 'drift') {
      const before = await describe(input.batchId), prior = process.env.ASSISTANT_TEXT_MODEL;
      try {
        process.env.ASSISTANT_TEXT_MODEL = 'synthetic-seam-drift-no-provider';
        const after = await describe(input.batchId); let errorCode = '';
        try { await operation.advanceExecutionBatch(input.batchId); } catch (error) { errorCode = safeCode(error); }
        value = { beforeRevision: before.revision, afterRevision: after.revision, errorCode };
      } finally { if (prior === undefined) delete process.env.ASSISTANT_TEXT_MODEL; else process.env.ASSISTANT_TEXT_MODEL = prior; }
    } else if (message.action === 'provider-drift') {
      if (process.env.XIAOK_SEAM_MODE !== 'service') throw Error('SEAM_REAL_GATEWAY_DEFERRED');
      const { textGateway } = await import('../../src/lib/assistant/infrastructure/model-gateway');
      const { answerMessages } = await import('../../src/lib/assistant/knowledge/answer');
      const lease = input.lease as unknown as Parameters<typeof textGateway>[0];
      const before = await describe(input.batchId), prior = process.env.ASSISTANT_TEXT_MODEL;
      try {
        process.env.ASSISTANT_TEXT_MODEL = 'synthetic-seam-drift-no-provider';
        const after = await describe(input.batchId); let errorCode = '';
        try { await textGateway(lease).generate({ enterpriseId: actor.enterpriseId,
          owner: { kind: 'assistant_run', runId: BigInt(lease.runId) }, messages: answerMessages('合成接缝，禁止外部模型请求', [], []), maxTokens: 2048 }); }
        catch (error) { errorCode = safeCode(error); }
        value = { beforeRevision: before.revision, afterRevision: after.revision, errorCode };
      } finally { if (prior === undefined) delete process.env.ASSISTANT_TEXT_MODEL; else process.env.ASSISTANT_TEXT_MODEL = prior; }
    } else throw Error('SEAM_UNKNOWN_COMMAND');
    process.send!({ type: 'result', id: message.id, value });
  } catch (error) { process.send!({ type: 'result', id: message.id, error: safeCode(error) }); }
});
process.send({ type: 'ready' });
process.once('disconnect', () => {
  if (closing) return;
  // A lost coordinator must not leave an orphan connected to the isolated DB.
  setTimeout(() => process.exit(1), 1000).unref();
  shutdown().finally(() => process.exit(1));
});
