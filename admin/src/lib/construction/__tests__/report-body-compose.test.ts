import test from 'node:test';
import assert from 'node:assert/strict';
import { reportFactText } from '@/lib/assistant/agent/report-context';
import { generalReportAdviceProtocol, generalReportMessages, parseGeneralReport } from '../report-general-advice';
import { attachReportFactCitations, assertReportBodyCitations, serverSectionText } from '../report-citations';
import type { ReportReference } from '../report-reference';
import type { ReportProject } from '../report-scope';
import type { SynthesisContext } from '@/lib/assistant/agent/synthesis';

const selection: ReportReference = { bindingId: '63', reportId: '67', revision: 1, projectId: '38',
  conversationId: '106', kind: 'weekly', periodStart: '2026-11-01T16:00:00.000Z',
  periodEnd: '2026-11-08T16:00:00.000Z', cutoffAt: '2026-11-08T16:00:00.000Z', factsHash: 'a'.repeat(64) };
const context = (sources: SynthesisContext['sources'] = []): SynthesisContext =>
  ({ version: 1, knowledge: [], snapshots: [], sources });
const source = (text: string, sourceId = 'Breport:67:38') => ({ sourceId, kind: 'project' as const,
  title: '已发布现场记录', text, resultKey: 'report:67:38' });
const project = (sources: SynthesisContext['sources'] = [], projectId = '38') =>
  ({ projectId, selection: { ...selection, projectId }, context: context(sources) });
const record = (id: string, completed: string, pending = '', coordination = '') => ({ id, version: 2,
  hash: `hash-${id}`, publishedAt: '2026-11-05T01:00:00.000Z', room: '卫生间',
  data: { title: '合成现场记录', completed, pending, coordination } });
const facts = (overrides: Partial<ReportProject> = {}): ReportProject => ({ id: '38', name: 'I7.5.0 第一期合成工地（试点内）',
  stageKey: 'masonry_carpentry', progressRevision: 2, stageEvents: [], stageEventsTruncated: false,
  records: [record('44', '泥木阶段完成卫生间墙砖铺贴，防水闭水已记录。')], recordsTruncated: false,
  noPublishedRecords: false, ...overrides });
const adviceBody = (items: string[], target = project()) => parseGeneralReport(JSON.stringify({ P1: items }), [target],
  target.projectId === '38' ? { projectId: '38', name: '泥木' } : undefined);

test('A. the general report body keeps server fact sections and only asks the model for stage advice', () => {
  const body = adviceBody(['卫生间墙砖铺贴已有记录，建议补拍照片并核对闭水留痕。', '客厅吊顶放线待核对排版，建议以现场实测确认。']);
  assert.equal(body.generalAdvice, generalReportAdviceProtocol);
  const sections = body.projects[0].sections;
  assert.equal(sections.progress.segments[0].text, serverSectionText.progress);
  assert.equal(sections.pending.segments[0].text, serverSectionText.pending);
  assert.equal(sections.arrangements.segments[0].text, serverSectionText.arrangements);
  assert.deepEqual(sections.standards.segments.map(segment => segment.basis), ['advice', 'advice']);
  assert.deepEqual(sections.standards.segments[0].citations, []);
  assert.equal(sections.standards.segments[0].text, '卫生间墙砖铺贴已有记录，建议补拍照片并核对闭水留痕。');
});

test('B. internal issue numbers and unsupported quantities are rejected instead of becoming advice', () => {
  assert.throws(() => adviceBody(['事项507仍待补拍照片并补充现场记录。']), /unsupported_model_commitment/u);
  assert.throws(() => adviceBody(['客厅需要补铺约120平方米墙砖。']), /unsupported_model_commitment/u);
});

test('E. the general advice prompt forbids guarantee and receipt wording', () => {
  const messages = generalReportMessages({}, [project()], { projectId: '38', name: '泥木' });
  const system = messages[0].content.map(part => part.type === 'text' ? part.text : '').join('\n');
  assert.match(system, /保证……安全/);
  assert.match(system, /已完成付款、已验收、已批准、已联系/);
});

test('C. completion and acceptance wording still fails the existing commitment guard', () => {
  assert.throws(() => adviceBody(['卫生间墙砖铺贴已验收。']), /unsupported_model_commitment/u);
  assert.throws(() => adviceBody(['已付款结算完成。']), /unsupported_model_commitment/u);
});

test('D. the model input receives the audience and only that audience projection', () => {
  const messages = generalReportMessages({ audience: 'worker' }, [
    project([source('本期完成：补拍卫生间照片并补充现场记录')])], { projectId: '38', name: '泥木' });
  const user = String((messages[1].content[0] as { text?: string }).text);
  assert.match(user, /"audience":"worker"/u);
  assert.match(user, /补拍卫生间照片/u);
  assert.doesNotMatch(user, /请核对客厅墙砖排版/u);
  const customer = generalReportMessages({ audience: 'customer' }, [project([])], { projectId: '38', name: '泥木' });
  const customerUser = String((customer[1].content[0] as { text?: string }).text);
  assert.match(customerUser, /"audience":"customer"/u);
  assert.match(customerUser, /"stageName":"泥木"/u);
});

test('E. saved server sections receive exact record citations and no invented citations', () => {
  const factsProject = facts();
  const withFactSource = { ...project([source(reportFactText(selection, factsProject))]), facts: factsProject };
  const body = adviceBody(['卫生间闭水观察期建议保留影像。'], project());
  attachReportFactCitations(body, [withFactSource]);
  const progress = body.projects[0].sections.progress.segments[0].citations;
  assert.deepEqual(progress.map(citation => citation.quote), ['本次完成：泥木阶段完成卫生间墙砖铺贴，防水闭水已记录。']);
  assert.deepEqual(body.projects[0].sections.pending.segments[0].citations, []);
  assert.deepEqual(body.projects[0].sections.arrangements.segments[0].citations, []);
  assert.doesNotThrow(() => assertReportBodyCitations(body, [withFactSource], 'customer'));
});

test('F. a citation that does not match the saved facts is rejected', () => {
  const factsProject = facts();
  const target = { ...project([source(reportFactText(selection, factsProject))]), facts: factsProject };
  const body = adviceBody(['卫生间闭水观察期建议保留影像。'], project());
  attachReportFactCitations(body, [target]);
  body.projects[0].sections.pending.segments[0].citations = [{ sourceId: 'Breport:67:38',
    quote: '本次完成：不存在的施工记录' }];
  assert.throws(() => assertReportBodyCitations(body, [target], 'customer'), /invalid_model_citation/u);
});

test('G. a body cannot silently become knowledge-backed and a missing slot is rejected', () => {
  const knowledge = project([{ ...source('企业工艺原文'), kind: 'knowledge' as const }]);
  assert.throws(() => adviceBody(['卫生间闭水观察期建议保留影像。'], knowledge), /invalid_model_answer/u);
  assert.throws(() => parseGeneralReport(JSON.stringify({ P2: ['卫生间闭水观察期建议保留影像。'] }), [project()]),
    /invalid_model_answer/u);
});
