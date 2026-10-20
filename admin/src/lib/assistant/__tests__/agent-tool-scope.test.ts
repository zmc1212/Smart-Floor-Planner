import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentToolsForMessage } from '../agent/worker';

test('an explicit chat-originals-only read excludes business sources without broadening authority', () => {
  for (const text of ['请只回顾聊天原话，不查图纸、项目进度或其他业务资料：早先书桌位置是什么？',
    '这次只谈之前聊天，不查图纸或项目进度。我早先的限制有哪些？', '只回顾聊天原话，不查图纸。'])
    assert.deepEqual(agentToolsForMessage(text, true, true).map(t => t.name), ['recall_history']);
  assert.deepEqual(agentToolsForMessage('只回顾聊天原话，不查图纸。', false).map(t => t.name), []);
});

test('separately explicit current saves and human handoff remain available in an originals-only read', () => {
  assert.deepEqual(agentToolsForMessage('请记录：书房靠门。只回顾聊天原话，不查图纸。', true).map(t => t.name), ['recall_history', 'record_need']);
  const names = agentToolsForMessage('只回顾聊天原话，不查图纸。转人工，让设计师接着聊？', true).map(t => t.name);
  assert.deepEqual(names, ['recall_history', 'request_designer']);
  const mixed = agentToolsForMessage('回顾之前的聊天，再查询正式户型和实际施工进度？', true).map(t => t.name);
  assert.ok(mixed.includes('query_materials') && mixed.includes('query_business'));
});

test('a leading explicit correction and a separate hypothetical question retain only the existing write authority', () => {
  const names = agentToolsForMessage('更正一下，书房改为单人办公，另外如果厨房加洗碗机，水电要怎么核对？', true).map(t => t.name);
  assert.ok(names.includes('record_need'));
  assert.ok(!names.includes('request_designer'));
  for (const text of ['更正一下，如果书房改为单人办公，另外厨房怎么安排？',
    '更正一下，设计师说书房改为单人办公，另外厨房怎么安排？'])
    assert.ok(!agentToolsForMessage(text, true).some(t => t.name === 'record_need'), text);
});
