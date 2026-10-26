import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundReviewProtocol, composableReviewProtocol, developmentReviewEntry, reviewCandidate, reviewRuntimeProtocol } from '../agent/review-runtime';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';

test('ordinary consultation rollout is exact-enterprise, explicit, reversible and unavailable in production', () => {
  const original = { kind: 'direct' };
  const env = { NODE_ENV: 'development', ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS: '42, 57' } as NodeJS.ProcessEnv;
  const entry = developmentReviewEntry('42', original, env);
  assert.equal(boundReviewProtocol(entry, '42', env), composableReviewProtocol);
  assert.equal(boundReviewProtocol(entry, '42', {}), reviewRuntimeProtocol);
  assert.equal(boundReviewProtocol(entry, '42', { ...env, NODE_ENV: 'production' }), reviewRuntimeProtocol);
  assert.equal(reviewCandidate(entry, { reviewRuntime: composableReviewProtocol }), true);
  assert.strictEqual(developmentReviewEntry('4', original, env), original);
  assert.strictEqual(developmentReviewEntry('42', original, { ...env, NODE_ENV: 'production' }), original);
  assert.strictEqual(developmentReviewEntry('42', original, {}), original);
  assert.equal(boundReviewProtocol({}, '42', env), reviewRuntimeProtocol);
  assert.equal(reviewCandidate(original, { reviewRuntime: composableReviewProtocol }), false);
  assert.equal(reviewCandidate(entry, { reviewRuntime: 'unknown' }), false);
  assert.equal(reviewCandidate(entry, { reviewRuntime: reviewRuntimeProtocol }), true);
});

test('proposal result returns to the model with the whole mixed question; recovery never repeats the proposal', async () => {
  const question = '预算提高到15万，瓷砖先照旧。另外量房前要准备什么？';
  let writes = 0, models = 0;
  const saved: AgentCheckpoint[] = [];
  const tools = [{ name: 'propose_requirement_changes', description: '', parameters: {} }];
  const ports = {
    authorize: async () => {},
    model: async (turn: number, messages: Parameters<Parameters<typeof runRenovationAgent>[0]['ports']['model']>[1]) => {
      models++;
      assert.ok(JSON.stringify(messages).includes(question));
      if (turn === 0) return { text: '', toolCalls: [{ id: 'change', name: 'propose_requirement_changes', arguments: '{}' }], finishReason: null, providerRequestId: null, usage: null };
      assert.ok(messages.some(message => message.role === 'tool' && message.content.includes('proposal')));
      return { text: JSON.stringify({ kind: 'general', text: '量房前整理房屋资料和使用需求，现场说明保留的家具及设备。' }), toolCalls: [], finishReason: null, providerRequestId: null, usage: null };
    },
    tool: async () => { writes++; return { content: JSON.stringify({ effect: 'proposal', writesBusinessState: false }), exhausted: true }; },
    checkpoint: async (state: AgentCheckpoint) => { saved.push(structuredClone(state)); },
  };
  const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: question }] }];
  const result = await runRenovationAgent({ messages, tools, ports });
  assert.match(result.output!.text, /量房前/);
  assert.equal(writes, 1);
  assert.equal(models, 2);
  const afterTool = saved.find(state => state.turn === 1 && !state.output)!;
  assert.ok(afterTool);
  const resumed = await runRenovationAgent({ messages, tools, ports, resume: afterTool });
  assert.match(resumed.output!.text, /量房前/);
  assert.equal(writes, 1);
});

test('a non-budget question can finish without any proposal or business write', async () => {
  let models = 0, writes = 0;
  const result = await runRenovationAgent({
    messages: [{ role: 'user', content: [{ type: 'text', text: '量房前需要先把家具全部搬走吗？' }] }],
    tools: [{ name: 'propose_requirement_changes', description: '', parameters: {} }],
    ports: {
      authorize: async () => {}, checkpoint: async () => {},
      model: async () => { models++; return { text: '通常不必全部搬走；先整理出便于查看墙角和门窗的位置，具体与量房人员沟通。',
        toolCalls: [], finishReason: null, providerRequestId: null, usage: null }; },
      tool: async () => { writes++; throw Error('unexpected_business_write'); },
    },
  });
  assert.match(result.output!.text, /不必全部搬走/);
  assert.equal(models, 1); assert.equal(writes, 0);
});
