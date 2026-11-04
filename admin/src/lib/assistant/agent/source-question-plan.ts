import { fail } from '../contracts';

export const sourceQuestionCoverageProtocol = 'source-question-coverage-v1';
export type SourceQuestionCoverage = { protocol: typeof sourceQuestionCoverageProtocol; questions: string[] };
export const sourceQuestionPlanSchema = { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true,
  items: { type: 'string', minLength: 2, maxLength: 1000 } };

export function parseSourceQuestionQuery(input: Record<string, unknown>, currentQuestion: string): SourceQuestionCoverage {
  if (!input || Object.keys(input).some(key => !['query', 'questions'].includes(key))
    || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 6
    || new Set(input.questions).size !== input.questions.length
    || input.questions.some(q => typeof q !== 'string' || q.length < 2 || q.length > 1000
      || q !== q.trim() || !currentQuestion.includes(q) || /[\u0000-\u001f\u007f]/.test(q))) fail('invalid_message', 422);
  return { protocol: sourceQuestionCoverageProtocol, questions: input.questions as string[] };
}

/** The complete original is a separate input to semantic review. */
export function parsePlannedSourceQuestions(input: Record<string, unknown>): SourceQuestionCoverage {
  return parseSourceQuestionQuery(input, Array.isArray(input?.questions)
    ? input.questions.filter((q): q is string => typeof q === 'string').join('\n') : '');
}

export function readSourceQuestionCoverage(value: unknown): SourceQuestionCoverage {
  const coverage = value as SourceQuestionCoverage;
  if (!coverage || coverage.protocol !== sourceQuestionCoverageProtocol || !Array.isArray(coverage.questions)
    || Object.keys(coverage).some(key => !['protocol', 'questions'].includes(key))) fail('context_changed');
  return parseSourceQuestionQuery({ questions: coverage.questions }, coverage.questions?.join('\n') || '');
}
