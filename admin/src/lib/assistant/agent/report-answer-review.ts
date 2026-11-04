import { fail } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { parseSynthesis, type SynthesisSource } from './synthesis';
import type { SynthesisReviewContext } from './synthesis-review';
import { reportAnswerSynthesis, reportQuestionCoverage } from './report-final';
import { prepareSourceAnswerReview, acceptKnowledgeExplanation, type KnowledgeExplanationDraft } from './knowledge-explanation';
import { reportAnswerGroundingProtocol } from './report-source-scope';
import type { SourceQuestionCoverage } from './source-question-coverage';

/** The ordinary guards run first, including uncited dates. The shared reviewer
 * then checks semantic support against the exact per-original report scopes.
 * A failed review stops the draft: it does not request another answer. */
export function prepareReportAnswerReview(raw: string, sources: SynthesisSource[], context: SynthesisReviewContext, history: ModelMessage[] = [],
  plannedCoverage?: SourceQuestionCoverage) {
  if (!context.currentQuestion || !sources.some(source => source.reportScope?.protocol === reportAnswerGroundingProtocol)) fail('context_changed');
  const coverage = plannedCoverage ?? reportQuestionCoverage(context.currentQuestion);
  const answer = parseSynthesis(reportAnswerSynthesis(raw, coverage), sources, context);
  const answers = (JSON.parse(raw) as { answers: Record<string, unknown> }).answers;
  return prepareSourceAnswerReview(raw, answer, sources, coverage, context, answers, history, reportAnswerGroundingProtocol);
}

export function assertReportAnswerReview(draft: KnowledgeExplanationDraft, output: Parameters<typeof acceptKnowledgeExplanation>[1], binding: string) {
  if (acceptKnowledgeExplanation(draft, output, binding)) fail('ungrounded_response_scope', 502);
}

/** New grounded runs spend the remaining dispatch on semantic verification.
 * A structural/numeric failure cannot spend that slot on an unreviewed
 * redraft. Legacy runs keep their original one-repair behavior. */
export function reportAnswerValidationFailure(issue: { code: string; feedback: string }, grounded: boolean) {
  if (grounded) fail(issue.code, 502);
  return issue;
}
