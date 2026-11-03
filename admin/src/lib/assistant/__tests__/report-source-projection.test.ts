import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BusinessQuery, BusinessSnapshot } from '../agent/business-tools';
import type { ReportProject } from '@/lib/construction/report-scope';
import { businessSynthesisSources, type SynthesisSource } from '../agent/synthesis';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { prepareReportAnswerReview, assertReportAnswerReview } from '../agent/report-answer-review';
import { boundReportSourceProjection, reportSourceProjectionProtocol } from '../agent/report-source-scope';

const selection = { bindingId: '22', reportId: '61', revision: 1, projectId: '247', conversationId: '855', kind: 'daily',
  periodStart: '2026-10-31T16:00:00.000Z', periodEnd: '2026-11-01T12:00:00.000Z', cutoffAt: '2026-11-01T12:00:00.000Z', factsHash: 'frozen-hash' };
const project = { id: '247', name: '合成测试报告工地', stageKey: 'utilities', records: [{ id: '237', version: 2, hash: 'record-hash',
  publishedAt: '2026-11-01T04:00:00.000Z', room: '', data: { title: '现场原记录', pending: 'B户照明回路待设计师核对，未记录完成期限。' } }],
  issues: [], arrangements: [], publishedRecordItems: [] } as unknown as ReportProject;
type ReportSnapshot = Extract<BusinessSnapshot, { query: BusinessQuery }>;
const legacy: ReportSnapshot = { query: { domain: 'construction', leadId: '3142' }, leadIds: ['3142'], version: selection.factsHash,
  queriedAt: selection.cutoffAt, reportReference: { selection, principal: { kind: 'user', userId: '3912' } },
  reportAnswerGrounding: 'report-answer-grounding-v1', data: [project], displayText: '原冻结报告' };
const current: ReportSnapshot = { ...legacy, reportSourceProjection: 'report-parent-context-v1' };
const question = '我看了这份日报，照明回路现在定下来了吗？我接下来该确认什么？';
const record = (snapshot: BusinessSnapshot) => businessSynthesisSources('saved:0:0', snapshot).find(source => source.reportScope?.kind === 'record')!;
const citation = (snapshot: BusinessSnapshot) => ({ citationId: sourceCitationCatalog(record(snapshot))[0].citationId });
const raw = (snapshot: BusinessSnapshot) => JSON.stringify({ kind: 'report_answer', answers: {
  Q1: [{ basis: 'evidence', text: '按这份日报（事实截止至2026-11-01 20:00），B户照明回路记为待设计师核对，未记完成期限。', citations: [citation(snapshot)] }],
  Q2: [{ basis: 'advice', text: '建议向团队核实点位对应的确认记录和最新安排。', citations: [] }],
} });
const prepare = (value: string, snapshot = current) => prepareReportAnswerReview(value, businessSynthesisSources('saved:0:0', snapshot), { currentQuestion: question });

test('source projection is opt-in on an already grounded admission and cannot upgrade an old or unknown policy', () => {
  assert.equal(boundReportSourceProjection(undefined, true), false);
  assert.equal(boundReportSourceProjection(reportSourceProjectionProtocol, true), true);
  assert.throws(() => boundReportSourceProjection(reportSourceProjectionProtocol, false), /context_changed/);
  assert.throws(() => boundReportSourceProjection('unknown-projection', true), /context_changed/);
  const ungrounded = { ...current }; delete ungrounded.reportAnswerGrounding;
  assert.throws(() => businessSynthesisSources('saved:0:0', ungrounded), /context_changed/);
  assert.throws(() => businessSynthesisSources('saved:0:0', { ...current, reportSourceProjection: 'unknown-projection' } as unknown as BusinessSnapshot), /context_changed/);
});

test('a selected report original retains its trusted parent cutoff in the same citable context; the old projection stays unchanged', () => {
  const before = JSON.stringify(current), oldSources = businessSynthesisSources('saved:0:0', legacy);
  assert.equal(record(legacy).reportScope?.cutoffAt, selection.cutoffAt);
  assert.doesNotMatch(sourceCitationCatalog(record(legacy))[0].quote, /20:00/);
  assert.throws(() => prepare(raw(legacy), legacy), /unsupported_model_commitment/);
  const draft = prepare(raw(current));
  assert.match(draft.answer.segments[0].citations[0].quote, /事实截止：2026-11-01 20:00:00/);
  assert.match(draft.answer.segments[0].citations[0].quote, /B户照明回路待设计师核对/);
  assert.deepEqual(record(current).reportScope?.room, { status: 'unspecified' });
  assert.equal(record(current).reportScope?.sourceHash, 'record-hash');
  assert.equal(record(current).reportScope?.itemVersion, 2);
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(businessSynthesisSources('saved:0:0', legacy), oldSources);
  assert.notEqual(citation(current).citationId, citation(legacy).citationId);
  assert.throws(() => prepare(raw(legacy)), /invalid_model_citation/);
});

test('parent context never fills an absent citation, changes the cutoff, or resolves a foreign report reference', () => {
  const wrongTime = JSON.parse(raw(current)); wrongTime.answers.Q1[0].text = wrongTime.answers.Q1[0].text.replace('20:00', '21:00');
  assert.throws(() => prepare(JSON.stringify(wrongTime)), /unsupported_model_commitment/);
  const absent = JSON.parse(raw(current)); absent.answers.Q1[0].citations = [];
  assert.throws(() => prepare(JSON.stringify(absent)), /invalid_model_answer/);
  const other = { ...current, reportReference: { ...current.reportReference!, selection: { ...selection, cutoffAt: '2026-11-01T13:00:00.000Z' } } } as BusinessSnapshot;
  const stale = JSON.parse(raw(current)); stale.answers.Q1[0].citations = [citation(other)];
  assert.throws(() => prepare(JSON.stringify(stale)), /invalid_model_citation/);
});

test('contextualized report sources still require the original independent semantic verdict, including room/condition support', () => {
  const draft = prepare(raw(current));
  const review = draft.reviewMessages[1];
  const packet = JSON.parse(review.role === 'user' && review.content[0].type === 'text' ? review.content[0].text : '{}');
  const original = packet.sources.find((source: Pick<SynthesisSource, 'reportScope'>) => source.reportScope?.kind === 'record');
  assert.equal(original.reportScope.cutoffAt, selection.cutoffAt);
  assert.deepEqual(original.reportScope.room, { status: 'unspecified' });
  const output = { text: JSON.stringify({ questionsComplete: true, checks: {
    Q1: { complete: true, supported: false, conditionsPreserved: false, reason: '未注明房间的记录不能证明客厅或最新施工状态。' },
    Q2: { complete: true, supported: true, conditionsPreserved: true, reason: '' },
  } }), toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null };
  assert.throws(() => assertReportAnswerReview(draft, output, draft.binding), /ungrounded_response_scope/);
  assert.throws(() => assertReportAnswerReview(draft, output, 'stale-binding'), /context_changed/);
});

test('a longer original remains complete, with bounded exact citation spans and no silent cross-project context', () => {
  const pending = '待核对的完整原记录。'.repeat(80);
  const longer = { ...current, data: [{ ...project, records: [{ ...project.records[0], data: { title: '长原记录', pending } }] }] } as BusinessSnapshot;
  const source = record(longer), options = sourceCitationCatalog(source);
  assert.ok(source.text.includes(pending));
  assert.match(source.text, /事实截止：2026-11-01 20:00:00/);
  assert.ok(options.length > 1);
  for (const option of options) { assert.ok(option.quote.length <= 400); assert.equal(source.text.slice(option.start, option.end), option.quote); }
  assert.equal(new Set(options.map(option => option.citationId)).size, options.length);
  assert.throws(() => businessSynthesisSources('saved:0:0', { ...current, data: [{ ...project, id: 'other-project' }] }), /context_changed/);
});

test('each child keeps its own item identity and the shared frozen report scope, without absorbing another record', () => {
  const combined = { ...current, data: [{ ...project,
    records: [...project.records, { ...project.records[0], id: '238', hash: 'another-hash', room: '厨房', data: { title: '另一原记录', pending: '厨房插座位置待核对。' } }],
    issues: [{ id: '301', revision: 2, hash: 'issue-hash', room: '厨房', text: '核实厨房插座对应位置。' }],
    arrangements: [{ id: '302', revision: 1, hash: 'arrangement-hash', room: '厨房', title: '待核对安排', difference: '尚未约定安装日。' }],
  }] } as unknown as BusinessSnapshot;
  const sources = businessSynthesisSources('saved:0:0', combined), records = sources.filter(source => source.reportScope?.kind === 'record');
  assert.equal(records.length, 2);
  assert.match(records[0].text, /B户照明回路/); assert.doesNotMatch(records[0].text, /厨房插座位置待核对/);
  assert.match(records[1].text, /厨房插座位置待核对/); assert.doesNotMatch(records[1].text, /B户照明回路/);
  assert.notEqual(sourceCitationCatalog(records[0])[0].citationId, sourceCitationCatalog(records[1])[0].citationId);
  for (const source of sources.filter(source => source.reportScope?.kind !== 'metadata')) {
    assert.equal(source.reportScope?.cutoffAt, selection.cutoffAt);
    assert.equal(source.reportScope?.projection, reportSourceProjectionProtocol);
    assert.match(source.text, /事实截止：2026-11-01 20:00:00/);
  }
});
