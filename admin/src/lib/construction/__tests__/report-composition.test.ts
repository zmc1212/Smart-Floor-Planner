import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReportBody, projectReportBodyFinal, reportFinalTool, reportFlatFinalTool, reportMessages, reportSectionKinds } from '../report-composition';
import { sourceCitationCatalog } from '@/lib/assistant/agent/citation-catalog';
import { toolSchemaIssue } from '@/lib/assistant/agent/tool-protocol';
import type { SynthesisContext } from '@/lib/assistant/agent/synthesis';
import type { ReportReference } from '../report-reference';
import { projectReportGuidanceOnly, reportGuidanceChoices, reportGuidanceFinalTool } from '../report-guidance-final';
import { reportWorkmanshipKnowledgeContext, reportWorkmanshipMatches, reportWorkmanshipName, reportWorkmanshipQuery, reportWorkmanshipStages } from '../report-workmanship';
import type { ReportProject } from '../report-scope';
import type { Evidence } from '@/lib/assistant/contracts';

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
test('guidance-only final cannot author arrangements and inserts the exact authorized workmanship excerpt', async () => {
  const tool = reportGuidanceFinalTool([project]);
  const exact = sourceCitationCatalog(context.sources[1])[0];
  const raw = JSON.stringify({ P1_guidance: '请先核对厨房插座的位置。', P1_standard: exact.citationId });
  assert.equal(await toolSchemaIssue(tool, raw), null);
  const { sections } = parseReportBody(projectReportGuidanceOnly(raw, [project]), [project], true).projects[0];
  assert.deepEqual(sections.standards.segments[0].citations, [{ sourceId: exact.sourceId, quote: exact.quote }]);
  assert.equal(sections.arrangements.segments[0].basis, 'uncertainty');
  for (const fields of [{ P1_arrangements: '灯已安装完成。' }, { P1_standard: '' },
    { P1_standard: sourceCitationCatalog(context.sources[0])[0].citationId }]) {
    assert.ok(await toolSchemaIssue(tool, JSON.stringify({ ...JSON.parse(raw), ...fields })));
  }
});
test('a scheduled recommendation can select a current pending item and cannot publish a supplied claim', async () => {
  const item = '插座位置仍待业主核对。';
  const [choice] = reportGuidanceChoices(project, [item]);
  const [foreign] = reportGuidanceChoices({ ...project, selection: { ...selection, revision: 2 } }, [item]);
  const choices = [[choice]];
  const tool = reportGuidanceFinalTool([project], choices);
  const raw = JSON.stringify({ P1_guidance: choice.id });
  assert.equal(await toolSchemaIssue(tool, raw), null);
  const pending = parseReportBody(projectReportGuidanceOnly(raw, [project], choices), [project], true).projects[0].sections.pending;
  assert.equal(pending.segments[0].basis, 'advice');
  assert.equal(pending.segments[0].citations[0].quote, item);
  assert.match(pending.segments[0].text, /请优先核对/);
  for (const id of [foreign.id, '插座已安装，施工队明早到场。', 'review_original']) {
    const bad = JSON.stringify({ P1_guidance: id });
    assert.ok(await toolSchemaIssue(tool, bad));
    assert.throws(() => projectReportGuidanceOnly(bad, [project], choices), /invalid_model_citation/);
  }
});
test('weekly workmanship follows saved stage history and rejects installation keyword collisions', async () => {
  const waterproof = { key: 'masonry_carpentry', revision: 2 }, install = { key: 'installation', revision: 3 };
  const facts: ReportProject = { id: '9', name: '合成周报工地', stageKey: install.key, progressRevision: install.revision,
    weekOpeningStage: waterproof, stageEvents: [{ id: '5', revision: install.revision, stageKey: install.key, at: selection.cutoffAt }],
    stageEventsTruncated: false, records: [{ id: '80', version: 1, hash: 'test', publishedAt: selection.periodStart,
      room: '卫生间', publishedStageKey: waterproof.key, data: { pending: '卫生间防水做完后再核对闭水条件' } }], recordsTruncated: false, noPublishedRecords: false };
  assert.deepEqual(reportWorkmanshipStages(facts), { stages: [waterproof, install], truncated: false });
  assert.deepEqual(reportWorkmanshipKnowledgeContext(facts, '60', waterproof), { projectId: '9', leadId: '60', stage: waterproof.key, revision: 2 });
  assert.equal(reportWorkmanshipKnowledgeContext(facts, '60', { ...waterproof, revision: 90 }), undefined);
  assert.match(reportWorkmanshipQuery(waterproof, facts).query, /泥木 防水/);
  assert.doesNotMatch(reportWorkmanshipQuery(install, facts).query, /防水/);
  const original: Evidence = { ref: { type: 'knowledge_chunk', id: '2835', version: '411' }, hash: 'real-heading-control',
    text: '防水工艺标准：1、基层找平：防水前，地基放坡找平。' };
  const wrong = { ...original, text: '水电工艺标准：水管安装后，用管卡进行固定。' };
  assert.ok(reportWorkmanshipMatches(original, waterproof, '泥木', true));
  assert.equal(reportWorkmanshipMatches(original, waterproof, '泥木', false), false);
  assert.equal(reportWorkmanshipMatches(wrong, install, '安装', false), false);
  const painting = { key: 'painting', revision: 4 };
  const paintStandard = { ...original, text: '漆工工艺标准：3、灯槽清理：灯槽内灰尘清理干净。' };
  assert.ok(reportWorkmanshipMatches(paintStandard, painting, '油漆', false));
  assert.equal(reportWorkmanshipMatches(paintStandard, install, '安装', false), false);
  assert.equal(reportWorkmanshipMatches({ ...original, text: '木工工艺标准：石膏拼缝采用V型槽工艺，防止乳胶漆面开裂。' }, painting, '油漆', false), false);
  assert.equal(reportWorkmanshipMatches({ ...original, text: '工程预算表：顶面乳胶漆。' }, painting, '油漆', false), false);
  const custom = { key: 'constructor', revision: 4 };
  assert.equal(reportWorkmanshipName(custom, { ...facts, weekStageNames: {} }), custom.key);
  assert.equal(reportWorkmanshipMatches(wrong, custom, custom.key, false), false);
  const scoped = { ...project, context: { ...context, sources: [context.sources[0], { ...context.sources[1], text: original.text, evidence: original }] },
    weekWorkmanship: { stages: [{ name: '泥木', sourceId: 'K100' }, { name: '安装' }], truncated: false } };
  const choices = [reportGuidanceChoices(scoped, [])], raw = JSON.stringify({ P1_guidance: choices[0][0].id });
  assert.equal(await toolSchemaIssue(reportGuidanceFinalTool([scoped], choices, true), raw), null);
  assert.ok(await toolSchemaIssue(reportGuidanceFinalTool([scoped], choices, true), JSON.stringify({ ...JSON.parse(raw), P1_standard: 'K100' })));
  const result = parseReportBody(projectReportGuidanceOnly(raw, [scoped], choices, true), [scoped], true).projects[0];
  assert.deepEqual(result.sections.standards.segments.map(item => item.text), [original.text]);
});
test('a reminder admits only the trigger stage and never offers wrong-stage standards as selectable evidence', async () => {
  const current = { key: 'installation', revision: 5 };
  const facts: ReportProject = { id: '9', name: '合成安装提醒', stageKey: current.key, progressRevision: current.revision,
    stageEvents: [{ id: '9', revision: current.revision, stageKey: current.key, at: selection.cutoffAt }], stageEventsTruncated: false,
    records: [], recordsTruncated: false, noPublishedRecords: true };
  assert.match(reportWorkmanshipQuery(current, facts, 'stage').query, /施工阶段提醒 安装/);
  assert.equal(reportWorkmanshipKnowledgeContext(facts, '60', { ...current, revision: 3 }, 'stage'), undefined);
  assert.equal(reportWorkmanshipKnowledgeContext(facts, '60', { ...current, key: 'utilities' }, 'stage'), undefined);
  const hits: Evidence[] = ['水电工艺标准：水管安装后，用管卡进行固定。', '防水工艺标准：待基层干燥后再涂防水。',
    '安装工艺标准：柜体固定前需确认墙体条件。'].map((text, i) => ({
    ref: { type: 'knowledge_chunk', id: String(101 + i), version: '411' }, hash: 'test', text }));
  const selected = hits.filter(evidence => reportWorkmanshipMatches(evidence, current, '安装', false));
  assert.deepEqual(selected.map(e => e.ref.id), ['103']);
  const sources = selected.map(evidence => ({ sourceId: 'K' + evidence.ref.id, kind: 'knowledge' as const, title: '工艺原文', text: evidence.text, evidence }));
  const scoped = { ...project, context: { ...context, sources } };
  const choices = [reportGuidanceChoices(scoped, [])];
  assert.ok(await toolSchemaIssue(reportGuidanceFinalTool([scoped], choices, true),
    JSON.stringify({ P1_guidance: 'review_original', P1_standard: sourceCitationCatalog({ ...sources[0], sourceId: 'K101', text: hits[0].text })[0].citationId })));
  const empty = { ...scoped, context: { ...scoped.context, sources: [] } };
  const raw = JSON.stringify({ P1_guidance: 'review_original' });
  assert.deepEqual(parseReportBody(projectReportGuidanceOnly(raw, [empty], choices, true), [empty], true)
    .projects[0].sections.standards.segments[0].citations, []);
  const stageTool = reportGuidanceFinalTool([scoped], choices, true, true);
  const externalId = JSON.stringify({ P1_guidance: 'review_original', P1_standard: sourceCitationCatalog(sources[0])[0].citationId });
  assert.ok(await toolSchemaIssue(stageTool, externalId));
  assert.throws(() => projectReportGuidanceOnly(externalId, [scoped], choices, true, true), /invalid_model_citation/);
  const projected = parseReportBody(projectReportGuidanceOnly(raw, [scoped], choices, true, true), [scoped], true);
  assert.deepEqual(projected.projects[0].sections.standards.segments[0].citations, [{ sourceId: 'K103', quote: hits[2].text }]);
  assert.deepEqual(parseReportBody(projectReportGuidanceOnly(raw, [empty], choices, true, true), [empty], true)
    .projects[0].sections.standards.segments[0].citations, []);
});
test('missing, repeated, foreign or malformed project groups cannot become a report', () => {
  const valid = output();
  for (const projects of [[], [valid.projects[0],valid.projects[0]], [{ ...valid.projects[0], projectId: '999' }], [null]])
    assert.throws(() => parseReportBody(JSON.stringify({ projects }), [project]), /invalid_model_answer/);
  const broken = { ...valid.projects[0] } as Record<string, unknown>; delete broken.standards;
  assert.throws(() => parseReportBody(JSON.stringify({ projects: [broken] }), [project]));
});
test('schema-valid single-character fragments cannot be saved as report prose', () => {
  const [valid] = output().projects;
  for (const text of ['待', ' 工。 ', '后…']) {
    const broken = { ...valid, arrangements: section(text) };
    assert.throws(() => parseReportBody(JSON.stringify({ projects: [broken] }), [project]), /invalid_model_answer/);
    const slot = { progress: broken.progress, pending: broken.pending, standards: broken.standards, arrangements: broken.arrangements };
    assert.throws(() => parseReportBody(JSON.stringify({ P1: slot }), [project], true), /invalid_model_answer/);
  }
  assert.doesNotThrow(() => parseReportBody(JSON.stringify(output()), [project]));
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

test('scheduled function final accepts one complete body and refuses trailing prose, invalid groups and mixed calls', async () => {
  const tool = reportFinalTool(['9'], [project]);
  const argumentsText = JSON.stringify(output());
  const packet = { text: '', toolCalls: [{ id: 'terminal', name: 'final_response', arguments: argumentsText }],
    finishReason: 'tool_calls', providerRequestId: null, usage: { inputTokens: 500, outputTokens: 400 } };
  assert.equal((await projectReportBodyFinal(packet, tool, true)).text, argumentsText);
  for (const invalid of [
    { ...packet, text: '说明及自我修正' },
    { ...packet, finishReason: 'length' },
    { ...packet, toolCalls: [...packet.toolCalls, { id: 'other', name: 'search_knowledge', arguments: '{}' }] },
    { ...packet, toolCalls: [{ ...packet.toolCalls[0], arguments: argumentsText + '\n尾随解释' }] },
    { ...packet, toolCalls: [{ ...packet.toolCalls[0], arguments: argumentsText.replace('"projectId":"9"', '"projectId":"999"') }] },
    { ...packet, text: argumentsText, toolCalls: [], finishReason: 'stop' },
  ]) await assert.rejects(() => projectReportBodyFinal(invalid, tool, true), /native_schema_unverified/);
  const legacy = { ...packet, text: argumentsText, toolCalls: [], finishReason: 'stop' };
  assert.equal(await projectReportBodyFinal(legacy, tool, false), legacy);
});

test('fixed project slots use server identities and reject strings, missing slots and other-project citations', async () => {
  const rule = { ...context.sources[1], sourceId: 'K200' };
  const other = { ...project, projectId: '10', selection: { ...selection, projectId: '10' },
    context: { ...context, sources: [context.sources[0], rule] } };
  const projects = [project, other];
  const row = output().projects[0];
  const first = { progress: row.progress, pending: row.pending, standards: row.standards, arrangements: row.arrangements };
  const second = structuredClone(first);
  second.standards.segments[0].citations = [{ citationId: sourceCitationCatalog(rule)[0].citationId }];
  const valid = { P1: first, P2: second };
  const definition = reportFinalTool(['9', '10'], projects, true);
  const wire = JSON.stringify(valid);
  assert.equal(await toolSchemaIssue(definition, wire), null);
  const packet = reportMessages({}, projects, true)[1];
  assert.ok(packet.role === 'user' && packet.content[0].type === 'text');
  const inputs = JSON.parse(packet.content[0].text).projects;
  assert.deepEqual(inputs.map((p: Record<string, unknown>) => [p.slot, p.projectId]), [['P1', undefined], ['P2', undefined]]);
  const saved = parseReportBody(wire, projects, true);
  assert.deepEqual(saved.projects.map(p => p.projectId), ['9', '10']);
  assert.deepEqual(saved.projects.map(p => p.sections.standards.segments[0].citations[0].sourceId), ['K100', 'K200']);
  const bad = [{ P1: JSON.stringify(first), P2: second }, { P1: first }, { P1: first, P3: second },
    { ...valid, P2: { projectId: '9', ...second } }, { ...valid, P2: first }, output()];
  for (const candidate of bad) {
    const raw = JSON.stringify(candidate);
    assert.ok(await toolSchemaIssue(definition, raw));
    assert.throws(() => parseReportBody(raw, projects, true));
  }
});

test('flat segment fields round-trip through the same body schema and original source checks', async () => {
  const body = output().projects[0];
  const flat = Object.fromEntries(reportSectionKinds.map(section => {
    const { basis, text, citations } = body[section].segments[0];
    return ['P1_' + section + '_1', [basis, text, ...citations.map(c => c.citationId)]];
  }));
  const tool = reportFlatFinalTool(1);
  const canonical = { projectCount: 1, tool: reportFinalTool(['9'], [project], true) };
  const packet = (value: unknown) => ({ text: '', finishReason: 'tool_calls', providerRequestId: null, usage: null,
    toolCalls: [{ id: 'terminal', name: 'final_response', arguments: JSON.stringify(value) }] });
  const projected = await projectReportBodyFinal(packet(flat), tool, true, canonical);
  assert.deepEqual(parseReportBody(projected.text, [project], true), parseReportBody(JSON.stringify(output()), [project]));
  const advice = ['advice', '建议与团队核对后续安排。'];
  const adviceBody = (citations: string[]) => packet({ ...flat, P1_arrangements_1: [...advice, ...citations] });
  const omitted = await projectReportBodyFinal(adviceBody([]), tool, true, canonical);
  const empty = await projectReportBodyFinal(adviceBody(['']), tool, true, canonical);
  assert.deepEqual(empty, omitted);
  const citationId = sourceCitationCatalog(context.sources[0])[0].citationId;
  const citedAdvice = await projectReportBodyFinal(adviceBody([citationId]), tool, true, canonical);
  const cited = parseReportBody(citedAdvice.text, [project], true).projects[0].sections.arrangements.segments[0];
  assert.equal(cited.citations[0].quote, context.sources[0].text);
  for (const citations of [[' '], ['Cforeign'], ['', ''], [citationId, '']]) {
    await assert.rejects(() => projectReportBodyFinal(adviceBody(citations), tool, true, canonical), /native_schema_unverified/);
  }
  const invented = { ...flat, P1_standards_1: [...flat.P1_standards_1] };
  invented.P1_standards_1[1] = '插座间距为99厘米。';
  const unsupported = await projectReportBodyFinal(packet(invented), tool, true, canonical);
  assert.throws(() => parseReportBody(unsupported.text, [project], true), /unsupported_model_commitment/);
  for (const invalid of [{ ...flat, P1_progress_3: flat.P1_progress_1 }, { ...flat, P2_pending_1: flat.P1_pending_1 },
    { ...flat, P1_standards_1: ['evidence', '应先核对插座。', 'Cforeign'] },
    { ...flat, P1_standards_1: ['evidence', '应先核对插座。', ''] },
    { ...flat, P1_standards_1: ['evidence', '应先核对插座。'] },
    { ...flat, P1_arrangements_1: ['uncertainty', '后续安排有待确认。', ''] }]) {
    await assert.rejects(() => projectReportBodyFinal(packet(invalid), tool, true, canonical), /native_schema_unverified/);
  }
});

test('a report quote selects the exact current knowledge span and binds it to the same segment', async () => {
  const rule = { ...context.sources[1], text: '所有冷热水管打压8-12公斤，焊接处不泄露。' };
  const scoped = { ...project, context: { ...context, sources: [context.sources[0], rule] } };
  const [recordId, ruleId] = scoped.context.sources.map(source => sourceCitationCatalog(source)[0].citationId);
  const message = reportMessages({}, [scoped], true, true, true)[1];
  assert.ok(message.role === 'user' && message.content[0].type === 'text');
  const [projectSource, knowledgeSource] = JSON.parse(message.content[0].text).projects[0].sources;
  assert.equal(projectSource.citationOptions[0].quoteToken, undefined);
  assert.equal(knowledgeSource.citationOptions[0].quoteToken, '[[quote:' + ruleId + ']]');
  const flat = {
    P1_progress_1: ['evidence', '厨房已穿线。', recordId],
    P1_pending_1: ['uncertainty', '本次记录未说明水管试压结果。企业原文：[[quote:' + ruleId + ']]', recordId],
    P1_standards_1: ['evidence', '水电工艺：[[quote:' + ruleId + ']]', ruleId],
    P1_arrangements_1: ['uncertainty', '本次没有可引用的后续安排。'],
  };
  const tool = reportFlatFinalTool(1);
  const canonical = { projectCount: 1, tool: reportFinalTool(['9'], [scoped], true), quoteSources: [[rule]] };
  const projectPacket = (fields: Record<string, unknown>, definition: typeof canonical & { citationList?: boolean } = canonical) => projectReportBodyFinal({
    text: '', finishReason: 'tool_calls', providerRequestId: null, usage: null,
    toolCalls: [{ id: 'terminal', name: 'final_response', arguments: JSON.stringify(fields) }],
  }, tool, true, definition);
  const projected = await projectPacket(flat);
  const [saved] = parseReportBody(projected.text, [scoped], true).projects;
  assert.match(saved.sections.pending.segments[0].text, /8-12公斤/);
  assert.deepEqual(saved.sections.pending.segments[0].citations.map(citation => citation.sourceId), ['Boriginal', 'K100']);
  assert.deepEqual(saved.sections.standards.segments[0].citations, [{ sourceId: 'K100', quote: rule.text }]);
  assert.ok(!projected.text.includes('[[quote:'));
  for (const value of ['[[quote:' + recordId + ']]', '[[quote:C12345678900000]]', '[[quote:' + ruleId + ']']) {
    await assert.rejects(() => projectPacket({ ...flat, P1_pending_1: ['uncertainty', value, recordId] }), /invalid_model_citation/);
  }
  await assert.rejects(() => projectPacket(flat, { ...canonical, quoteSources: [[]] }), /invalid_model_citation/);
  const invented = await projectPacket({ ...flat, P1_pending_1: ['uncertainty', flat.P1_pending_1[1] + ' 另需打压99公斤。', recordId] });
  assert.throws(() => parseReportBody(invented.text, [scoped], true), /unsupported_model_commitment/);
  const grouped = Object.fromEntries(Object.entries(flat).map(([key, [basis, text, ...ids]]) => [key, [basis, text, ids]]));
  await assert.rejects(() => projectPacket(grouped), /native_schema_unverified/);
  const listProtocol = { ...canonical, citationList: true };
  assert.deepEqual(await projectPacket(grouped, listProtocol), projected);
  for (const ids of [[['Cdeep']], [''], ['Cforeign'], Array<string>(5).fill(recordId)]) {
    await assert.rejects(() => projectPacket({ ...grouped, P1_progress_1: ['evidence', '厨房已穿线。', ids] }, listProtocol), /native_schema_unverified/);
  }
});
