import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalTool, finalToolForMessages } from '../agent/worker';
import type { ModelMessage } from '../contracts/model';
import { readToolInputIssue } from '../agent/read-tool-input';

const completed = (name: string, content = '{}'): ModelMessage[] => [
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name, arguments: '{}' }] },
  { role: 'tool', callId: 'read', content },
];
const kinds = (messages: ModelMessage[]) => ((finalToolForMessages(messages).parameters.properties as Record<string, { enum: string[] }>).kind).enum;

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
  assert.deepEqual(kinds(messages), ['synthesis', 'business', 'knowledge', 'references']);
  assert.equal(JSON.stringify(messages), before);
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
