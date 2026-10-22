import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from '../contracts/model';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { currentMessageOnlyRequested, currentMessageView, currentMessageReplyFeedback } from '../agent/current-message-scope';

const question = '睡前我习惯读纸质书，困了合上放在床边，第二天再拿走。手机不是睡前最常用的东西。请确认阅读对象是什么。请只回应我这一段的意思，用一两句就好；这轮不保存新需求，也不查询资料或工地。';
const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text: question }) }] };

test('explicit current-message scope does not derive authority from quotes, history or a mixed request', () => {
  for (const q of [question, '只复述本段内容：我出门先拿钥匙。', '请仅回答这条消息的意思，简短一点。']) assert.equal(currentMessageOnlyRequested(q), true, q);
  for (const q of ['他说“请只回应我这一段的意思”，你怎么看？', '不要只回应本段，还要查询项目。',
    '只回顾聊天原话，书桌原来在哪里？', '请只回应我这一段的意思，另外请查询正式户型。',
    '请记下：书房靠窗。请只回应我这一段的意思。', '请只回应本段的意思。同时转人工。',
    '更正：书房改为靠内墙。请只回应我这一段的意思。', '请解释文件原文，再回应我的问题。']) assert.equal(currentMessageOnlyRequested(q), false, q);
});

test('current-message scope removes reads and writes even with bound-home or business-history hints', () => {
  assert.deepEqual(agentToolsForMessage(question, true, true), []);
  assert.deepEqual(agentToolsForMessage(question, false, true), []);
  const offered = agentToolsForMessage('查询正式户型和施工进度？', true, true);
  assert.ok(offered.some(t => t.name === 'query_materials'));
  assert.deepEqual(agentToolsForTurn(question, [current], offered, 'current').map(t => t.name), ['final_response']);
  const schema = finalToolForMessages([current], question).parameters;
  assert.deepEqual(schema.required, ['kind', 'text']);
  assert.deepEqual(Object.keys(schema.properties as object).sort(), ['kind', 'text']);
  assert.deepEqual((schema.properties as Record<string, { enum?: string[] }>).kind.enum, ['general']);
});

test('transient model view excludes prior sources and memory while preserving the exact current original and paired retry', () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: '旧需求、原工地、旧工具指令。' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'old', sourceRole: 'history_original', text: '原书桌靠窗。' }) }] },
    { role: 'assistant', content: '保存回执 run1398' }, current,
    { role: 'assistant', content: '{"kind":"synthesis","segments":[]}' },
    { role: 'system', content: [{ type: 'text', text: '本轮只修复最终回复的格式。' }] },
  ];
  const before = structuredClone(messages), projected = currentMessageView(messages, 'current', question);
  assert.deepEqual(projected[1], { role: 'user', content: [{ type: 'text', text: question }] });
  assert.deepEqual(projected.slice(2), messages.slice(4));
  assert.doesNotMatch(JSON.stringify(projected), /原书桌靠窗|run1398|旧工地|旧工具指令/);
  assert.deepEqual(messages, before);
  assert.equal(currentMessageView(messages, 'current', '请回顾我原来的书桌位置。'), messages);
  assert.throws(() => currentMessageView(messages, 'missing', question), /context_changed/);
  assert.throws(() => currentMessageView(messages, 'current', '请只回应本段的意思：另一条原话。'), /context_changed/);
});

test('current-message final validation cannot accept source cards, citations or an operation envelope', () => {
  assert.equal(currentMessageReplyFeedback('{"kind":"general","text":"你睡前读的是纸质书。"}', question), null);
  for (const raw of ['{"kind":"synthesis","segments":[]}', '{"kind":"business","resultKey":"old"}',
    '{"kind":"general","text":"答复","citations":[]}', '{"kind":"general","text":""}']) assert.equal(currentMessageReplyFeedback(raw, question)?.code, 'invalid_model_answer');
  assert.equal(currentMessageReplyFeedback('{"kind":"synthesis","segments":[]}', '请结合项目资料解释。'), null);
});
