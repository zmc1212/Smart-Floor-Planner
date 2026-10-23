import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from '../contracts/model';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { currentMessageOnlyRequested, currentMessageView, currentMessageReplyFeedback } from '../agent/current-message-scope';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';

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

const homework = '再聊餐桌的作业本。孩子偶尔会在餐桌旁给我们看作业，讲完又带回自己的地方。这是交流过程，并不是已经决定让餐厅承担长期学习功能。我还没讨论椅子、灯具或尺寸，也没有作家具改造决定，今天只是在澄清一个活动。请区分展示作业与长期学习的位置安排。';
const preparation = '我会先把近期不常用的东西归到一起，等家里人确认后再进一步整理。归到一起只是准备动作，不是已经决定永久收存。我没有确定新的柜体布局，也没确认要处理掉哪些物品；这轮只聊整理阶段。';
const brief = (text: string) => text + '请只回应这一段，用一两句即可；这轮不保存新需求，也不查询资料或工地。';
const general = (text: string) => JSON.stringify({ kind: 'general', text });

test('explicit brief-response contract rejects the saved multi-sentence copies instead of accepting JSON shape alone', () => {
  for (const original of [homework, preparation]) {
    const issue = currentMessageReplyFeedback(general(original), brief(original));
    assert.equal(issue?.code, 'invalid_model_answer'); assert.match(issue!.feedback, /最多2句/);
  }
  assert.equal(currentMessageReplyFeedback(general('展示作业是临时交流，不代表已决定让餐厅长期用于学习。椅子、灯具、尺寸和家具改造都还没有确定。'), brief(homework)), null);
  assert.equal(currentMessageReplyFeedback(general('先把换季物品归拢是整理前的准备，永久收存、柜体布局和哪些物品要处理都还未决定。'), brief(preparation)), null);
});

test('brief bounds come only from an unambiguous current response instruction, not quotations or verbatim requests', () => {
  const copied = general(homework);
  for (const q of ['他说“请只回应本段，用一两句即可”。请只回应本段。',
    '请只复述本段内容，用一两句即可。', '请只回应本段，不要用一两句草率概括。',
    '请只回应本段，用一两句即可。请只回应本段，用三句说明。',
    '请只回应本段，用一两句即可。另外请查询正式户型。']) assert.equal(currentMessageReplyFeedback(copied, q), null, q);
});

test('explicit one-sentence bounds retain complete negations and do not count decimals or semicolons as sentence ends', () => {
  const q = '请只回答本条消息的意思，用一句就好。';
  assert.equal(currentMessageReplyFeedback(general('这只是准备，尚未决定永久收存；也未确定1.5米柜体或处理物品。'), q), null);
  assert.equal(currentMessageReplyFeedback(general('这只是准备。还未决定。'), q)?.code, 'invalid_model_answer');
});

test('brief contract uses the existing sole final repair and replays a rejected checkpoint without repeating the provider', async () => {
  const q = brief(homework), bad = general(homework), good = general('展示作业是临时交流，不代表餐厅已确定为长期学习位置，家具改造也尚未决定。');
  const saved: AgentCheckpoint[] = []; let calls = 0;
  const ports: AgentRuntimePorts = {
    authorize: async () => {},
    model: async (_turn, messages, tools) => {
      calls++; assert.equal(tools.length, 0);
      if (calls > 1) { assert.ok(messages.some(m => m.role === 'assistant' && m.content === bad)); assert.match(JSON.stringify(messages.at(-1)), /最多2句/); }
      return { text: calls === 1 ? bad : good, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
    },
    tool: async () => { throw Error('No business tool may execute'); },
    checkpoint: async state => { saved.push(structuredClone(state)); },
    validateFinal: async raw => currentMessageReplyFeedback(raw, q),
  };
  const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: q }] }];
  assert.equal((await runRenovationAgent({ messages, tools: [], ports })).output?.text, good); assert.equal(calls, 2);
  const rejected = saved.find(s => s.output?.text === bad); assert.ok(rejected);
  let resumed = 0;
  const resumedPorts: AgentRuntimePorts = { ...ports, model: async (_turn, input, tools) => {
    resumed++; assert.equal(tools.length, 0); assert.match(JSON.stringify(input.at(-1)), /最多2句/);
    return { text: good, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
  } };
  assert.equal((await runRenovationAgent({ messages, tools: [], ports: resumedPorts, resume: rejected })).output?.text, good); assert.equal(resumed, 1);
  let repeated = 0;
  await assert.rejects(runRenovationAgent({ messages, tools: [], ports: { ...ports, model: async () => {
    repeated++; return { text: bad, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
  } } }), /invalid_model_answer/); assert.equal(repeated, 2);
});
