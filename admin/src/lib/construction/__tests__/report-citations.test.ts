import test from 'node:test';
import assert from 'node:assert/strict';
import { reportFactText } from '@/lib/assistant/agent/report-context';
import { attachReportFactCitations, assertReportBodyCitations, serverSectionText, verifyReportCitation } from '../report-citations';
import type { ReportBody } from '../report-composition';
import type { ReportReference } from '../report-reference';
import type { ReportProject } from '../report-scope';
import type { SynthesisAnswer, SynthesisContext } from '@/lib/assistant/agent/synthesis';

const reference = (overrides: Partial<ReportReference> = {}): ReportReference => ({ bindingId: '3', reportId: '9', revision: 2,
  projectId: '1454000004', conversationId: '1454000009', kind: 'weekly', periodStart: '2026-11-01T16:00:00.000Z',
  periodEnd: '2026-11-08T16:00:00.000Z', cutoffAt: '2026-11-08T16:00:00.000Z', factsHash: 'facts-r2', ...overrides });
const record = (id: string, version: number, completed: string, pending: string, coordination: string) => ({ id, version,
  hash: `hash-${id}-${version}`, publishedAt: '2026-11-03T04:00:00.000Z', room: '',
  data: { title: `记录${id}`, completed, pending, coordination } });
const facts = (overrides: Partial<ReportProject> = {}): ReportProject => ({ id: '1454000004', name: '[B4] 水路阶段测试项目',
  stageKey: null, progressRevision: 0, stageEvents: [], stageEventsTruncated: false,
  records: [record('5', 3, '木作基层复核完成，收口尺寸已记录', '收口尺寸待现场确认后下单', '本周内确认收口尺寸与材料到场时间'),
    record('1', 3, '线管敷设完成，线盒位置已标记', '底盒未固定，等待设计师核对接线点位', '本周内完成底盒固定与回路核对')],
  recordsTruncated: false, noPublishedRecords: false, ...overrides });
const section = (kind: 'progress' | 'pending' | 'arrangements', citations: Array<{ sourceId: string; quote: string }> = []): SynthesisAnswer =>
  ({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text: serverSectionText[kind], citations }] });
const advice = (text: string): SynthesisAnswer => ({ kind: 'synthesis', segments: [{ basis: 'advice', text, citations: [] }] });
type Sections = Record<'progress' | 'pending' | 'standards' | 'arrangements', SynthesisAnswer>;
type CitationProject = { projectId: string; selection: ReportReference; facts: ReportProject; context: SynthesisContext };
function project(factsProject = facts(), overrides: Partial<ReportReference> = {}): CitationProject {
  const selection = reference({ projectId: factsProject.id, ...overrides });
  const context = { version: 1 as const, knowledge: [], snapshots: [], sources: [{ sourceId: `Breport:40:${factsProject.id}`,
    kind: 'project' as const, title: '已发布现场记录', text: reportFactText(selection, factsProject), resultKey: `report:40:${factsProject.id}` }] };
  return { projectId: factsProject.id, selection, facts: factsProject, context };
}
function body(p: CitationProject, sections: Sections = {
  progress: section('progress'), pending: section('pending'), standards: advice('建议先核对底盒固定与回路。'),
  arrangements: section('arrangements'),
}): ReportBody {
  return { protocol: 'construction-report-composition-v1', projects: [{ projectId: p.projectId, selection: p.selection,
    context: p.context, sections }] };
}

test('server-composed sections receive exact fact spans and advice stays uncited', () => {
  const p = project(), report = body(p);
  attachReportFactCitations(report, [p]);
  const citations = report.projects[0].sections.progress.segments[0].citations;
  assert.deepEqual(citations.map(citation => citation.quote), ['本次完成：木作基层复核完成，收口尺寸已记录', '本次完成：线管敷设完成，线盒位置已标记']);
  assert.ok(citations.every(citation => p.context.sources[0].text.includes(citation.quote)));
  assert.equal(report.projects[0].sections.pending.segments[0].citations.length, 4);
  assert.deepEqual(report.projects[0].sections.arrangements.segments[0].citations, []);
  assert.deepEqual(report.projects[0].sections.standards.segments[0].citations, []);
  assert.doesNotThrow(() => assertReportBodyCitations(report, [p], 'designer'));
  const progress = verifyReportCitation(p, citations[0]);
  assert.deepEqual(progress, { kind: 'record', id: '5', version: 3, hash: 'hash-5-3' });
});

test('a customer body cannot cite an internal record that is absent from its facts', () => {
  const customerFacts = facts({ records: [record('1', 3, '线管敷设完成，线盒位置已标记',
    '底盒未固定，等待设计师核对接线点位', '本周内完成底盒固定与回路核对')] });
  const customer = project(customerFacts, { bindingId: '1', reportId: '16', revision: 1, conversationId: '1454000007', factsHash: 'facts-r1' });
  const report = body(customer);
  attachReportFactCitations(report, [customer]);
  assert.ok(report.projects[0].sections.progress.segments[0].citations.every(citation => citation.quote.includes('线管敷设完成')));
  const internal = (p: CitationProject) => [...p.context.sources, { sourceId: 'Btampered', kind: 'project' as const, title: '已发布现场记录',
    text: p.context.sources[0].text + '\n团队核对发布的原记录5（版本3，2026-11-03T04:00:00.000Z）：\n本次完成：木作基层复核完成，收口尺寸已记录' }];
  const tampered = { ...customer, context: { ...customer.context, sources: internal(customer) } };
  const forged = body(tampered, { ...body(customer).projects[0].sections,
    pending: section('pending', [{ sourceId: 'Btampered', quote: '本次完成：木作基层复核完成，收口尺寸已记录' }]) });
  assert.equal(verifyReportCitation(tampered, forged.projects[0].sections.pending.segments[0].citations[0]), undefined);
  assert.throws(() => assertReportBodyCitations(forged, [tampered], 'customer'), /invalid_model_citation/);
});

test('an unknown record id and a stale record version are rejected', () => {
  const p = project();
  const unknown = body(p, { ...body(p).projects[0].sections,
    pending: section('pending', [{ sourceId: 'Breport:40:1454000004', quote: '团队核对发布的原记录99（版本1，2026-11-03T04:00:00.000Z）：' }]) });
  assert.throws(() => assertReportBodyCitations(unknown, [p], 'designer'), /invalid_model_citation/);
  const stale = body(p, { ...body(p).projects[0].sections,
    progress: section('progress', [{ sourceId: 'Breport:40:1454000004', quote: '团队核对发布的原记录5（版本3，2026-11-03T04:00:00.000Z）：' }]) });
  const older = project(facts({ records: [record('5', 2, '木作基层复核完成，收口尺寸已记录', '收口尺寸待现场确认后下单', '本周内确认收口尺寸与材料到场时间')] }));
  assert.equal(verifyReportCitation(older, stale.projects[0].sections.progress.segments[0].citations[0]), undefined);
});

test('a revoked record line stays rejected even when the old source text is still stored', () => {
  const current = facts({ records: [record('1', 3, '线管敷设完成，线盒位置已标记', '底盒未固定，等待设计师核对接线点位', '本周内完成底盒固定与回路核对')] });
  const stored = project(current);
  const p = { ...stored, context: { ...stored.context, sources: [{ ...stored.context.sources[0],
    text: stored.context.sources[0].text + '\n团队核对发布的原记录5（版本3，2026-11-03T04:00:00.000Z）：\n本次完成：木作基层复核完成，收口尺寸已记录' }] } };
  const old = body(p, { ...body(p).projects[0].sections,
    arrangements: section('arrangements', [{ sourceId: 'Breport:40:1454000004', quote: '本次完成：木作基层复核完成，收口尺寸已记录' }]) });
  assert.equal(verifyReportCitation(p, old.projects[0].sections.arrangements.segments[0].citations[0]), undefined);
  assert.throws(() => assertReportBodyCitations(old, [p], 'designer'), /invalid_model_citation/);
});

test('a citation from another project or another report revision is rejected', () => {
  const left = project(), right = project(facts({ id: '1454000005' }), { projectId: '1454000005', reportId: '10' });
  const foreign = body(left, { ...body(left).projects[0].sections,
    progress: section('progress', [{ sourceId: right.context.sources[0].sourceId, quote: '本次完成：木作基层复核完成，收口尺寸已记录' }]) });
  assert.throws(() => assertReportBodyCitations(foreign, [left, right], 'designer'), /invalid_model_citation/);
  const scoped = { ...left, context: { ...left.context, sources: [{ ...left.context.sources[0], sourceId: 'Breport:40:1454000004:record:5:3',
    reportScope: { protocol: 'report-answer-grounding-v1' as const, reportId: '9', revision: 2, factsHash: 'facts-r2',
      projectId: '1454000004', cutoffAt: '2026-11-08T16:00:00.000Z', kind: 'record' as const, itemId: '5', itemVersion: 3,
      sourceHash: 'hash-5-3', room: { status: 'unspecified' as const } } }] } };
  const previous = body(scoped, { ...body(scoped).projects[0].sections,
    progress: section('progress', [{ sourceId: 'Breport:40:1454000004:record:5:3', quote: '本次完成：木作基层复核完成，收口尺寸已记录' }]) });
  assert.deepEqual(verifyReportCitation(scoped, previous.projects[0].sections.progress.segments[0].citations[0]),
    { kind: 'record', id: '5', version: 3, hash: 'hash-5-3' });
  assert.throws(() => assertReportBodyCitations(previous, [{ ...scoped, selection: { ...scoped.selection, revision: 1 } }], 'designer'),
    /invalid_model_citation/);
});

test('revision 2 only cites its own current records, never the superseded revision 1 record', () => {
  const r1 = project(facts({ records: [record('9', 1, '旧来源已完成', '旧来源待核对', '旧来源待沟通')] }),
    { revision: 1, factsHash: 'facts-r1' });
  const r2 = project(facts(), { revision: 2, factsHash: 'facts-r2' });
  const report = body(r2);
  attachReportFactCitations(report, [r2]);
  const cited = [...new Set(report.projects[0].sections.progress.segments[0].citations.map(citation => citation.quote))];
  assert.ok(cited.every(quote => !quote.includes('旧来源')));
  assert.ok(cited.every(quote => r2.context.sources[0].text.includes(quote)));
  const inherited = body(r2, { ...body(r2).projects[0].sections,
    progress: section('progress', [{ sourceId: 'Breport:40:1454000004', quote: '本次完成：旧来源已完成' }]) });
  assert.throws(() => assertReportBodyCitations(inherited, [r2], 'designer'), /invalid_model_citation/);
  assert.deepEqual(verifyReportCitation(r1, inherited.projects[0].sections.progress.segments[0].citations[0]),
    { kind: 'record', id: '9', version: 1, hash: 'hash-9-1' });
});

test('a report without originals keeps empty citations instead of inventing a source', () => {
  const empty = project(facts({ records: [], noPublishedRecords: true }));
  const report = body(empty);
  attachReportFactCitations(report, [empty]);
  for (const kind of ['progress', 'pending', 'arrangements'] as const) {
    assert.deepEqual(report.projects[0].sections[kind].segments[0].citations, []);
  }
  assert.doesNotThrow(() => assertReportBodyCitations(report, [empty], 'customer'));
});

test('cited original versions and their photos stay on the same published record version', () => {
  const p = project();
  const citation = { sourceId: 'Breport:40:1454000004', quote: '本次完成：线管敷设完成，线盒位置已标记' };
  const original = verifyReportCitation(p, citation);
  assert.deepEqual(original, { kind: 'record', id: '1', version: 3, hash: 'hash-1-3' });
  const factsRecord = p.facts.records.find(row => row.id === '1')!;
  assert.equal(original!.version, factsRecord.version);
  assert.equal(original!.hash, factsRecord.hash);
  const wrongVersion = project(facts({ records: [{ ...factsRecord, version: 2, hash: 'hash-1-2' }] }));
  assert.deepEqual(verifyReportCitation(wrongVersion, { ...citation, quote: '本次完成：线管敷设完成，线盒位置已标记' }),
    { kind: 'record', id: '1', version: 2, hash: 'hash-1-2' });
  const removedPhotoVersion = project(facts({ records: [record('5', 3, '木作基层复核完成，收口尺寸已记录',
    '收口尺寸待现场确认后下单', '本周内确认收口尺寸与材料到场时间')] }));
  assert.equal(verifyReportCitation(removedPhotoVersion, citation), undefined);
});

test('four recipients keep separate citation scopes', () => {
  const customer = project(facts({ records: [record('1', 3, '线管敷设完成，线盒位置已标记',
    '底盒未固定，等待设计师核对接线点位', '本周内完成底盒固定与回路核对')] }),
    { bindingId: '1', reportId: '16', revision: 1, conversationId: '1454000007', factsHash: 'facts-customer' });
  const worker = project(facts(), { bindingId: '2', reportId: '17', revision: 1, conversationId: '1454000008', factsHash: 'facts-worker' });
  const designer = project(facts(), { bindingId: '3', reportId: '9', revision: 2, conversationId: '1454000009', factsHash: 'facts-designer' });
  const boss = project(facts(), { bindingId: '4', reportId: '18', revision: 1, conversationId: '1454000010', factsHash: 'facts-boss' });
  const entries = [['customer', customer], ['worker', worker], ['designer', designer], ['boss', boss]] as const;
  const bodies = entries.map(([, p]) => body(p));
  for (const [index, [audience, p]] of entries.entries()) {
    attachReportFactCitations(bodies[index], [p]);
    assert.doesNotThrow(() => assertReportBodyCitations(bodies[index], [p], audience));
  }
  assert.deepEqual(new Set(bodies[0].projects[0].sections.progress.segments[0].citations.map(citation =>
    verifyReportCitation(customer, citation))), new Set([{ kind: 'record', id: '1', version: 3, hash: 'hash-1-3' }]));
  for (const index of [1, 2, 3]) assert.equal(bodies[index].projects[0].sections.progress.segments[0].citations.length, 2);
  const leaked = body(customer, { ...body(customer).projects[0].sections,
    progress: section('progress', [{ sourceId: 'Breport:40:1454000004', quote: '本次完成：木作基层复核完成，收口尺寸已记录' }]) });
  assert.throws(() => assertReportBodyCitations(leaked, [customer], 'customer'), /invalid_model_citation/);
});
