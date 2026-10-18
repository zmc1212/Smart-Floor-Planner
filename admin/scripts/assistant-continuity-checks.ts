import type { SynthesisAnswer, SynthesisSource } from '../src/lib/assistant/agent/synthesis';

/** Acceptance for the explicit single/double correction scenario, not a general
 * semantic judge. Separately listed headcounts or a different waiting party do not
 * explain how the current need differs from the exact formal version. */
export function hasExplicitUseFormalComparison(answer: SynthesisAnswer, sources: SynthesisSource[],
  expected: { useId: string; formalId: string; currentTerm: string; formalTerm: string }) {
  const supports = (segment: SynthesisAnswer['segments'][number], type: 'customer_need' | 'formal_plan', id: string, term: string) =>
    segment.citations.some(c => c.quote.includes(term) && sources.some(s => s.sourceId === c.sourceId
      && s.material?.ref.type === type && s.material.ref.id === id && s.text.includes(c.quote)
      && (type !== 'customer_need' || s.material.need?.field === 'use')));
  // The current-use original may already be cited in an earlier paragraph,
  // as allowed by the existing correction-citation protocol. Require the
  // actual comparison and its exact formal-version quote together.
  return answer.segments.some(segment => supports(segment, 'customer_need', expected.useId, expected.currentTerm))
    && answer.segments.some(segment => segment.basis === 'evidence'
    && segment.text.includes(expected.currentTerm) && segment.text.includes(expected.formalTerm)
    && /不一致|差异|不同|冲突/.test(segment.text)
    && supports(segment, 'formal_plan', expected.formalId, expected.formalTerm));
}
