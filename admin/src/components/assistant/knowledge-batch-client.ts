import { AssistantMutations, AssistantRequestError } from './client';
import type { KnowledgeBatchPreparationResult, KnowledgeOperationScope } from '@/lib/assistant/knowledge/operation-batch-view';

export type BatchSelection = Array<{ caseId: string; expectedVersion: number }>;
type PendingPreparation = { version: 1; scope: KnowledgeOperationScope; requestKey: string; cases: BatchSelection };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type MutationWriter = Pick<AssistantMutations, 'write'>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const sameKnowledgeScope = (a: KnowledgeOperationScope | null, b: KnowledgeOperationScope | null) =>
  Boolean(a && b && a.enterpriseId === b.enterpriseId && a.adminId === b.adminId);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= BigInt('9223372036854775807');
function validScope(value: unknown): value is KnowledgeOperationScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as KnowledgeOperationScope;
  return Object.keys(scope).every(k => ['enterpriseId', 'adminId'].includes(k)) && validId(scope.enterpriseId) && validId(scope.adminId);
}
function validSelection(value: unknown): value is BatchSelection {
  return Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every(item => item && typeof item === 'object'
    && Object.keys(item).every(k => ['caseId', 'expectedVersion'].includes(k)) && validId(item.caseId)
    && Number.isSafeInteger(item.expectedVersion) && item.expectedVersion > 0)
    && new Set(value.map(item => item.caseId)).size === value.length;
}

/** Browser metadata only; server receipts/evaluations remain the durable authority. */
export class KnowledgeBatchPreparationClient {
  private memory = new Map<string, PendingPreparation>();
  constructor(private readonly storage?: StorageLike, private readonly writer: MutationWriter = new AssistantMutations()) {}

  private storageKey(scope: KnowledgeOperationScope) { return `assistant-knowledge-batch-v1:${scope.enterpriseId}:${scope.adminId}`; }

  pending(scope: KnowledgeOperationScope): PendingPreparation | null {
    if (!validScope(scope)) return null;
    const storageKey = this.storageKey(scope);
    const memory = this.memory.get(storageKey);
    if (memory) return clone(memory);
    try {
      const raw = this.storage?.getItem(storageKey);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<PendingPreparation>;
      if (!value || value.version !== 1 || !validScope(value.scope) || !sameKnowledgeScope(value.scope, scope)
        || typeof value.requestKey !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value.requestKey) || !validSelection(value.cases)
        || Object.keys(value).some(k => !['version', 'scope', 'requestKey', 'cases'].includes(k))) return null;
      const pending = clone(value as PendingPreparation);
      this.memory.set(storageKey, pending);
      return clone(pending);
    } catch { return null; }
  }

  private save(pending: PendingPreparation) {
    const storageKey = this.storageKey(pending.scope);
    this.memory.set(storageKey, clone(pending));
    try { this.storage?.setItem(storageKey, JSON.stringify(pending)); } catch { /* Server history remains available if storage is blocked. */ }
  }

  private clear(scope: KnowledgeOperationScope) {
    const storageKey = this.storageKey(scope);
    this.memory.delete(storageKey);
    try { this.storage?.removeItem(storageKey); } catch { /* No server resource is removed. */ }
  }

  async prepare(scope: KnowledgeOperationScope, cases: BatchSelection): Promise<KnowledgeBatchPreparationResult> {
    if (!validScope(scope) || !validSelection(cases)) throw new Error('请选择 1–50 道有效问题，重复问题不能加入同一批次。');
    const old = this.pending(scope);
    if (old && JSON.stringify(old.cases) !== JSON.stringify(cases)) throw new Error('上一笔批量准备仍待核对，请先用原键恢复，或从本人批次核对结果。');
    const pending: PendingPreparation = old ?? { version: 1, scope: clone(scope), requestKey: crypto.randomUUID(), cases: clone(cases) };
    this.save(pending);
    try {
      const result = await this.writer.write<KnowledgeBatchPreparationResult>('knowledge/operations/batches', { cases: pending.cases }, 'POST', pending.requestKey);
      if (!sameKnowledgeScope(result, scope) || result.batchId !== pending.requestKey) throw new AssistantRequestError('context_changed', 409, true);
      this.clear(scope);
      return result;
    } catch (error) {
      if (error instanceof AssistantRequestError && !error.uncertain) this.clear(scope);
      throw error;
    }
  }

  async retry(scope: KnowledgeOperationScope) {
    const pending = this.pending(scope);
    if (!pending) throw new Error('当前账号没有待核对的批量准备，请从本人批次重新读取。');
    return this.prepare(scope, pending.cases);
  }
}
