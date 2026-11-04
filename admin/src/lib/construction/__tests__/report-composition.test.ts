import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReportBody, reportFinalTool, reportMessages, reportSectionKinds } from '../report-composition';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
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

test('report input separates PDF presentation metadata from cited quantities and applicability', () => {
  const title = '精艺 · 原PDF第29页 · 施工工艺';
  const text = '冷热水管打压8-12公斤，掉压须在正常范围内。';
  const file = { assetId: '139', sourceHash: 'file-hash', name: 'jingyi-pdf-page-29-ocr.pdf', format: 'pdf' as const,
    parser: 'test', blockId: 'b20', kind: 'paragraph' as const, section: [], page: 1, label: 'PDF第1页 · 段落20' };
  const source: SynthesisContext['sources'][number] = { sourceId: 'K100', kind: 'knowledge', title, text,
    evidence: { ref: { type: 'knowledge_chunk', id: '100', version: '410' }, text, hash: 'chunk-hash', file,
      professional: { documentId: '404', title, contentHash: 'version-hash', context: { stage: 'utilities' },
        applicability: { status: 'unknown', matched: [], missing: ['material'], mismatched: [] },
        entry: { version: 1, kind: 'construction', topics: ['试压'], conditions: [], prerequisites: ['先查材质'], exceptions: [],
          origin: { title, version: 'v1', locator: '原PDF第29页', authority: 'reference' }, claim: null,
          review: { note: '原PDF第29页已核对', adminId: '1', reviewedAt: selection.cutoffAt } } } } };
  const scoped = { ...project, context: { ...context, sources: [context.sources[0], source] } };
  const packet = reportMessages({}, [scoped])[1];
  assert.ok(packet.role === 'user' && packet.content[0].type === 'text');
  const projected = JSON.parse(packet.content[0].text).projects[0].sources[1];
  assert.deepEqual(projected, { sourceId: source.sourceId, kind: 'knowledge', text,
    citationOptions: [{ citationId: sourceCitationCatalog(source)[0].citationId }], conditions: { authority: 'reference', conditions: [],
      prerequisites: ['先查材质'], exceptions: [], applicability: { status: 'unknown', matched: [], missing: ['material'], mismatched: [] } } });
  const raw = output();
  const standards = raw.projects[0].standards = section(text);
  standards.segments[0] = { basis: 'evidence', text, citations: projected.citationOptions };
  const saved = parseReportBody(JSON.stringify(raw), [scoped]).projects[0];
  assert.equal(saved.context.sources[1].title, title);
  assert.deepEqual(saved.context.sources[1].evidence?.file, file);
  assert.equal(saved.sections.standards.segments[0].citations[0].quote, text);
  standards.segments[0].text = text.replace('8-12公斤', '8-29公斤');
  assert.throws(() => parseReportBody(JSON.stringify(raw), [scoped]), /unsupported_model_commitment/);
});

test('report native schema reuses per-project citations and rejects uncited quantities before generation', async () => {
  const tool = reportFinalTool(['9'], [project]);
  assert.equal(await toolSchemaIssue(tool, JSON.stringify(output())), null);
  const uncited = output();
  uncited.projects[0].standards = section('水管打压8-12公斤。[citationId: not-a-structured-reference]');
  assert.ok(await toolSchemaIssue(tool, JSON.stringify(uncited)));
  const foreign = output();
  foreign.projects[0].standards.segments[0].citations = [{ citationId: 'outside-this-project' }];
  assert.ok(await toolSchemaIssue(tool, JSON.stringify(foreign)));
  const empty = reportFinalTool(['9'], [{ ...project, context: { ...context, sources: [] } }]);
  assert.ok(await toolSchemaIssue(empty, JSON.stringify(output())));
  // Native grammar cannot prove what an original supports. Existing quantity
  // and approval checks remain necessary after schema-valid generation.
  const invented = output();
  invented.projects[0].standards = section('插座间距为99厘米。', 1);
  assert.equal(await toolSchemaIssue(tool, JSON.stringify(invented)), null);
  assert.throws(() => parseReportBody(JSON.stringify(invented), [project]));
});
