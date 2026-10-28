import type { SynthesisSource } from './synthesis';
/** Existing query_followups results only. The normal business final decoder
 * reauthorizes and renders the saved service snapshot, never model prose. */
export function formalBusinessResultKeys(sources: SynthesisSource[]) {
  return [...new Set(sources.filter(source => source.followup?.kind === 'formal_plan')
    .map(source => source.resultKey).filter((key): key is string => typeof key === 'string' && !!key.trim() && key.length <= 160))].slice(0, 4);
}
