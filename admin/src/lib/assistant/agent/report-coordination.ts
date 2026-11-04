import { fail, fingerprint } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { prepareSourceAnswerReview } from './knowledge-explanation';
import { reportCoordinationProtocol } from './report-question-plan';
import { sourceQuestionCoverageProtocol, type SourceQuestionCoverage } from './source-question-plan';
import { parseSynthesis, type SynthesisSource } from './synthesis';
import type { SynthesisReviewContext } from './synthesis-review';

export const reportCoordinationText = '这件事需要现场确认，请和现场团队核实。';
const referral = { basis: 'uncertainty' as const, text: reportCoordinationText, citations: [] };
export const reportCoordinationAnswer = JSON.stringify({ kind: 'synthesis', segments: [referral] });

export function boundReportCoordination(value: unknown, planned: boolean) {
  if (value === undefined) return false;
  if (value !== reportCoordinationProtocol || !planned) fail('context_changed');
  return true;
}

/** Knowledge prose can use only actual knowledge sources. The fixed
 * coordination text carries no claim of a fact, action, handoff or approval. */
export function prepareReportKnowledgeReview(raw: string, consulted: SynthesisSource[], context: SynthesisReviewContext, history: ModelMessage[], coordination: boolean) {
  if (!context.currentQuestion) fail('context_changed');
  const sources = consulted.filter(source => source.kind === 'knowledge' || source.kind === 'web');
  const answer = parseSynthesis(raw, sources, context);
  if (answer.segments.some(segment => segment.text.includes(reportCoordinationText)
    || segment.basis === 'advice' && !segment.citations.length)) fail('ungrounded_response_scope', 502);
  if (coordination) {
    if (answer.segments.length >= 6) fail('invalid_model_answer', 502);
    answer.segments.push(referral);
  }
  const coverage: SourceQuestionCoverage = { protocol: sourceQuestionCoverageProtocol, questions: [context.currentQuestion] };
  const draft = prepareSourceAnswerReview(raw, answer, sources, coverage, context, { Q1: answer.segments }, history, reportCoordinationProtocol);
  return { ...draft, binding: fingerprint({ review: draft.binding, coordination }) };
}
