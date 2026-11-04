import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeFinalDefinition, explicitNativeObjectRoot } from '../agent/native-final';
import { boundReportFinalSchema, reportStructuralFinalSchema, reportFinalFunctionCarrier, reportNativeRuntimeBudget } from '../agent/report-native-final';
import { reportAnswerFinalTool } from '../agent/report-final';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { finalTool } from '../agent/worker';
import { businessSynthesisSources } from '../agent/synthesis';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { prepareReportAnswerReview, assertReportAnswerReview } from '../agent/report-answer-review';
import type { BusinessSnapshot } from '../agent/business-tools';

const question = '我看了这份日报，照明回路现在定下来了吗？我接下来该确认什么？';
const snapshot = { query: { domain: 'construction', leadId: '3' }, leadIds: ['3'], version: 'frozen-facts', queriedAt: '2026-11-03T19:13:14.815Z',
  reportAnswerGrounding: 'report-answer-grounding-v1', reportSourceProjection: 'report-parent-context-v1',
  reportReference: { principal: { kind: 'user', userId: '3' }, selection: { bindingId: '1', reportId: '1', revision: 1, projectId: '2', conversationId: '7',
    kind: 'daily', factsHash: 'frozen-facts', periodStart: '2026-11-03T16:00:00.000Z', periodEnd: '2026-11-03T19:13:14.815Z', cutoffAt: '2026-11-03T19:13:14.815Z' } },
  data: [{ id: '2', name: '合成测试·V1-02工地1', stageKey: 'utilities', records: [{ id: '2', version: 2, hash: 'frozen-record',
    publishedAt: '2026-11-03T19:12:00.000Z', room: '', data: { pending: 'B户照明回路待设计师核对，未记录完成期限。' } }], issues: [], arrangements: [], publishedRecordItems: [] }], displayText: '原冻结报告',
} as unknown as BusinessSnapshot;
const sources = businessSynthesisSources('saved:0:0', snapshot);
const ids = sources.flatMap(source => sourceCitationCatalog(source).map(option => option.citationId));
const record = sources.find(source => source.reportScope?.kind === 'record')!;
const citation = { citationId: sourceCitationCatalog(record)[0].citationId };
// Exact advice from configured01/run9; keep its list markers in the output.
const advice = '建议您下一步直接联系项目的设计师或管家进行确认。您可以询问他们：1. B户照明回路的具体点位和方案是否已最终敲定；2. 对应的施工排期大概是什么时候。在设计师正式核对并回复之前，不建议自行推进该区域的后续工序。';
const answer = { kind: 'report_answer', answers: {
  Q1: [{ basis: 'evidence', text: '根据这份日报（事实截止至2026-11-04 03:13:14）的现场原记录，B户照明回路仍待设计师核对，未记录完成期限。', citations: [citation] }],
  Q2: [{ basis: 'advice', text: advice, citations: [] as Array<{ citationId: string }> }],
} };
const base = reportAnswerFinalTool(finalTool, question, ids);
const legacy = explicitNativeObjectRoot(nativeFinalDefinition(base));
const current = explicitNativeObjectRoot(nativeFinalDefinition(base, { reportNumberValidation: 'synthesis' }));
const prepare = (value = answer) => prepareReportAnswerReview(JSON.stringify(value), sources, { currentQuestion: question });

test('only an explicit newly bound report schema changes quantity ownership; old and malformed policies stay fenced', () => {
  assert.equal(boundReportFinalSchema(undefined, true, reportFinalFunctionCarrier), undefined);
  assert.equal(boundReportFinalSchema(reportStructuralFinalSchema, true, reportFinalFunctionCarrier), reportStructuralFinalSchema);
  for (const value of [null, 'unknown', 'json_schema']) assert.throws(() => boundReportFinalSchema(value, true, reportFinalFunctionCarrier), /context_changed/);
  assert.throws(() => boundReportFinalSchema(reportStructuralFinalSchema, false, reportFinalFunctionCarrier), /context_changed/);
  assert.throws(() => boundReportFinalSchema(reportStructuralFinalSchema, true, undefined), /context_changed/);
  assert.deepEqual(nativeFinalDefinition(finalTool, { reportNumberValidation: 'synthesis' }), nativeFinalDefinition(finalTool));
  assert.deepEqual(reportNativeRuntimeBudget({ summaries: 0, perceptions: 0 }), {
    primaryModelTurns: 3, reservedValidationRepairs: 1, auxiliaryCalls: 0, maxScheduledCalls: 4, sourceReadSchedule: 'report-native-final-v1',
  });
});

test('saved ordinal prose enters the unchanged number/source guards without rewriting text or changing the old schema', async () => {
  const raw = JSON.stringify(answer), original = JSON.stringify(base);
  assert.ok(await toolSchemaIssue(legacy, raw));
  assert.equal(await toolSchemaIssue(current, raw), null);
  assert.doesNotThrow(() => prepare());
  assert.equal(JSON.stringify(base), original); assert.equal(JSON.stringify(answer), raw);
  assert.equal(answer.answers.Q2[0].text, advice);
  assert.ok(await toolSchemaIssue(legacy, raw), 'Old snapshots retain their original schema on resume');
});

test('numbers belong to the original synthesis guard, including amounts, dates and ambiguous unit-prefixed list markers', async () => {
  for (const text of [advice + '施工必须等待3天。', advice + '施工必须等待三天。', '建议核实：1. 米；2. 现场条件。', '明天8点安装。']) {
    const value = structuredClone(answer); value.answers.Q2[0].text = text;
    assert.equal(await toolSchemaIssue(current, JSON.stringify(value)), null);
    assert.throws(() => prepare(value), /unsupported_model_commitment/);
  }
  const wrongTime = structuredClone(answer); wrongTime.answers.Q1[0].text = wrongTime.answers.Q1[0].text.replace('03:13:14', '20:59:58');
  assert.throws(() => prepare(wrongTime), /unsupported_model_commitment/);
});

test('schema still rejects missing questions, uncited evidence and foreign citation identities', async () => {
  const missing = { kind: 'report_answer', answers: { Q1: answer.answers.Q1 } };
  const uncited = structuredClone(answer); uncited.answers.Q1[0].citations = [];
  const foreign = structuredClone(answer); foreign.answers.Q1[0].citations = [{ citationId: 'foreign' }];
  for (const value of [missing, uncited, foreign]) assert.ok(await toolSchemaIssue(current, JSON.stringify(value)));
  assert.throws(() => prepare(uncited), /invalid_model_answer/);
  assert.throws(() => prepare(foreign), /invalid_model_citation/);
});

test('a structural pass still requires the original independent hash-bound semantic verdict', () => {
  const draft = prepare();
  const output = { text: JSON.stringify({ questionsComplete: true, checks: {
    Q1: { complete: true, supported: false, conditionsPreserved: false, reason: '未注明房间的记录不能证明客厅或最新状态。' },
    Q2: { complete: true, supported: true, conditionsPreserved: true, reason: '' },
  } }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null };
  assert.throws(() => assertReportAnswerReview(draft, output, draft.binding), /ungrounded_response_scope/);
  assert.throws(() => assertReportAnswerReview(draft, output, 'stale-binding'), /context_changed/);
});
