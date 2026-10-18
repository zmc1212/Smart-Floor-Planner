import { fail } from '../contracts';
import type { SynthesisAnswer, SynthesisSource } from './synthesis';

/** Bounded guard for the observed joint-prerequisite claim about registered,
 * conflicting rules. It is not a general natural-language entailment judge. */
export function assertConflictAttribution(answer: SynthesisAnswer, sources: SynthesisSource[]) {
  const groups = new Map<string, Map<string, SynthesisSource[]>>();
  for (const source of sources) {
    if (source.kind !== 'knowledge') continue;
    const p = source.evidence?.professional, claim = p?.entry.claim;
    if (!claim || p?.applicability.status === 'not_applicable') continue;
    const values = groups.get(claim.key) || new Map<string, SynthesisSource[]>();
    values.set(claim.value, [...(values.get(claim.value) || []), source]); groups.set(claim.key, values);
  }
  for (const segment of answer.segments) {
    if (segment.basis !== 'evidence' || !/(?:两(?:份|条)(?:规则|口径|资料)|双方|二者)[^。！？\n]{0,24}(?:共同.{0,4}前提|同样.{0,4}前置条件|(?:都|均).{0,8}(?:前提|前置条件))/.test(segment.text)) continue;
    for (const values of groups.values()) {
      if (values.size < 2) continue;
      const all = [...values.values()].flat();
      if (!segment.citations.some(c => all.some(s => s.sourceId === c.sourceId))) continue;
      const cited = [...values.values()].filter(group => segment.citations.some(c => group.some(s => s.sourceId === c.sourceId)));
      if (cited.length < 2) fail('unresolved_evidence_conflict', 502);
      const common = all[0].evidence!.professional!.entry.prerequisites.filter(p =>
        all.every(s => s.evidence!.professional!.entry.prerequisites.includes(p)));
      if (common.length && cited.some(group => !segment.citations.some(c => group.some(s => s.sourceId === c.sourceId)
        && common.some(p => c.quote.includes(p))))) fail('unresolved_evidence_conflict', 502);
    }
  }
}
