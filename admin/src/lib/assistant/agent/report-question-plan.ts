import { AssistantError, fail, fingerprint, id } from '../contracts';
import type { ModelTool } from '../contracts/model';
import type { ReportReference } from '@/lib/construction/report-reference';
import { parsePlannedSourceQuestions, readSourceQuestionCoverage, sourceQuestionPlanSchema, type SourceQuestionCoverage } from './source-question-plan';

export const reportQuestionPlanningProtocol = 'report-read-question-plan-v1';
export const reportReadCompletionProtocol = 'report-required-reads-complete-v1';
export const reportHistoryScopeProtocol = 'report-selection-history-v1';
export const reportCoordinationProtocol = 'report-coordination-referral-v1';
export type ReportQuestionPlanScope = {
  enterpriseId: string; runId: string; messageId: string; question: string; selection: ReportReference;
};
export type ReportQuestionPlan = {
  protocol: typeof reportQuestionPlanningProtocol;
  enterpriseId: string; runId: string; messageId: string; questionHash: string; reportReferenceHash: string;
  coverage: SourceQuestionCoverage;
};

/** Admission selects a planning strategy. An old run never acquires it from
 * a provider argument, saved plan, new setting or resumed worker. */
export function boundReportQuestionPlanning(value: unknown, groundedReport: boolean) {
  if (value === undefined) return false;
  if (value !== reportQuestionPlanningProtocol || !groundedReport) fail('context_changed');
  return true;
}

export function boundReportReadCompletion(value: unknown, plannedReport: boolean) {
  if (value === undefined) return false;
  if (value !== reportReadCompletionProtocol || !plannedReport) fail('context_changed');
  return true;
}

export function boundReportHistoryScope(value: unknown, completedRead: boolean, policyVersion: unknown, originalVersion: unknown) {
  if (value === undefined) return undefined;
  if (value !== reportHistoryScopeProtocol || !completedRead || typeof policyVersion !== 'number'
    || !Number.isSafeInteger(policyVersion) || policyVersion < 1 || policyVersion !== originalVersion) fail('context_changed');
  return policyVersion;
}

/** Same original read, with the existing semantic question-plan argument.
 * No report selector, business action or extra model call is introduced. */
export function reportQuestionPlanningTool(base: ModelTool, enabled: boolean): ModelTool {
  if (!enabled) return base;
  if (base.name !== 'query_followups') fail('invalid_agent_tools', 500);
  return { ...base, parameters: {
    type: 'object', properties: { questions: { ...structuredClone(sourceQuestionPlanSchema),
      description: '按顺序列出本轮真正要回答的各个独立问项，分别保留原因、核对步骤等并列追问。将最新更正、对象和条件写入它们所修正的问项；单纯的澄清陈述无需单列。用户口述仍是用户原话。此计划固定本轮逐Q作答范围，不授予权限或确认事实。',
    } }, required: ['questions'], additionalProperties: false,
  } };
}

function assertScope(scope: ReportQuestionPlanScope) {
  id(scope.enterpriseId); id(scope.runId); id(scope.messageId);
  if (typeof scope.question !== 'string' || !scope.question.trim() || !scope.selection) fail('context_changed');
  id(scope.selection.reportId); id(scope.selection.projectId); id(scope.selection.bindingId); id(scope.selection.conversationId);
  if (!Number.isSafeInteger(scope.selection.revision) || scope.selection.revision < 1 || !scope.selection.factsHash) fail('context_changed');
}

/** Called inside the authenticated read's existing transaction. The service
 * supplies every identity/hash; the model supplies questions only. This helper
 * neither resolves permission nor turns planned text into project evidence. */
export function createReportQuestionPlan(input: Record<string, unknown>, scope: ReportQuestionPlanScope): ReportQuestionPlan {
  assertScope(scope);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'questions')) fail('invalid_message', 422);
  const coverage = parsePlannedSourceQuestions(input);
  return { protocol: reportQuestionPlanningProtocol, enterpriseId: scope.enterpriseId, runId: scope.runId, messageId: scope.messageId,
    questionHash: fingerprint(scope.question), reportReferenceHash: fingerprint(scope.selection),
    coverage: { ...coverage, questions: [...coverage.questions] } };
}

/** Read one durable plan for the exact current admission/reference. Callers
 * still revalidate tenant, participant and sources through the original read.
 * Missing new plans fail closed; legacy callers get no implicit migration. */
export function readReportQuestionPlan(value: unknown, scope: ReportQuestionPlanScope, enabled: boolean): SourceQuestionCoverage | undefined {
  if (!enabled) { if (value !== undefined) fail('context_changed'); return undefined; }
  assertScope(scope);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('context_changed');
  const plan = value as ReportQuestionPlan;
  if (Object.keys(plan).length !== 7 || Object.keys(plan).some(k => !['protocol','enterpriseId','runId','messageId','questionHash','reportReferenceHash','coverage'].includes(k))
    || plan.protocol !== reportQuestionPlanningProtocol || plan.enterpriseId !== scope.enterpriseId || plan.runId !== scope.runId || plan.messageId !== scope.messageId
    || plan.questionHash !== fingerprint(scope.question) || plan.reportReferenceHash !== fingerprint(scope.selection)) fail('context_changed');
  try {
    const coverage = readSourceQuestionCoverage(plan.coverage);
    return { ...coverage, questions: [...coverage.questions] };
  } catch (error) {
    if (error instanceof AssistantError && ['invalid_message', 'context_changed'].includes(error.code)) fail('context_changed');
    throw error;
  }
}
