import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundReportHistoryScope, boundReportQuestionPlanning, boundReportReadCompletion, createReportQuestionPlan, readReportQuestionPlan, reportHistoryScopeProtocol, reportQuestionPlanningProtocol, reportQuestionPlanningTool, reportReadCompletionProtocol, type ReportQuestionPlanScope } from '../agent/report-question-plan';
import { reportFollowupTool } from '../agent/report-context';
import { reportAnswerSynthesis, reportQuestionCoverage } from '../agent/report-final';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { constructionReadOnlyTools, finalToolForMessages, reportRequiredReadsComplete } from '../agent/worker';
import { focusedSynthesisMessages, type SynthesisSource } from '../agent/synthesis';
import { assertReportAnswerReview, prepareReportAnswerReview } from '../agent/report-answer-review';
import { reportAnswerGroundingProtocol } from '../agent/report-source-scope';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';

const first = '我看了这份日报，照明回路现在定下来了吗？我接下来该确认什么？';
const corrected = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const correctedSentences = ['刚才说错了，我问的是客厅，不是卧室。', '要是周五要装灯，现在还缺哪一步？'];
const scope: ReportQuestionPlanScope = { enterpriseId: '1454', runId: '15', messageId: '50', question: corrected,
  selection: { bindingId: '1', reportId: '1', revision: 1, projectId: '2', conversationId: '7', kind: 'daily',
    periodStart: '2026-11-03T16:00:00.000Z', periodEnd: '2026-11-03T19:13:14.815Z', cutoffAt: '2026-11-03T19:13:14.815Z', factsHash: 'frozen-facts' } };

test('only explicit grounded admission enables plans; an old run/tool has no silent strategy upgrade', () => {
  assert.equal(boundReportQuestionPlanning(undefined, true), false);
  assert.equal(boundReportQuestionPlanning(reportQuestionPlanningProtocol, true), true);
  for (const value of [null, 'unknown', false]) assert.throws(() => boundReportQuestionPlanning(value, true), /context_changed/);
  assert.throws(() => boundReportQuestionPlanning(reportQuestionPlanningProtocol, false), /context_changed/);
  assert.equal(reportQuestionPlanningTool(reportFollowupTool, false), reportFollowupTool);
  assert.equal(readReportQuestionPlan(undefined, scope, false), undefined);
  assert.throws(() => readReportQuestionPlan(createReportQuestionPlan({ questions: correctedSentences }, scope), scope, false), /context_changed/);
});

test('report history scopes apply only to newly bound runs and the exact accepted original selection', () => {
  assert.equal(boundReportHistoryScope(undefined, true, 14, 14), undefined);
  assert.equal(boundReportHistoryScope(reportHistoryScopeProtocol, true, 14, 14), 14);
  for (const [enabled, policy, original] of [[true, 14, 8], [true, 14, '14'], [true, 0, 0], [true, undefined, undefined], [false, 14, 14]])
    assert.throws(() => boundReportHistoryScope(reportHistoryScopeProtocol, Boolean(enabled), policy, original), /context_changed/);
  assert.throws(() => boundReportHistoryScope('unknown', true, 14, 14), /context_changed/);
});

test('one original read accepts only question-plan data; provider cannot choose another report or identity', async () => {
  const original = JSON.stringify(reportFollowupTool), tool = reportQuestionPlanningTool(reportFollowupTool, true);
  assert.equal(await toolSchemaIssue(tool, JSON.stringify({ questions: [corrected] })), null);
  for (const value of [{}, { questions: [] }, { questions: ['重复', '重复'] }, { questions: ['问题'], reportId: '9' }, { questions: ['问题'], runId: '9' }])
    assert.ok(await toolSchemaIssue(tool, JSON.stringify(value)));
  assert.equal(JSON.stringify(reportFollowupTool), original);
  assert.throws(() => createReportQuestionPlan({ questions: [corrected], reportId: '9' }, scope), /invalid_message/);
});

test('plan survives serialization for the same immutable request/reference without changing the question', () => {
  const questions = [...correctedSentences], plan = createReportQuestionPlan({ questions }, scope), saved = JSON.parse(JSON.stringify(plan));
  questions[0] = '外部修改不能重写已绑定计划';
  assert.deepEqual(readReportQuestionPlan(saved, scope, true)?.questions, correctedSentences);
  const read = readReportQuestionPlan(saved, scope, true)!; read.questions[0] = '返回对象也不是可写持久状态';
  assert.deepEqual(readReportQuestionPlan(saved, scope, true)?.questions, correctedSentences);
  assert.equal(scope.question, corrected);
});

test('tenant/run/message/original/reference changes revoke the saved plan', () => {
  const plan = createReportQuestionPlan({ questions: correctedSentences }, scope);
  for (const changed of [{ ...scope, enterpriseId: '1455' }, { ...scope, runId: '16' }, { ...scope, messageId: '51' },
    { ...scope, question: corrected + '新的更正' }, { ...scope, selection: { ...scope.selection, revision: 2 } },
    { ...scope, selection: { ...scope.selection, projectId: '3' } }, { ...scope, selection: { ...scope.selection, factsHash: 'changed' } }])
    assert.throws(() => readReportQuestionPlan(plan, changed, true), /context_changed/);
});

test('missing, unknown and malformed new plans never fall back to sentence splitting', () => {
  const plan = createReportQuestionPlan({ questions: correctedSentences }, scope);
  for (const value of [undefined, null, {}, { ...plan, protocol: 'unknown' }, { ...plan, extra: true },
    { ...plan, coverage: { protocol: 'unknown', questions: correctedSentences } },
    { ...plan, coverage: { protocol: 'source-question-coverage-v1', questions: [] } }])
    assert.throws(() => readReportQuestionPlan(value, scope, true), /context_changed/);
});

test('a merged plan question is split at sentence boundaries so each clause keeps its own obligation', () => {
  assert.deepEqual(createReportQuestionPlan({ questions: [corrected] }, scope).coverage.questions, correctedSentences);
  assert.deepEqual(createReportQuestionPlan({ questions: correctedSentences }, scope).coverage.questions, correctedSentences);
  const narrowed = createReportQuestionPlan({ questions: [correctedSentences[1]] }, scope).coverage.questions;
  assert.deepEqual(narrowed, [correctedSentences[1]]);
});

test('two real questions retain two obligations while a planned correction stays attached to its question', () => {
  const firstCoverage = readReportQuestionPlan(createReportQuestionPlan({ questions: ['我看了这份日报，照明回路现在定下来了吗？', '我接下来该确认什么？'] }, { ...scope, question: first }), { ...scope, question: first }, true)!;
  assert.equal(firstCoverage.questions.length, 2);
  const missingSecond = JSON.stringify({ kind: 'report_answer', answers: { Q1: [{ basis: 'uncertainty', text: '本次仍待核对。', citations: [] }] } });
  assert.throws(() => reportAnswerSynthesis(missingSecond, firstCoverage), /incomplete_model_answer/);
  const planned = readReportQuestionPlan(createReportQuestionPlan({ questions: correctedSentences }, scope), scope, true)!;
  assert.deepEqual(planned.questions, correctedSentences);
  assert.equal(reportQuestionCoverage(corrected).questions.length, 2, 'Legacy sentence grouping remains available only through its old path');
});

test('the paired report read, focused input and final schema use the same planned questions', () => {
  const single = [correctedSentences[1]];
  const planned = readReportQuestionPlan(createReportQuestionPlan({ questions: single }, scope), scope, true)!;
  const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: scope.messageId, text: corrected }) }] };
  const read: ModelMessage = { role: 'assistant', content: '', toolCalls: [{ name: 'query_followups', id: 'read', arguments: JSON.stringify({ questions: single }) }] };
  const packet = { query: { domain: 'construction' }, reportReference: { selection: scope.selection }, synthesisSources: [] };
  const messages = (questionCoverage?: unknown): ModelMessage[] => [current, read, { role: 'tool', callId: 'read', content: JSON.stringify({ ...packet, questionCoverage }) }];
  const view = focusedSynthesisMessages(messages(planned), scope.messageId, planned);
  assert.deepEqual(view.at(-1), current);
  assert.match(JSON.stringify(view), /questionCoverage/);
  const required = (tool: ReturnType<typeof finalToolForMessages>) =>
    (tool.parameters.properties as Record<string, { required: string[] }>).answers.required;
  assert.deepEqual(required(finalToolForMessages(view, corrected, false, false, false, false, planned)), ['Q1']);
  assert.deepEqual(required(finalToolForMessages(focusedSynthesisMessages(messages(), scope.messageId), corrected)), ['Q1', 'Q2']);
  assert.throws(() => finalToolForMessages(view.filter(m => m !== read), corrected, false, false, false, false, planned), /context_changed/);
  for (const value of [undefined, reportQuestionCoverage(corrected)]) {
    assert.throws(() => focusedSynthesisMessages(messages(value), scope.messageId, planned), /context_changed/);
    assert.throws(() => finalToolForMessages(messages(value), corrected, false, false, false, false, planned), /context_changed/);
  }
  assert.equal(constructionReadOnlyTools('construction_followup', true)?.[0], reportFollowupTool);
  assert.deepEqual(constructionReadOnlyTools('construction_followup', true, true)?.[0].parameters.required, ['questions']);
  assert.deepEqual(constructionReadOnlyTools('project_collaboration', true, true), constructionReadOnlyTools('project_collaboration', true));
});

test('the reviewer sees the full original independently of the plan and still rejects incomplete or mis-scoped advice', () => {
  const coverage = readReportQuestionPlan(createReportQuestionPlan({ questions: [correctedSentences[1]] }, scope), scope, true)!;
  const sources: SynthesisSource[] = [{ sourceId: 'report', kind: 'project', title: '报告', text: '房间未记录。',
    reportScope: { protocol: reportAnswerGroundingProtocol } as SynthesisSource['reportScope'] }];
  const raw = JSON.stringify({ kind: 'report_answer', answers: { Q1: [{ basis: 'advice', text: '建议联系团队。', citations: [] }] } });
  const draft = prepareReportAnswerReview(raw, sources, { currentQuestion: corrected }, [], coverage);
  const message = draft.reviewMessages[1];
  assert.ok(message.role === 'user' && message.content[0].type === 'text');
  const input = JSON.parse(message.content[0].text);
  assert.equal(input.currentQuestion, corrected);
  assert.deepEqual(input.questions, { Q1: correctedSentences[1] });
  assert.throws(() => assertReportAnswerReview(draft, { text: JSON.stringify({ questionsComplete: false,
    checks: { Q1: { complete: false, supported: true, conditionsPreserved: false, reason: '遗漏客厅更正和周五条件。' } } }),
    toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null }, draft.binding), /ungrounded_response_scope/);
  assert.throws(() => prepareReportAnswerReview(raw, sources, { currentQuestion: corrected }), /incomplete_model_answer/);
});

test('planned reads enter the existing final-only stage, including resume, after required sources are available', async () => {
  assert.equal(boundReportReadCompletion(undefined, true), false);
  assert.equal(boundReportReadCompletion(reportReadCompletionProtocol, true), true);
  assert.throws(() => boundReportReadCompletion(reportReadCompletionProtocol, false), /context_changed/);
  assert.throws(() => boundReportReadCompletion('unknown', true), /context_changed/);
  const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: scope.messageId, text: first }) }] };
  const questions = ['照明回路现在定下来了吗？', '我接下来该确认什么？'];
  const packet = JSON.stringify({ query: { domain: 'construction' }, reportReference: { selection: scope.selection }, synthesisSources: [],
    questionCoverage: createReportQuestionPlan({ questions }, { ...scope, question: first }).coverage });
  const call = { name: 'query_followups', id: 'read', arguments: JSON.stringify({ questions }) };
  const base = { usage: null, finishReason: 'stop', providerRequestId: null };
  const final = JSON.stringify({ kind: 'report_answer', answers: { Q1: [], Q2: [] } });
  const read: ModelMessage = { role: 'tool', callId: 'read', content: packet };
  const paths: string[][] = [];
  const checkpoints: AgentCheckpoint[] = [];
  let reads = 0;
  const ports = {
    authorize: async () => {},
    checkpoint: async (state: AgentCheckpoint) => { checkpoints.push(structuredClone(state)); },
    canFinalizeContext: (messages: ModelMessage[]) => reportRequiredReadsComplete(first, scope.messageId, messages),
    tool: async () => { reads++; return { content: packet }; },
    model: async (turn: number, _messages: ModelMessage[], tools: Array<{ name: string }>): Promise<ModelTurnOutput> => {
      paths.push(tools.map(tool => tool.name));
      if (!turn) return { ...base, text: '', toolCalls: [call] };
      assert.equal(tools.length, 0, 'A second planning dispatch exposed the run20 failure path');
      return { ...base, text: final, toolCalls: [] };
    },
  };
  const input = { messages: [current], tools: constructionReadOnlyTools('construction_followup', true, true)!,
    nativeFinalization: true, primaryModelTurns: 3, reservedValidationRepairs: 1 as const, ports };
  assert.equal((await runRenovationAgent(input)).output?.text, final);
  assert.deepEqual(paths, [['query_followups', 'search_knowledge', 'finish_context'], []]);
  assert.equal(reads, 1);
  const resume = checkpoints.find(state => state.turn === 1 && !state.output)!;
  assert.equal((await runRenovationAgent({ ...input, resume })).output?.text, final);
  assert.deepEqual(paths.at(-1), []);
  assert.equal(reads, 1);
  assert.equal(reportRequiredReadsComplete(first, scope.messageId, [current, read]), false);
  assert.equal(reportRequiredReadsComplete('请查企业标准原文。', scope.messageId, resume.messages), false);
});
