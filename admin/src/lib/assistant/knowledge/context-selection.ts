import type { Applicability } from '../contracts/professional';
export type ContextSelectionPolicy = 'document_coverage' | 'ranked';

/** Ranking only: callers must have applied server authorization and similarity first.
 * Incompatible rules remain explainable when space permits, but cannot crowd out
 * usable rules. Prefer coverage across documents without dropping useful repeats. */
export function selectContextCandidates<T extends { id: string; document_id: string }>(
  ranked: T[], conditions: ReadonlyMap<string, Applicability | null>, limit = 5,
  preferredDocuments: ReadonlySet<string> = new Set(),
  policy: ContextSelectionPolicy = 'document_coverage',
  coverageGroup?: (candidate: T) => string,
): T[] {
  const usable = ranked.filter(c => conditions.get(c.id)?.status !== 'not_applicable');
  const incompatible = ranked.filter(c => conditions.get(c.id)?.status === 'not_applicable');
  const selected: T[] = [], counts = new Map<string, number>();
  // A source explicitly named by the user must not lose its third necessary
  // clause merely to diversify into another manual. This runs after access,
  // publication, epoch, applicability and similarity checks, never before ACLs.
  const preferred=usable.filter(c=>preferredDocuments.has(c.document_id));
  const remaining=usable.filter(c=>!preferredDocuments.has(c.document_id));
  // Natural questions need the strongest clauses, even when all come from one
  // manual. A document-count quota must not replace a relevant procedure with
  // lower-ranked material. Legacy/workflow coverage remains the default.
  if (policy === 'ranked' && !coverageGroup) return [...preferred, ...remaining, ...incompatible].slice(0, limit);
  const groupOf = coverageGroup ?? ((c: T) => c.document_id);
  for (const group of coverageGroup ? [[...preferred, ...remaining], incompatible] : [preferred, remaining, incompatible]) {
    for (const maxPerGroup of [2, Infinity]) {
      for (const c of group) {
        if (selected.length === limit) return selected;
        const key = groupOf(c), count = counts.get(key) || 0;
        if (selected.includes(c) || count >= maxPerGroup) continue;
        selected.push(c); counts.set(key, count + 1);
      }
    }
  }
  return selected;
}
