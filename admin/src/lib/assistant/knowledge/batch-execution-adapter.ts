import { fail, fingerprint, id, key, principalKey, type ActorContext, type MessageContent } from '../contracts';
import { evaluationBatchManifest, EvaluationBatchCoordinator, type EvaluationBatchManifest, type EvaluationBatchItem,
  type EvaluationBatchObservation, type EvaluationBatchPort } from './evaluation-batch';

export const executionPrepareOperation = 'knowledge-batch-execution-prepare';
export const executionCancelOperation = 'knowledge-batch-execution-cancel';
export type BatchExecutionContext = {
  mode: 'knowledge_preview';
  profile: { id: string; hash: string };
  retrievalConfiguration: Readonly<Record<string, string | number | boolean | null>>;
};
export type BatchExecutionReceipt = { version: 1; manifest: EvaluationBatchManifest; concurrency: number };
export type BatchCancellationIntent = { batchId: string; manifestHash: string; requestKey: string; cancelled: true };
export type BatchRunReceipt = { conversationId: string; runId: string };
export type BatchItemBinding = EvaluationBatchItem & {
  createKey: string; sendKey: string; question: string; conversationId: string | null; runId: string | null;
};
export type BatchCancellationFence = {
  operation: typeof executionCancelOperation; key: string; principalKey: string; manifestHash: string;
};
export type BatchRunState = {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate';
  awaitingReconciliation: boolean; usageKnown: boolean;
};

/** Business-owned implementation: every method uses exactly the supplied transaction.
 * No nested ConversationService transaction, HTTP, Worker start or model retry.
 * executionRevision must resolve real deployed preview provider/model/prompt/generation
 * and the supplied profile/retrieval configuration, with credentials excluded.
 * Construct lazily: receipt/cancel operations must not require current provider
 * configuration or source freshness; current identity/participation still applies.
 */
export interface KnowledgeBatchSharedPort<Tx> {
  executionRevision(tx: Tx, actor: ActorContext, context: BatchExecutionContext): Promise<{ mode: 'knowledge_preview'; revision: string }>;
  /** null means a successful authoritative absence; uncertainty/errors must throw.
   * Retention expiry does not authorize treating a committed send as absent. */
  lookupReceipt(tx: Tx, actor: ActorContext, input: {
    createKey: string; sendKey: string; conversationId: string | null; content: MessageContent;
  }): Promise<BatchRunReceipt | null>;
  dispatch(tx: Tx, actor: ActorContext, input: {
    createKey: string; sendKey: string; conversationId: string | null; content: MessageContent;
    expectedExecutionRevision: string; context: BatchExecutionContext;
    batch: { batchId: string; evaluationId: string; manifestHash: string; cancellation: BatchCancellationFence };
  }): Promise<BatchRunReceipt>;
  observeRun(tx: Tx, actor: ActorContext, receipt: BatchRunReceipt): Promise<BatchRunState>;
  cancelRun(tx: Tx, actor: ActorContext, input: BatchRunReceipt & { requestKey: string }): Promise<void>;
}

export type BatchExecutionState = {
  receipt: BatchExecutionReceipt; context: BatchExecutionContext; current: boolean; enabled: boolean;
  items: BatchItemBinding[]; cancellation: BatchCancellationIntent | null;
};
/** Knowledge-owned store. transaction serializes on the original enterprise settings row.
 * load authorizes the current manager/owner and validates server receipts/item bindings.
 */
export interface KnowledgeBatchExecutionStore<Tx> {
  actor: ActorContext;
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  load(tx: Tx, batchId: string): Promise<BatchExecutionState>;
  link(tx: Tx, binding: BatchItemBinding, receipt: BatchRunReceipt): Promise<void>;
  persistCancellation(tx: Tx, state: BatchExecutionState, requestKey: string): Promise<BatchCancellationIntent>;
}

const content = (binding: BatchItemBinding): MessageContent => ({ version: 1, blocks: [{ type: 'text', text: binding.question }] });
const occupied = (run: BatchRunState) => run.status === 'queued' || run.status === 'running'
  || run.status === 'indeterminate' || run.awaitingReconciliation;

/** Server-side adapter only. The shared port remains deliberately uninvented/unwired. */
export class KnowledgeBatchExecutionAdapter<Tx> implements EvaluationBatchPort {
  constructor(private readonly store: KnowledgeBatchExecutionStore<Tx>, private readonly shared: KnowledgeBatchSharedPort<Tx>) {}

  private async state(tx: Tx, manifest: EvaluationBatchManifest) {
    const checked = evaluationBatchManifest(manifest, manifest.executionRevision);
    if (manifest.version !== 1 || checked.hash !== manifest.hash) fail('invalid_batch_manifest');
    const state = await this.store.load(tx, manifest.batchId);
    if (state.receipt.manifest.hash !== checked.hash || state.receipt.manifest.enterpriseId !== this.store.actor.enterpriseId
      || this.store.actor.principal.kind !== 'admin' || state.receipt.manifest.adminId !== this.store.actor.principal.adminId)
      fail('assistant_resource_not_found', 404);
    return state;
  }
  private binding(state: BatchExecutionState, item: EvaluationBatchItem) {
    const binding = state.items.find(i => i.evaluationId === item.evaluationId);
    if (!binding || binding.caseId !== item.caseId || binding.caseVersion !== item.caseVersion
      || binding.caseRevision !== item.caseRevision || binding.snapshotHash !== item.snapshotHash) fail('invalid_batch_manifest');
    return binding;
  }
  private checkedReceipt(binding: BatchItemBinding, receipt: BatchRunReceipt): BatchRunReceipt {
    id(receipt.conversationId); id(receipt.runId);
    if (binding.conversationId && binding.conversationId !== receipt.conversationId
      || binding.runId && binding.runId !== receipt.runId) fail('invalid_batch_receipt');
    return { conversationId: receipt.conversationId, runId: receipt.runId };
  }
  private async lookup(tx: Tx, binding: BatchItemBinding) {
    if (binding.runId) {
      if (!binding.conversationId) fail('invalid_batch_receipt');
      return this.checkedReceipt(binding, { conversationId: binding.conversationId, runId: binding.runId });
    }
    const receipt = await this.shared.lookupReceipt(tx, this.store.actor, {
      createKey: binding.createKey, sendKey: binding.sendKey, conversationId: binding.conversationId, content: content(binding),
    });
    if (receipt === null) return null;
    if (!receipt) fail('invalid_batch_receipt');
    return this.checkedReceipt(binding, receipt);
  }
  private async runState(tx: Tx, receipt: BatchRunReceipt): Promise<BatchRunState> {
    const run = await this.shared.observeRun(tx, this.store.actor, receipt);
    if (!run || !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'indeterminate'].includes(run.status)
      || typeof run.awaitingReconciliation !== 'boolean' || typeof run.usageKnown !== 'boolean') fail('invalid_batch_observation');
    return { status: run.status, awaitingReconciliation: run.awaitingReconciliation, usageKnown: run.usageKnown };
  }
  private async current(tx: Tx, state: BatchExecutionState) {
    if (!state.enabled) fail('assistant_disabled', 403);
    if (!state.current) fail('context_changed');
    const execution = await this.shared.executionRevision(tx, this.store.actor, state.context);
    if (execution.mode !== 'knowledge_preview' || execution.revision !== state.receipt.manifest.executionRevision) fail('execution_changed');
  }
  private cancelKey(manifest: EvaluationBatchManifest, item: EvaluationBatchItem) {
    return 'kb-cancel:' + fingerprint({ batch: manifest.hash, evaluationId: item.evaluationId });
  }

  receipt(batchId: string) {
    return this.store.transaction(async tx => (await this.store.load(tx, key(batchId))).receipt);
  }
  preflight(manifest: EvaluationBatchManifest) {
    return this.store.transaction(async tx => {
      const state = await this.state(tx, manifest);
      if (!state.current) fail('context_changed');
      if (!state.cancellation) await this.current(tx, state);
    });
  }
  observe(manifest: EvaluationBatchManifest, item: EvaluationBatchItem): Promise<EvaluationBatchObservation> {
    return this.store.transaction(async tx => {
      const state = await this.state(tx, manifest), binding = this.binding(state, item), receipt = await this.lookup(tx, binding);
      const run = receipt ? await this.runState(tx, receipt) : null;
      if (!state.current) return { evaluationId: item.evaluationId, runId: null, status: 'source_changed',
        awaitingReconciliation: run?.awaitingReconciliation ?? false, usageKnown: false, structuralPassed: null };
      if (!receipt) return { evaluationId: item.evaluationId, runId: null,
        status: state.cancellation ? 'cancelled' : 'dispatch_pending',
        ...(state.cancellation ? { cancelledBeforeDispatch: true as const } : {}),
        awaitingReconciliation: false, usageKnown: Boolean(state.cancellation), structuralPassed: null };
      return { evaluationId: item.evaluationId, runId: receipt.runId, ...run!, structuralPassed: null };
    });
  }
  resume(manifest: EvaluationBatchManifest, item: EvaluationBatchItem) {
    return this.store.transaction(async tx => {
      const state = await this.state(tx, manifest), binding = this.binding(state, item);
      if (state.cancellation) fail('batch_cancelled');
      await this.current(tx, state);
      const existing = await this.lookup(tx, binding);
      if (existing) { await this.runState(tx, existing); await this.store.link(tx, binding, existing); return; }
      let active = 0;
      for (const other of state.items) {
        const receipt = await this.lookup(tx, other);
        if (receipt && occupied(await this.runState(tx, receipt))) active++;
      }
      if (active >= state.receipt.concurrency) fail('batch_concurrency_limit');
      const receipt = await this.shared.dispatch(tx, this.store.actor, {
        createKey: binding.createKey, sendKey: binding.sendKey, conversationId: binding.conversationId, content: content(binding),
        expectedExecutionRevision: manifest.executionRevision, context: state.context,
        batch: { batchId: manifest.batchId, evaluationId: item.evaluationId, manifestHash: manifest.hash,
          cancellation: { operation: executionCancelOperation, key: manifest.batchId, principalKey: principalKey(this.store.actor), manifestHash: manifest.hash } },
      });
      await this.store.link(tx, binding, this.checkedReceipt(binding, receipt));
    });
  }
  cancelItem(manifest: EvaluationBatchManifest, item: EvaluationBatchItem, requestKey: string) {
    return this.store.transaction(async tx => {
      const state = await this.state(tx, manifest), binding = this.binding(state, item), receipt = await this.lookup(tx, binding);
      if (!receipt) fail('context_changed');
      // No source/profile/policy/execution preflight: original identity/participation still applies.
      await this.shared.cancelRun(tx, this.store.actor, { ...receipt, requestKey: key(requestKey) });
      await this.store.link(tx, binding, receipt);
      return receipt;
    });
  }
  async cancel(manifest: EvaluationBatchManifest, item: EvaluationBatchItem, requestKey: string) {
    await this.cancelItem(manifest, item, requestKey);
  }
  async advance(batchId: string) {
    const receipt = await this.receipt(batchId);
    return new EvaluationBatchCoordinator(receipt.manifest, this, receipt.concurrency).advance();
  }
  async cancelBatch(batchId: string, requestKey: string) {
    // Commit the unique intent first. A later individual permission/transport failure must not reopen dispatch.
    const { receipt, intent } = await this.store.transaction(async tx => {
      const state = await this.store.load(tx, key(batchId));
      const intent = await this.store.persistCancellation(tx, state, key(requestKey));
      return { receipt: state.receipt, intent };
    });
    const items = [];
    for (const item of receipt.manifest.items) {
      let action: 'not_dispatched' | 'cancel_requested' | 'unconfirmed' = 'unconfirmed';
      try {
        action = await this.store.transaction(async tx => {
          const state = await this.state(tx, receipt.manifest), binding = this.binding(state, item);
          if (!state.cancellation) fail('invalid_batch_manifest');
          const run = await this.lookup(tx, binding);
          if (!run) return 'not_dispatched' as const;
          await this.shared.cancelRun(tx, this.store.actor, { ...run, requestKey: this.cancelKey(receipt.manifest, item) });
          await this.store.link(tx, binding, run);
          return 'cancel_requested' as const;
        });
      } catch { /* Retain durable intent; return no private/vendor error or false cancellation acknowledgement. */ }
      items.push({ evaluationId: item.evaluationId, action });
    }
    return { ...intent, items, costMicros: null, semanticCorrectness: 'requires_review' as const };
  }
}
