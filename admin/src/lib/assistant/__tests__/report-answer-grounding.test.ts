import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import type { BusinessSnapshot } from '../agent/business-tools';
import type { ReportProject } from '@/lib/construction/report-scope';
import { businessSynthesisSources, focusedSynthesisMessages, parseSynthesis } from '../agent/synthesis';
import { reportFactText } from '../agent/report-context';
import { sourceCitationCatalog, modelCitationCatalog } from '../agent/citation-catalog';
import { boundReportAnswerGrounding, reportAnswerGroundingProtocol } from '../agent/report-source-scope';
import { prepareReportAnswerReview, assertReportAnswerReview, reportAnswerValidationFailure } from '../agent/report-answer-review';
import { runRenovationAgent } from '../agent/runtime';
import { reportAnswerFinalTool } from '../agent/report-final';
import { finalTool } from '../agent/worker';
import { explicitNativeObjectRoot, nativeFinalDefinition } from '../agent/native-final';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { boundReportCoordination, prepareReportKnowledgeReview, reportCoordinationAnswer, reportCoordinationText } from '../agent/report-coordination';
import { reportCoordinationProtocol } from '../agent/report-question-plan';

const selection = { bindingId: '22', reportId: '61', revision: 1, projectId: '247', conversationId: '855', kind: 'daily',
  periodStart: '2026-10-31T16:00:00.000Z', periodEnd: '2026-11-01T12:00:00.000Z', cutoffAt: '2026-11-01T12:00:00.000Z', factsHash: 'frozen-hash' };
const project = { id: '247', name: '合成测试报告工地', stageKey: 'utilities', records: [{ id: '237', version: 2, hash: 'record-hash',
  publishedAt: '2026-11-01T04:00:00.000Z', room: '', data: { title: '现场原记录', pending: 'B户照明回路待设计师核对，未记录完成期限。' } }],
  issues: [], arrangements: [], publishedRecordItems: [] } as unknown as ReportProject;
const snapshot: BusinessSnapshot = { query: { domain: 'construction', leadId: '3142' }, leadIds: ['3142'], version: selection.factsHash,
  queriedAt: selection.cutoffAt, reportReference: { selection, principal: { kind: 'user', userId: '3912' } },
  reportAnswerGrounding: reportAnswerGroundingProtocol, data: [project], displayText: reportFactText(selection, project) };
const sources = businessSynthesisSources('saved:0:0', snapshot);
const metadata = sources.find(source => source.reportScope?.kind === 'metadata')!;
const record = sources.find(source => source.reportScope?.kind === 'record')!;
const citation = (source: typeof record) => ({ citationId: sourceCitationCatalog(source)[0].citationId });
const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const answers = { Q1: [{ basis: 'uncertainty', text: '你问的是客厅，原记录没有注明房间，这次不能据此确定客厅灯位的确认状态。', citations: [citation(record)] }],
  Q2: [{ basis: 'advice', text: '如果周五要装灯，建议向团队核实客厅点位对应的确认记录和最新安排。', citations: [] }] };
const raw = JSON.stringify({ kind: 'report_answer', answers });
const response = (supported = true): ModelTurnOutput => ({ text: JSON.stringify({ questionsComplete: true,
  checks: Object.fromEntries(['Q1', 'Q2'].map(key => [key, { complete: true, supported, conditionsPreserved: true,
    reason: supported ? '' : '未注明房间的原记录不证明客厅的灯位或控制逻辑状态。' }])) }),
  toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });

test('server referral adds no approval, transfer, report fact, or unsupported numerical commitment', () => {
  assert.equal(boundReportCoordination(undefined, true), false);
  assert.equal(boundReportCoordination(reportCoordinationProtocol, true), true);
  assert.throws(() => boundReportCoordination(reportCoordinationProtocol, false), /context_changed/);
  for (const currentQuestion of [question, '我说的是A户，客户刚口头说可以往左挪一点。这样算确认了吗，下一步怎么接？']) {
    const answer = parseSynthesis(reportCoordinationAnswer, [], { currentQuestion });
    assert.deepEqual(answer.segments, [{ basis: 'uncertainty', text: reportCoordinationText, citations: [] }]);
  }
});

test('a mixed reply only generates knowledge from knowledge sources and binds the fixed referral into its original review', () => {
  const knowledge = { sourceId: 'K:example', kind: 'knowledge' as const, title: '说明', text: '导线接头应放在接线盒内。' };
  const context = { currentQuestion: '导线接头放哪？我家现在能施工吗？' };
  const knowledgeRaw = JSON.stringify({ kind: 'synthesis', segments: [
    { basis: 'evidence', text: '导线接头应放在接线盒内。', citations: [citation(knowledge as typeof record)] },
  ] });
  const mixed = prepareReportKnowledgeReview(knowledgeRaw, [...sources, knowledge], context, [], true);
  const onlyKnowledge = prepareReportKnowledgeReview(knowledgeRaw, [knowledge], context, [], false);
  assert.equal(mixed.answer.segments.at(-1)?.text, reportCoordinationText);
  assert.notEqual(mixed.binding, onlyKnowledge.binding);
  const reviewMessage = mixed.reviewMessages[1];
  assert.ok(reviewMessage.role === 'user' && reviewMessage.content[0].type === 'text');
  const review = JSON.parse(reviewMessage.content[0].text);
  assert.equal(review.currentQuestion, context.currentQuestion);
  assert.deepEqual(review.sources.map((source: { kind: string }) => source.kind), ['knowledge']);
  assert.throws(() => prepareReportKnowledgeReview(knowledgeRaw, sources, context, [], true), /invalid_model_citation/);
  const uncited = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', text: '可直接埋进墙内。', citations: [] }] });
  assert.throws(() => prepareReportKnowledgeReview(uncited, [knowledge], context, [], true), /ungrounded_response_scope/);
});

test('new admission is explicit; old report sources and unknown policy cannot gain the new mechanism', () => {
  assert.equal(boundReportAnswerGrounding(undefined, true), false);
  assert.equal(boundReportAnswerGrounding(reportAnswerGroundingProtocol, true), true);
  assert.throws(() => boundReportAnswerGrounding(reportAnswerGroundingProtocol, false), /context_changed/);
  assert.throws(() => boundReportAnswerGrounding('unknown', true), /context_changed/);
  const legacy = { ...snapshot }; delete legacy.reportAnswerGrounding;
  const oldSources = businessSynthesisSources('saved:0:0', legacy);
  assert.equal(oldSources.length, 1); assert.equal(oldSources[0].sourceId, 'Bsaved:0:0');
  assert.equal(oldSources[0].text, snapshot.displayText); assert.equal(oldSources[0].reportScope, undefined);
  assert.throws(() => prepareReportAnswerReview(raw, oldSources, { currentQuestion: question }), /context_changed/);
  assert.throws(() => businessSynthesisSources('saved:0:0', { ...snapshot, data: [{ ...project, id: 'other-project' }] }), /context_changed/);
});

test('report times, stage and each original have independent citations and preserve frozen scope without mutation', () => {
  const before = JSON.stringify(snapshot);
  assert.equal(sources.length, 3);
  assert.equal(metadata.reportScope?.cutoffAt, selection.cutoffAt);
  assert.match(metadata.text, /事实截止：2026-11-01 20:00:00/);
  assert.doesNotMatch(metadata.text, /B户照明回路/);
  assert.match(record.text, /B户照明回路待设计师核对/);
  assert.doesNotMatch(record.text, /事实截止|utilities/);
  assert.deepEqual(record.reportScope?.room, { status: 'unspecified' });
  assert.equal(record.reportScope?.itemId, '237'); assert.equal(record.reportScope?.itemVersion, 2);
  assert.equal(record.reportScope?.sourceHash, 'record-hash');
  const scoped = businessSynthesisSources('saved:0:0', { ...snapshot, data: [{ ...project, records: [{ ...project.records[0], room: '厨房' }] }] });
  assert.deepEqual(scoped.find(s => s.reportScope?.kind === 'record')?.reportScope?.room, { status: 'recorded', name: '厨房' });
  assert.equal(JSON.stringify(snapshot), before);
});

test('per-original report scope survives model projection, aliases and the existing bound semantic-review input', () => {
  const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text: question }) }] };
  const packet = { ...snapshot, resultKey: 'saved:0:0', synthesisSources: sources.map(s => ({ ...s, citationOptions: modelCitationCatalog(s) })) };
  const messages: ModelMessage[] = [current, { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'query_followups', arguments: '{}' }] },
    { role: 'tool', callId: 'read', content: JSON.stringify(packet) }];
  const before = JSON.stringify(messages), view = focusedSynthesisMessages(messages, 'current');
  const tool = view.find(m => m.role === 'tool')!;
  const projected = JSON.parse(tool.role === 'tool' ? tool.content : '{}');
  assert.deepEqual(projected.synthesisSources.find((s: typeof record) => s.sourceId === record.sourceId).reportScope, record.reportScope);
  const draft = prepareReportAnswerReview(raw, sources, { currentQuestion: question }, [current]);
  const data = draft.reviewMessages[1];
  const review = JSON.parse(data.role === 'user' && data.content[0].type === 'text' ? data.content[0].text : '{}');
  assert.equal(review.currentQuestion, question); assert.equal(review.protocol, reportAnswerGroundingProtocol);
  assert.deepEqual(review.sources.find((s: typeof record) => s.sourceId === record.sourceId).reportScope.room, { status: 'unspecified' });
  assert.equal(review.answers.Q1[0].citations[0].quote, sourceCitationCatalog(record)[0].quote);
  assert.equal(JSON.stringify(messages), before);
});

test('uncited dates still fail the original schema and numeric guards; a matching metadata citation cannot support another record', async () => {
  const date = structuredClone(answers); date.Q1[0].text = '报告事实截止于2026-11-01 20:00:00。'; date.Q1[0].citations = [];
  const tool = explicitNativeObjectRoot(nativeFinalDefinition(reportAnswerFinalTool(finalTool, question, sources.flatMap(sourceCitationCatalog).map(c => c.citationId))));
  assert.ok(await toolSchemaIssue(tool, JSON.stringify({ kind: 'report_answer', answers: date })));
  assert.throws(() => prepareReportAnswerReview(JSON.stringify({ kind: 'report_answer', answers: date }), sources, { currentQuestion: question }), /unsupported_model_commitment/);
  date.Q1[0].citations = [citation(metadata)];
  assert.equal(await toolSchemaIssue(tool, JSON.stringify({ kind: 'report_answer', answers: date })), null);
  assert.doesNotThrow(() => prepareReportAnswerReview(JSON.stringify({ kind: 'report_answer', answers: date }), sources, { currentQuestion: question }));
  date.Q1[0].citations = [citation(record)];
  assert.throws(() => prepareReportAnswerReview(JSON.stringify({ kind: 'report_answer', answers: date }), sources, { currentQuestion: question }), /unsupported_model_commitment/);
});

test('semantic rejection, stale draft/source binding and incomplete verdict stop without rewriting or accepting the first draft', () => {
  const draft = prepareReportAnswerReview(raw, sources, { currentQuestion: question });
  assert.doesNotThrow(() => assertReportAnswerReview(draft, response(), draft.binding));
  assert.throws(() => assertReportAnswerReview(draft, response(false), draft.binding), /ungrounded_response_scope/);
  assert.throws(() => assertReportAnswerReview(draft, response(), 'foreign-binding'), /context_changed/);
  assert.throws(() => prepareReportAnswerReview(raw, sources.map(s => s === record ? { ...s, text: s.text + '\n补充原文' } : s), { currentQuestion: question }), /invalid_model_citation/);
  const other = prepareReportAnswerReview(raw, sources.map(s => s === record ? { ...s, reportScope: { ...s.reportScope!, room: { status: 'recorded', name: '厨房' } } } : s), { currentQuestion: question });
  assert.notEqual(other.binding, draft.binding);
  const incomplete = response(); incomplete.text = JSON.stringify({ questionsComplete: true, checks: { Q1: { complete: true, supported: true, conditionsPreserved: true, reason: '' } } });
  assert.throws(() => assertReportAnswerReview(draft, incomplete, draft.binding), /incomplete_model_answer/);
  assert.equal(draft.raw, raw);
});

test('new grounded validation failures stop before a redraft can consume the mandatory review slot; legacy repair stays bounded', async () => {
  const failure = { code: 'unsupported_model_commitment', feedback: '已有报告日期缺本段正确引用。' };
  for (const grounded of [true, false]) {
    let calls = 0, validations = 0, writes = 0;
    const operation = runRenovationAgent({ messages: [], tools: [], ports: {
      authorize: async () => {}, checkpoint: async () => {},
      tool: async () => { writes++; return { content: '{}' }; },
      model: async () => { calls++; return { ...response(), text: raw }; },
      validateFinal: async () => ++validations === 1 ? reportAnswerValidationFailure(failure, grounded) : null,
    } });
    if (grounded) await assert.rejects(operation, /unsupported_model_commitment/);
    else await operation;
    assert.equal(calls, grounded ? 1 : 2); assert.equal(writes, 0);
  }
});
