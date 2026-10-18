import type { ActorContext } from '../../src/lib/assistant/contracts';
import type { EvaluationBatchManifest } from '../../src/lib/assistant/knowledge/evaluation-batch';
import type { BatchCancellationIntent } from '../../src/lib/assistant/knowledge/batch-execution-adapter';
import type { Lease } from '../../src/lib/assistant/infrastructure/job-queue';

export type AcceptanceEvent = { name: string; pid: number; index: number; commandId: number };
export type AcceptanceSnapshot = {
  counts: Record<string, number>; intent: BatchCancellationIntent | null; intentCount: number;
  dispatchCalls: number; providerFetches: number; runId: string | null; conversationId: string | null;
  createKey: string; sendKey: string; runStatus?: string; reservationStatus?: string; costMicros: null;
};
export type AcceptanceFixture = {
  actor: ActorContext;
  prepare(): EvaluationBatchManifest | Promise<EvaluationBatchManifest>;
  snapshot(batchId: string, events: AcceptanceEvent[]): AcceptanceSnapshot | Promise<AcceptanceSnapshot>;
  loseAssociation(batchId: string): void | Promise<void>;
  rpc?(method: string, input: Record<string, unknown>, owner: number): Promise<unknown>;
  leaseFor?(batchId: string): Promise<Lease>;
  cleanup?(): Promise<unknown>;
  activeTransactions?(): number;
};
