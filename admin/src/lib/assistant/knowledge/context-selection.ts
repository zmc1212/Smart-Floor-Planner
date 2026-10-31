import type { Applicability } from '../contracts/professional';

/** Ranking only: callers must have applied server authorization and similarity first.
 * Incompatible rules remain explainable when space permits, but cannot crowd out
 * usable rules. Prefer coverage across documents without dropping useful repeats. */
export function selectContextCandidates<T extends { id: string; document_id: string }>(
  ranked: T[], conditions: ReadonlyMap<string, Applicability | null>, limit = 5,
  preferredDocuments: ReadonlySet<string> = new Set(),
): T[] {
  const usable = ranked.filter(c => conditions.get(c.id)?.status !== 'not_applicable');
  const incompatible = ranked.filter(c => conditions.get(c.id)?.status === 'not_applicable');
  const selected: T[] = [], counts = new Map<string, number>();
  // A source explicitly named by the user must not lose its third necessary
  // clause merely to diversify into another manual. This runs after access,
  // publication, epoch, applicability and similarity checks, never before ACLs.
  const preferred=usable.filter(c=>preferredDocuments.has(c.document_id));
  const remaining=usable.filter(c=>!preferredDocuments.has(c.document_id));
  for (const group of [preferred, remaining, incompatible]) {
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
