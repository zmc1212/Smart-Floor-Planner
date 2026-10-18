import type { EvaluationBatchPreparation, EvaluationBatchStatus } from './evaluation-batch';

export type KnowledgeOperationScope = { enterpriseId: string; adminId: string };
export type KnowledgeBatchState = EvaluationBatchStatus | 'unavailable';
export type KnowledgeBatchListItem = { batchId: string; createdAt: string; count: number; knowledgeEpoch: number };
export type KnowledgeBatchList = {
  scope: KnowledgeOperationScope;
  items: KnowledgeBatchListItem[];
  nextCursor: string | null;
};
export type KnowledgeBatchProgressItem = {
  caseId: string;
  evaluationId: string;
  caseRevision: number;
  currentRevision: number | null;
  title: string;
  available: boolean;
  status: KnowledgeBatchState;
  dispatchState: 'not_started' | 'receipt_pending' | 'linked' | null;
  runId: string | null;
  awaitingReconciliation: boolean;
};
export type KnowledgeBatchProgress = {
  scope: KnowledgeOperationScope;
  batchId: string;
  createdAt: string;
  contextChanged: boolean;
  knowledgeEpoch: number;
  preparedEpoch: number;
  items: KnowledgeBatchProgressItem[];
  counts: Record<KnowledgeBatchState, number>;
  contentIncluded: false;
  semanticCorrectness: 'requires_review';
  costMicros: null;
};
export type KnowledgeBatchPreparationResult = EvaluationBatchPreparation;

export const knowledgeBatchStates: KnowledgeBatchState[] = [
  'dispatch_pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled',
  'indeterminate', 'source_changed', 'unavailable',
];

/** Execution counts only; result/citation validity is read through the original evaluation endpoint. */
export function knowledgeBatchCounts(items: readonly KnowledgeBatchProgressItem[]) {
  return Object.fromEntries(knowledgeBatchStates.map(state => [state, items.filter(item => item.status === state).length])) as Record<KnowledgeBatchState, number>;
}
