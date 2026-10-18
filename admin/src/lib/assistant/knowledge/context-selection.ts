import type { Applicability } from '../contracts/professional';

/** Ranking only: callers must have applied server authorization and similarity first.
 * Incompatible rules remain explainable when space permits, but cannot crowd out
 * usable rules. Prefer coverage across documents without dropping useful repeats. */
export function selectContextCandidates<T extends { id: string; document_id: string }>(
  ranked: T[], conditions: ReadonlyMap<string, Applicability | null>, limit = 5,
): T[] {
  const usable = ranked.filter(c => conditions.get(c.id)?.status !== 'not_applicable');
  const incompatible = ranked.filter(c => conditions.get(c.id)?.status === 'not_applicable');
  const selected: T[] = [], counts = new Map<string, number>();
  for (const group of [usable, incompatible]) {
    for (const maxPerDocument of [2, Infinity]) {
      for (const c of group) {
        if (selected.length === limit) return selected;
        if (selected.includes(c) || (counts.get(c.document_id) || 0) >= maxPerDocument) continue;
        selected.push(c); counts.set(c.document_id, (counts.get(c.document_id) || 0) + 1);
      }
    }
  }
  return selected;
}
