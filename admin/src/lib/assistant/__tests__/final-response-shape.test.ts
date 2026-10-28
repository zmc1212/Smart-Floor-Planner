import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalResponseShapeIssue } from '../agent/final-response-shape';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';

const segments = [{ basis: 'uncertainty', text: '这条回复仍待核对，不能直接施工。', citations: [] }];
const good = JSON.stringify({ kind: 'synthesis', segments }), bad = JSON.stringify({ kind: 'synthesis', resultKey: '1578:1:0', segments });
const output = (text: string) => ({ text, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null });
test('known final kinds preserve legacy wrappers and reject synthesis cross-kind fields without deleting or coercing the original payload', async () => {
  const issue = await finalResponseShapeIssue(bad); assert.equal(issue?.code, 'invalid_model_answer');
  assert.deepEqual(JSON.parse(issue!.feedback).allowedFields, ['kind', 'segments']); assert.ok(JSON.parse(bad).resultKey);
  for (const value of [{ kind: 'synthesis', segments }, { kind: 'business', resultKey: '1:0:0' },
    { kind: 'business', resultKey: '1:0:0', text: 'This legacy field is ignored by the service renderer.', selections: [] },
    { kind: 'general', text: '仍待核对。', resultKey: 'legacy-unused-field' },
    { kind: 'vision', text: '照片不能证明精确点位。' }, { kind: 'unavailable', text: '本次无法核实。' },
    { kind: 'references', resultKey: '1:0:0' }, { kind: 'designers', resultKey: '1:0:0' }, { kind: 'knowledge', selections: ['1'] }])
    assert.equal(await finalResponseShapeIssue(JSON.stringify(value)), null);
  for (const value of [{ kind: 'synthesis', segments: 'wrong' }, { kind: 'business', resultKey: 1 }, { kind: 'general', text: 1 },
    { kind: 'knowledge', selections: [1] }]) assert.ok(await finalResponseShapeIssue(JSON.stringify(value)));
});
test('the existing graph uses one final-only repair, retains the bad first draft and never replays business tools', async () => {
  const saved: AgentCheckpoint[] = []; let calls = 0, writes = 0;
  const ports: AgentRuntimePorts = { authorize: async () => {}, checkpoint: async state => { saved.push(structuredClone(state)); },
    tool: async () => { writes++; return { content: '{}' }; }, validateFinal: finalResponseShapeIssue,
    model: async (_turn, _messages, tools) => { if (calls++ > 0) assert.deepEqual(tools, []); return output(calls === 1 ? bad : good); } };
  const result = await runRenovationAgent({ messages: [], tools: [{ name: 'record_need', description: 'existing write', parameters: {} }], ports });
  assert.equal(result.output!.text, good); assert.equal(calls, 2); assert.equal(writes, 0);
  assert.ok(saved.some(s => s.output?.text === bad));
  const repair = saved.find(s => s.validationRepairs === 1 && !s.output)!; assert.ok(repair);
  let resumed = 0;
  const recovery = await runRenovationAgent({ messages: [], tools: [], resume: repair, ports: { ...ports, model: async (_turn, _messages, tools) => {
    resumed++; assert.deepEqual(tools, []); return output(good); } } });
  assert.equal(recovery.output!.text, good); assert.equal(resumed, 1);
  await assert.rejects(runRenovationAgent({ messages: [], tools: [], resume: repair, ports: { ...ports, model: async () => output(bad) } }), /invalid_model_answer/);
});
