import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReportBody, reportFinalTool, reportMessages, reportSectionKinds } from '../report-composition';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import type { SynthesisContext } from '@/lib/assistant/agent/synthesis';
import type { ReportReference } from '../report-reference';

const selection: ReportReference = { bindingId: '7', reportId: '8', revision: 1, projectId: '9', conversationId: '10',
  kind: 'daily', periodStart: '2026-11-01T16:00:00.000Z', periodEnd: '2026-11-02T12:00:00.000Z', cutoffAt: '2026-11-02T12:00:00.000Z', factsHash: 'frozen' };
const context: SynthesisContext = { version: 1, snapshots: [], knowledge: [], sources: [
  { sourceId: 'Boriginal', kind: 'project', title: '团队原记录', text: '厨房已穿线，插座位置仍待业主核对。', resultKey: 'original' },
  { sourceId: 'K100', kind: 'knowledge', title: '企业已发布标准', text: '铺设线路之前，应先核对插座位置。' },
] };
const project = { projectId: '9', selection, context };
const section = (text: string, source?: number) => ({ kind: 'synthesis', segments: [{ basis: source === undefined ? 'uncertainty' : 'evidence', text,
  citations: source === undefined ? [] : [{ citationId: sourceCitationCatalog(context.sources[source])[0].citationId }] }] });
const output = () => ({ projects: [{ projectId: '9', progress: section('厨房已穿线，插座位置仍待业主核对。', 0), pending: section('插座位置仍待业主核对。', 0),
  standards: section('铺设线路之前，应先核对插座位置。', 1), arrangements: section('本次没有可引用的后续安排。') }] });

test('report wording uses the existing exact citation catalog and preserves every required section', () => {
  const body = parseReportBody(JSON.stringify(output()), [project]);
  assert.deepEqual(Object.keys(body.projects[0].sections), [...reportSectionKinds]);
  assert.equal(body.projects[0].sections.standards.segments[0].citations[0].quote, context.sources[1].text);
  assert.equal(body.projects[0].selection.cutoffAt, selection.cutoffAt);
  assert.deepEqual(reportFinalTool(['9']).parameters.required, ['projects']);
});
test('missing, repeated, foreign or malformed project groups cannot become a report', () => {
  const valid = output();
  for (const projects of [[], [valid.projects[0],valid.projects[0]], [{ ...valid.projects[0], projectId: '999' }], [null]])
    assert.throws(() => parseReportBody(JSON.stringify({ projects }), [project]), /invalid_model_answer/);
  const broken = { ...valid.projects[0] } as Record<string, unknown>; delete broken.standards;
  assert.throws(() => parseReportBody(JSON.stringify({ projects: [broken] }), [project]));
});
test('a project cannot cite a foreign project catalog or invent measurements/approval', () => {
  const raw = output();
  raw.projects[0].standards = section('插座间距为99厘米。', 1);
  assert.throws(() => parseReportBody(JSON.stringify(raw), [project]));
  raw.projects[0].standards = section('已完成正式验收。', 1);
  assert.throws(() => parseReportBody(JSON.stringify(raw), [project]));
  raw.projects[0].standards = section('不能确认已完成正式验收。');
  assert.doesNotThrow(() => parseReportBody(JSON.stringify(raw), [project]));
  raw.projects[0].standards = section('不能确认已完成正式验收，但已经完成正式付款。');
  assert.throws(() => parseReportBody(JSON.stringify(raw), [project]));
  const other = { ...project, projectId: '11', context: { ...context, sources: [{ ...context.sources[1], sourceId: 'K200' }] } };
  raw.projects[0].standards = section('铺设线路之前，应先核对插座位置。', 1);
  assert.throws(() => parseReportBody(JSON.stringify({ projects: [raw.projects[0], { ...raw.projects[0], projectId: '11' }] }), [project, other]));
});
test('scheduled context is bounded to explicit originals with no ordinary conversation/history', () => {
  const messages = reportMessages({ reportId: '8', cutoffAt: selection.cutoffAt, audience: 'customer' }, [project]);
  assert.deepEqual(messages.map(m => m.role), ['system','user']);
  assert.ok(JSON.stringify(messages).includes('citationOptions'));
  assert.ok(JSON.stringify(messages).includes(selection.cutoffAt));
  assert.ok(!JSON.stringify(messages).includes('triggerMessageId'));
});
