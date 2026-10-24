import type { SynthesisSource } from './synthesis';
import { sourceCitationCatalog } from './citation-catalog';

export const citationSelectionProtocol = 'numeric-span-coverage-v1';
const numbers = (text: string) => [...new Set(text.match(/\d+(?:\.\d+)?/g) || [])];

/** Identification index only. Every value is literal in this exact catalog
 * span. Full originals/conditions remain readable; numbers are not proof of
 * units, applicability, authority or a site's condition. */
export function numericCatalogIndex(source: SynthesisSource) {
  return new Map(sourceCitationCatalog(source).flatMap(citation => {
    const values = numbers(citation.quote);
    return values.length ? [[citation.citationId, { values: values.slice(0, 12), valueCount: values.length, complete: values.length <= 12 }] as const] : [];
  }));
}

/** Bounded set-cover candidates for the existing one repair. Avoid consuming
 * all four slots with repeated occurrences of the same value. The model still
 * selects/removes IDs explicitly; this never edits a draft or adds citations. */
export function numericCitationCandidates(wanted: string[], sources: SynthesisSource[], extractValues: (text: string) => string[] = numbers) {
  const remaining = new Set(wanted);
  const priority = (source: SynthesisSource) => source.material?.ref.type === 'site_record' ? 4
    : source.kind === 'project' && !source.material?.need && source.material?.ref.type !== 'formal_plan' ? 3 : source.kind === 'knowledge' ? 2 : 1;
  const pool = sources.flatMap(source => sourceCitationCatalog(source).flatMap(citation => {
    const actual = new Set(extractValues(citation.quote)), values = [...remaining].filter(number => actual.has(number));
    return values.length ? [{ citationId: citation.citationId, valuesInOriginal: values,
      sourceRole: source.material?.ref.type || source.kind, candidateOnly: true as const,
      quote: citation.quote, priority: priority(source) }] : [];
  }));
  const selected: Array<Omit<(typeof pool)[number], 'priority'>> = [];
  while (remaining.size && selected.length < 4) {
    pool.sort((a,b) => b.valuesInOriginal.filter(value => remaining.has(value)).length - a.valuesInOriginal.filter(value => remaining.has(value)).length
      || b.priority - a.priority || a.citationId.localeCompare(b.citationId));
    const next = pool.shift();
    if (!next || !next.valuesInOriginal.some(value => remaining.has(value))) break;
    for (const value of next.valuesInOriginal) remaining.delete(value);
    const { priority: _priority, ...candidate } = next;
    void _priority;
    selected.push(candidate);
  }
  return selected;
}
