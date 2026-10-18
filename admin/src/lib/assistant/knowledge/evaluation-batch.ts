import { fail, fingerprint, id, key } from '../contracts';

export const MAX_EVALUATION_BATCH_ITEMS = 50;
export const MAX_EVALUATION_BATCH_CONCURRENCY = 4;

export type EvaluationBatchItem = {
  caseId: string;
  caseVersion: number;
  caseRevision: number;
  evaluationId: string;
  snapshotHash: string;
};

/** An immutable preparation receipt, backed by existing evaluations/idempotency. */
export type EvaluationBatchPreparation = {
  batchId: string;
  enterpriseId: string;
  adminId: string;
  knowledgeEpoch: number;
  profileId: string;
  profileHash: string;
  policyVersion: number;
  items: EvaluationBatchItem[];
};

export type EvaluationBatchManifest = EvaluationBatchPreparation & {
  version: 1;
  executionRevision: string;
  hash: string;
};

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('invalid_message', 422);
  return Number(value);
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid_message', 422);
  return value;
}

export function evaluationBatchCases(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_EVALUATION_BATCH_ITEMS) fail('invalid_message', 422);
  const cases = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(k => !['caseId', 'expectedVersion'].includes(k))) fail('invalid_message', 422);
    return { caseId: id(item.caseId), expectedVersion: positive(item.expectedVersion) };
  });
  if (new Set(cases.map(c => c.caseId)).size !== cases.length) fail('invalid_message', 422);
  return cases;
}

/** executionRevision must be supplied/checked by the server adapter, never the model or browser. */
export function evaluationBatchManifest(preparation: EvaluationBatchPreparation, executionRevision: string): EvaluationBatchManifest {
  if (!Array.isArray(preparation.items) || !preparation.items.length || preparation.items.length > MAX_EVALUATION_BATCH_ITEMS) fail('invalid_message', 422);
  const items = preparation.items.map(item => ({
    caseId: id(item.caseId), caseVersion: positive(item.caseVersion), caseRevision: positive(item.caseRevision),
    evaluationId: id(item.evaluationId), snapshotHash: hash(item.snapshotHash),
  }));
  if (new Set(items.map(i => i.caseId)).size !== items.length
    || new Set(items.map(i => i.evaluationId)).size !== items.length) fail('invalid_message', 422);
  if (!Number.isSafeInteger(preparation.knowledgeEpoch) || preparation.knowledgeEpoch < 0) fail('invalid_message', 422);
  const body = {
    version: 1 as const, batchId: key(preparation.batchId), enterpriseId: id(preparation.enterpriseId), adminId: id(preparation.adminId),
    knowledgeEpoch: preparation.knowledgeEpoch, profileId: id(preparation.profileId), profileHash: hash(preparation.profileHash),
    policyVersion: positive(preparation.policyVersion), executionRevision: hash(executionRevision), items,
  };
  return { ...body, hash: fingerprint(body) };
}

export type EvaluationBatchStatus = 'dispatch_pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate' | 'source_changed';
export type EvaluationBatchObservation = {
  evaluationId: string;
  runId: string | null;
  status: EvaluationBatchStatus;
  awaitingReconciliation: boolean;
  usageKnown: boolean;
  structuralPassed: boolean | null;
  /** Server-persisted whole-batch intent plus a read-only proof that no run exists. */
  cancelledBeforeDispatch?: true;
};
export type EvaluationBatchProgressItem = EvaluationBatchObservation & {
  action: 'none' | 'resumed' | 'cancel_requested' | 'unconfirmed';
};

/**
 * Integration seam, NOT an alternative queue, lease, authorization or usage authority.
 * Every method must enforce the selected tenant/current manager/owner and frozen
 * case, source, profile and execution revision. Mutations must recheck atomically.
 * observe must reread live state (including lost send receipts), not cached answers.
 * resume only uses the prepared evaluation's original create/send keys; cancel
 * only cancels an existing run and must never dispatch/retry to discover its ID.
 */
export interface EvaluationBatchPort {
  preflight(manifest: EvaluationBatchManifest): Promise<void>;
  observe(manifest: EvaluationBatchManifest, item: EvaluationBatchItem): Promise<EvaluationBatchObservation>;
  resume(manifest: EvaluationBatchManifest, item: EvaluationBatchItem): Promise<void>;
  cancel(manifest: EvaluationBatchManifest, item: EvaluationBatchItem, requestKey: string): Promise<void>;
}

const statuses: EvaluationBatchStatus[] = ['dispatch_pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'indeterminate', 'source_changed'];
const active = (o: EvaluationBatchObservation) => o.status === 'queued' || o.status === 'running';
const unresolved = (o: EvaluationBatchObservation) => o.awaitingReconciliation || o.status === 'indeterminate';

function observation(item: EvaluationBatchItem, value: EvaluationBatchObservation, knownRunId: string | null = null): EvaluationBatchProgressItem {
  if (value.runId !== null) id(value.runId);
  if (value.evaluationId !== item.evaluationId || !statuses.includes(value.status)
    || typeof value.awaitingReconciliation !== 'boolean' || typeof value.usageKnown !== 'boolean'
    || (value.structuralPassed !== null && typeof value.structuralPassed !== 'boolean')
    || (value.runId === null && !['dispatch_pending', 'source_changed'].includes(value.status)
      && !(value.status === 'cancelled' && value.cancelledBeforeDispatch === true && !value.awaitingReconciliation && value.usageKnown))
    || (value.status === 'dispatch_pending' && value.runId !== null)
    || (value.cancelledBeforeDispatch !== undefined && (value.cancelledBeforeDispatch !== true || value.runId !== null || value.status !== 'cancelled'))
    || (knownRunId !== null && value.status !== 'source_changed' && value.runId !== knownRunId)
    || (value.structuralPassed !== null && value.status !== 'succeeded')) fail('invalid_batch_observation');
  // Whitelist fields: no answer, source, diagnostic, notes or vendor error text in a checkpoint.
  if (value.status === 'source_changed') return {
    evaluationId: item.evaluationId, runId: null, status: 'source_changed', awaitingReconciliation: value.awaitingReconciliation,
    usageKnown: false, structuralPassed: null, action: 'none',
  };
  return { evaluationId: item.evaluationId, runId: value.runId, status: value.status,
    awaitingReconciliation: value.awaitingReconciliation, usageKnown: value.usageKnown,
    structuralPassed: value.structuralPassed, ...(value.cancelledBeforeDispatch ? { cancelledBeforeDispatch: true as const } : {}), action: 'none' };
}

async function mapLimit<T>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await work(items[index], index); } catch (error) { failure ??= { error }; }
    }
  }));
  // Drain already-started operations before rejecting: never leave hidden mutations running.
  if (failure) throw failure.error;
}

export function evaluationBatchProgress(items: EvaluationBatchProgressItem[], cancelRequested: boolean) {
  const counts = Object.fromEntries(statuses.map(s => [s, items.filter(i => i.status === s).length])) as Record<EvaluationBatchStatus, number>;
  const unconfirmed = items.filter(i => i.action === 'unconfirmed').length;
  const needsReconciliation = items.filter(unresolved).length;
  return {
    items, counts, total: items.length,
    active: items.filter(active).length,
    settled: items.filter(i => !active(i) && i.status !== 'dispatch_pending' && !unresolved(i) && i.action !== 'unconfirmed').length,
    structuralPassed: items.filter(i => i.structuralPassed === true).length,
    unknownUsageItems: items.filter(i => (i.runId !== null || i.awaitingReconciliation) && !i.usageKnown).length,
    needsReconciliation, unconfirmed, cancelRequested,
    completed: items.every(i => !active(i) && i.status !== 'dispatch_pending' && !unresolved(i) && i.action !== 'unconfirmed'),
    semanticCorrectness: 'requires_review' as const,
    // A settled run is not evidence of a verified vendor bill; no zero-filled total.
    costMicros: null,
  };
}

/**
 * One bounded sweep, suitable for explicit polling. Existing evaluations/runs are
 * the durable truth; reopening starts with live reads of the same manifest IDs.
 * One instance permits one sweep at a time. A distributed caller must serialize
 * controllers for the same manifest using the existing integration mechanism.
 */
export class EvaluationBatchCoordinator {
  readonly manifest: EvaluationBatchManifest;
  private busy = false;
  private stopped = false;

  constructor(manifest: EvaluationBatchManifest, private readonly port: EvaluationBatchPort, readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_EVALUATION_BATCH_CONCURRENCY) fail('invalid_message', 422);
    const checked = evaluationBatchManifest(manifest, manifest.executionRevision);
    if (manifest.version !== 1 || checked.hash !== manifest.hash) fail('invalid_batch_manifest');
    // Detach/freeze caller objects; the unkeyed hash is integrity checking, not authorization.
    checked.items.forEach(Object.freeze);
    Object.freeze(checked.items);
    this.manifest = Object.freeze(checked);
  }

  requestCancel() { this.stopped = true; }

  async advance() {
    if (this.busy) fail('batch_busy');
    this.busy = true;
    try {
      await this.port.preflight(this.manifest);
      const result: EvaluationBatchProgressItem[] = [];
      await mapLimit(this.manifest.items, this.concurrency, async (item, index) => {
        result[index] = observation(item, await this.port.observe(this.manifest, item));
      });
      // No dispatch occurs until every prepared evaluation has been reread successfully.
      const occupied = result.filter(i => active(i) || unresolved(i)).length;
      const slots = Math.max(0, this.concurrency - occupied);
      const pending = this.manifest.items.map((item, index) => ({ item, index }))
        .filter(({ index }) => result[index].status === 'dispatch_pending' && !unresolved(result[index])).slice(0, slots);
      if (!this.stopped) await mapLimit(pending, this.concurrency, async ({ item, index }) => {
        await this.port.preflight(this.manifest);
        if (this.stopped) return;
        let confirmed = true;
        try { await this.port.resume(this.manifest, item); } catch { confirmed = false; }
        result[index] = observation(item, await this.port.observe(this.manifest, item), result[index].runId);
        result[index].action = confirmed ? 'resumed' : 'unconfirmed';
      });
      // Covers cancellation arriving while a resume is in flight, without starting waiting items.
      if (this.stopped) await mapLimit(this.manifest.items.map((item, index) => ({ item, index }))
        .filter(({ index }) => active(result[index])), this.concurrency, async ({ item, index }) => {
        await this.port.preflight(this.manifest);
        let confirmed = true;
        const requestKey = 'kb-cancel:' + fingerprint({ batch: this.manifest.hash, evaluationId: item.evaluationId });
        try { await this.port.cancel(this.manifest, item, requestKey); } catch { confirmed = false; }
        result[index] = observation(item, await this.port.observe(this.manifest, item), result[index].runId);
        result[index].action = confirmed ? 'cancel_requested' : 'unconfirmed';
      });
      await this.port.preflight(this.manifest);
      return evaluationBatchProgress(result, this.stopped);
    } finally { this.busy = false; }
  }
}
