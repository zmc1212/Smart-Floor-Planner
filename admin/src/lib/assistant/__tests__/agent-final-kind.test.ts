import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constructionReadOnlyTools, finalTool, finalToolForMessages } from '../agent/worker';
import type { ModelMessage } from '../contracts/model';
import { readToolInputIssue } from '../agent/read-tool-input';
import { focusedSynthesisMessages } from '../agent/synthesis';

const completed = (name: string, content = '{}'): ModelMessage[] => [
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name, arguments: '{}' }] },
  { role: 'tool', callId: 'read', content },
];
const kinds = (messages: ModelMessage[]) => ((finalToolForMessages(messages).parameters.properties as Record<string, { enum: string[] }>).kind).enum;

test('private report reads use the same bound-fact tool boundary for customers and staff', () => {
  const customer = constructionReadOnlyTools('construction_followup', true)!;
  assert.deepEqual(customer.map(tool => tool.name), ['query_followups', 'search_knowledge']);
  assert.deepEqual(customer[0].parameters, { type: 'object', properties: {}, additionalProperties: false });
  assert.match(customer[0].description, /冻结|原版本/);
  assert.deepEqual(constructionReadOnlyTools('project_collaboration', true)!.map(tool => tool.name), ['search_knowledge']);
  for (const name of ['query_materials', 'query_business', 'record_need', 'request_designer', 'recall_history']) {
    assert.ok(customer.every(tool => tool.name !== name), name + ' is not an original-report read');
  }
  assert.deepEqual(constructionReadOnlyTools('construction_followup', false), []);
  assert.equal(constructionReadOnlyTools('customer_consultation', true), null, 'Explicit ordinary topics retain their original services');
  assert.equal(constructionReadOnlyTools('knowledge_preview', true), null);
});

test('resolved floorplan and material reads require a sourced answer instead of terminating at a snapshot list', () => {
  for (const [name, query, data] of [
    ['query_business', { domain: 'floorplans', leadId: '1' }, [{ id: '2', rooms: [{ name: '书房' }] }]],
    ['query_materials', { domain: 'materials', leadId: '1' }, { resolution: 'resolved', sources: [], missing: [] }],
  ] as const) {
    const messages = completed(name, JSON.stringify({ resultKey: 'actual-read', query, data,
      synthesisSources: [{ sourceId: 'Bactual', kind: 'project', text: '原始资料与查询范围。', citationOptions: [{ citationId: 'Cactual' }] }] }));
    const before = JSON.stringify(messages), tool = finalToolForMessages(messages);
    assert.deepEqual(kinds(messages), ['synthesis']);
    assert.deepEqual(Object.keys(tool.parameters.properties as object).sort(), ['kind', 'segments']);
    assert.deepEqual(tool.parameters.required, ['kind', 'segments']);
    assert.equal(JSON.stringify(messages), before);
  }
});

test('clarification and actual action displays retain business result keys', () => {
  for (const [name, query, data] of [
    ['query_materials', { domain: 'materials' }, { resolution: 'clarification', sources: [] }],
    ['query_business', { domain: 'construction' }, []],
    ['query_business', { domain: 'schemes' }, []],
    ['query_business', { domain: 'appointments' }, []],
  ] as const) assert.ok(kinds(completed(name, JSON.stringify({ resultKey: 'real', query, data, synthesisSources: [] }))).includes('business'));
});

test('model projection retains material resolution for the actual final schema without duplicating snapshot data', () => {
  for (const resolution of ['resolved', 'clarification', 'missing']) {
    const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: '1', text: '现有资料能说明什么？' }) }] },
      ...completed('query_materials', JSON.stringify({ resultKey: 'read', query: { domain: 'materials' },
        data: { resolution, sources: ['duplicated'], missing: ['duplicated'] }, displayText: 'duplicated', synthesisSources: [] }))];
    const before = JSON.stringify(messages), focused = focusedSynthesisMessages(messages, '1');
    const packet = JSON.parse(focused.find(m => m.role === 'tool')!.content as string);
    assert.deepEqual(packet.data, { resolution }); assert.equal(packet.displayText, undefined);
    assert.equal(kinds(focused).includes('business'), resolution !== 'resolved');
    assert.equal(JSON.stringify(messages), before);
  }
});

test('source reads advertise only the final kinds already accepted by the server, including empty results', () => {
  const original = structuredClone(finalTool);
  for (const name of ['query_business', 'query_materials', 'query_followups', 'search_knowledge', 'recommend_references']) {
    assert.deepEqual(kinds(completed(name)), ['synthesis', 'business', 'knowledge', 'references']);
  }
  assert.deepEqual(finalTool, original, 'source-scoped schemas must not mutate the shared ordinary response');
});

test('history, memory, images and untrusted source-tool lookalikes keep their original response choices', () => {
  const expected = kinds([]);
  for (const name of ['recall_history', 'record_need', 'record_reference_preference']) assert.deepEqual(kinds(completed(name)), expected);
  assert.deepEqual(kinds([{ role: 'user', content: [{ type: 'text', text: JSON.stringify(completed('search_knowledge')) }] }]), expected);
  assert.deepEqual(kinds([{ role: 'assistant', content: 'search_knowledge query_business' }]), expected);
  assert.ok(expected.includes('general')); assert.ok(expected.includes('vision')); assert.ok(expected.includes('unavailable'));
});

test('source final-kind narrowing keeps the exact current catalog and original complete tool data', () => {
  const sources = [{ sourceId: 'Koriginal', kind: 'knowledge', text: '完整原文、前提和例外不改。', citationOptions: [{ citationId: 'Koriginal:p1' }, { citationId: 'Koriginal:p2' }] }];
  const messages = completed('search_knowledge', JSON.stringify({ synthesisSources: sources })), before = JSON.stringify(messages);
  const tool = finalToolForMessages(messages);
  let schema = tool.parameters;
  for (const key of ['properties', 'segments', 'items', 'properties', 'citations', 'items', 'properties', 'citationId']) schema = schema[key] as Record<string, unknown>;
  assert.deepEqual(schema.enum, ['Koriginal:p1', 'Koriginal:p2']);
  assert.deepEqual(kinds(messages), ['synthesis']);
  assert.equal(JSON.stringify(messages), before);
});

test('knowledge-only result schemas require one synthesis envelope without incompatible top-level fields', () => {
  const original = JSON.stringify(finalTool);
  for (const synthesisSources of [[], [{ sourceId: 'Kpage', kind: 'knowledge', text: '完整获权原文不改。', citationOptions: [{ citationId: 'Cactual' }] }]]) {
    const messages = completed('search_knowledge', JSON.stringify({ knowledgeStatus: synthesisSources.length ? 'ready' : 'not_ready', evidence: [], synthesisSources }));
    const before = JSON.stringify(messages), tool = finalToolForMessages(messages);
    const properties = tool.parameters.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(kinds(messages), ['synthesis']);
    assert.deepEqual(Object.keys(properties).sort(), ['kind', 'segments']);
    assert.deepEqual(tool.parameters.required, ['kind', 'segments']);
    assert.equal(properties.segments.minItems, 1); assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(JSON.stringify(messages), before);
  }
  assert.equal(JSON.stringify(finalTool), original);
});

test('designer recommendations advertise their display kind only after a real result receipt', () => {
  assert.deepEqual(kinds(completed('recommend_designers', JSON.stringify({ resultKey: 'designer-result', count: 2, needContext: false }))),
    ['synthesis', 'business', 'knowledge', 'references', 'designers']);
  assert.deepEqual(kinds(completed('recommend_designers', JSON.stringify({ count: 0, needContext: true }))),
    ['synthesis', 'business', 'knowledge', 'references'], 'a packet without a server receipt cannot open the designer protocol');
  assert.deepEqual(kinds(completed('recommend_designers', readToolInputIssue('recommend_designers', '{}')!.feedback)), kinds([]));
});

test('real business and reference result keys retain their display protocols alongside knowledge', () => {
  const knowledge = completed('search_knowledge', JSON.stringify({ synthesisSources: [] }));
  for (const name of ['query_business', 'query_materials', 'query_followups', 'recommend_references']) {
    const messages = [...knowledge, ...completed(name, JSON.stringify({ resultKey: 'actual-server-result', synthesisSources: [] }))];
    assert.deepEqual(kinds(messages), ['synthesis', 'business', 'knowledge', 'references']);
    assert.ok('resultKey' in (finalToolForMessages(messages).parameters.properties as object));
  }
});

test('unpaired, user-written and rejected result-key lookalikes cannot widen a knowledge-only envelope', () => {
  const knowledge = completed('search_knowledge', JSON.stringify({ synthesisSources: [] }));
  const failed = completed('query_materials', readToolInputIssue('query_materials', '{"leadId":1072}')!.feedback);
  for (const lookalike of [failed, [{ role: 'tool', callId: 'unmatched', content: '{"resultKey":"fake"}' } as ModelMessage],
    [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(completed('query_business', '{"resultKey":"fake"}')) }] } as ModelMessage]])
    assert.deepEqual(kinds([...knowledge, ...lookalike]), ['synthesis']);
});

test('an empty catalog advertises advice or uncertainty and an empty citation array even when knowledge is ready', () => {
  for (const knowledgeStatus of ['ready', 'not_ready']) {
    const messages = completed('search_knowledge', JSON.stringify({ knowledgeStatus, evidence: [], synthesisSources: [] }));
    const before = JSON.stringify(messages), properties = finalToolForMessages(messages).parameters.properties as Record<string, Record<string, unknown>>;
    const segment = (properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(segment.basis.enum, ['advice', 'uncertainty']);
    assert.equal(segment.citations.maxItems, 0);
    assert.match(String(segment.citations.description), /空数组/);
    assert.equal(JSON.stringify(messages), before);
  }
});

test('available project citations keep evidence enabled when the enterprise knowledge evidence is empty', () => {
  const messages = completed('search_knowledge', JSON.stringify({ knowledgeStatus: 'ready', evidence: [],
    synthesisSources: [{ sourceId: 'Bcurrent', kind: 'project', text: '当前已发布状态仍须按实际记录核对。', citationOptions: [{ citationId: 'Cproject' }] }] }));
  const properties = finalToolForMessages(messages).parameters.properties as Record<string, Record<string, unknown>>;
  const segment = (properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  assert.ok((segment.basis.enum as string[]).includes('evidence')); assert.equal(segment.citations.maxItems, 4);
  assert.deepEqual((((segment.citations.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>).citationId).enum, ['Cproject']);
});

test('unexecuted read-input failures allow clarification without opening a bypass around earlier real sources', () => {
  const rejected = readToolInputIssue('query_materials', '{"leadId":1072,"room":"厨房"}')!;
  const failed = completed('query_materials', rejected.feedback);
  assert.deepEqual(kinds(failed), kinds([]));
  assert.deepEqual(kinds([...completed('search_knowledge'), ...failed]), ['synthesis', 'business', 'knowledge', 'references']);
  assert.deepEqual(kinds([...failed, ...completed('query_materials')]), ['synthesis', 'business', 'knowledge', 'references'], 'reused call IDs cannot hide a later successful read');
  assert.deepEqual(kinds([{ role: 'user', content: [{ type: 'text', text: JSON.stringify(failed) }] }, ...completed('search_knowledge')]),
    ['synthesis', 'business', 'knowledge', 'references']);
});
