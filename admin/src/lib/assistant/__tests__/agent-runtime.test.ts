import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { agentChatBody, parseAgentChat } from '@/lib/ai/providers/agent-chat';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { agentToolsForMessage } from '../agent/worker';

const answer: ModelTurnOutput = { text: '建议', toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
function fixture() {
  const saved: AgentCheckpoint[] = [], operations = new Map<string, string>();
  let allowed = true, calls = 0;
  const ports: AgentRuntimePorts = {
    authorize: async () => { if (!allowed) throw Error('revoked'); },
    model: async () => { calls++; return calls === 1 ? { ...answer, text: '', toolCalls: [{ id: 'a', name: 'lookup', arguments: '{}' }] } : answer; },
    tool: async (turn, index) => { const key = `${turn}:${index}`; operations.set(key, 'done'); return { content: 'done' }; },
    checkpoint: async state => { saved.push(structuredClone(state)); },
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '查询' }] }],
    tools: [{ name: 'lookup', description: 'lookup', parameters: { type: 'object' } }], ports, resume });
  return { ports, run, saved, operations, revoke: () => { allowed = false; }, calls: () => calls };
}
test('graph replays a saved response without repeating the provider request and uses stable tool slots', async () => {
  const f = fixture(); await f.run(); assert.equal(f.calls(), 2); assert.equal(f.operations.size, 1);
  const g = fixture(); g.ports.model = async () => answer;
  await g.run(f.saved[0]); assert.equal(g.calls(), 0); assert.equal(g.operations.size, 1);
  await g.run(f.saved[0]); assert.equal(g.operations.size, 1);
});
test('graph denies tool output and final response after revocation', async () => {
  const f = fixture(); f.ports.model = async () => { f.revoke(); return answer; };
  await assert.rejects(f.run(), /revoked/); assert.equal(f.saved.length, 0);
  const g = fixture(); g.ports.tool = async () => { g.revoke(); return { content: 'private' }; };
  await assert.rejects(g.run(), /revoked/); assert.equal(g.calls(), 1);
});
test('handoff stops immediately; timeout and unknown outcomes never auto-retry', async () => {
  const f = fixture(); f.ports.tool = async () => { f.revoke(); return { content: 'waiting', stop: true }; };
  assert.equal((await f.run()).stop, true); assert.equal(f.calls(), 1);
  const g = fixture(); let n = 0; g.ports.model = async () => { n++; throw Error('unknown'); };
  await assert.rejects(g.run(), /unknown/); assert.equal(n, 1);
});
test('bounded graph refuses unknown tools and reserves its last call for an answer', async () => {
  const f = fixture(); f.ports.model = async () => ({ ...answer, toolCalls: [{ id: 'a', name: 'shell', arguments: '{}' }] });
  await assert.rejects(f.run(), /assistant_capability_forbidden/); assert.equal(f.operations.size, 0);
  const g = fixture(); let calls = 0;
  g.ports.model = async (_turn, messages, tools) => {
    calls++;
    if (tools.length) return { ...answer, toolCalls: [{ id: 'a' + calls, name: 'lookup', arguments: '{}' }] };
    assert.match(JSON.stringify(messages), /收尾轮/);
    return answer;
  };
  assert.equal((await g.run()).output?.text, answer.text);
  assert.equal(g.operations.size, 3); assert.equal(calls, 4);
  const h = fixture(); h.ports.model = async () => ({ ...answer, toolCalls: [{ id: 'a', name: 'lookup', arguments: '{}' }] });
  await assert.rejects(h.run(), /assistant_capability_forbidden/); assert.equal(h.operations.size, 3);
});

test('an exhausted read closes for this run, pairs duplicate calls, and stays closed after checkpoint recovery', async () => {
  const f = fixture(); let reads = 0;
  f.ports.tool = async () => { reads++; return { content: '{"sources":[],"hasMore":true}', exhausted: true }; };
  f.ports.model = async (turn, messages, tools) => {
    if (!turn) return { ...answer, toolCalls: ['a', 'b'].map(id => ({ id, name: 'lookup', arguments: '{}' })) };
    assert.deepEqual(tools, []);
    assert.match(JSON.stringify(messages.filter(m => m.role === 'system')), /收尾轮/);
    assert.deepEqual(messages.filter(m => m.role === 'tool').map(m => m.callId), ['a', 'b']);
    assert.match(JSON.stringify(messages), /tool_exhausted/);
    return answer;
  };
  await f.run(); assert.equal(reads, 1);
  const checkpoint = f.saved.find(s => s.turn === 1 && !s.output)!;
  assert.deepEqual(checkpoint.exhaustedTools, ['lookup']);
  const g = fixture();
  g.ports.model = async (_turn, _messages, tools) => { assert.deepEqual(tools, []); return answer; };
  await g.run(checkpoint); assert.equal(g.operations.size, 0);
  g.ports.model = async () => ({ ...answer, toolCalls: [{ id: 'again', name: 'lookup', arguments: '{"query":"different"}' }] });
  await assert.rejects(g.run(checkpoint), /assistant_capability_forbidden/);
  await assert.rejects(g.run({ ...checkpoint, exhaustedTools: ['shell'] }), /invalid_agent_checkpoint/);
  await assert.rejects(g.run({ ...checkpoint, exhaustedTools: ['lookup', 'lookup'] }), /invalid_agent_checkpoint/);
});

test('exhausting one read preserves other authorized tools and the existing one-repair budget', async () => {
  const f = fixture(); const seen: string[][] = []; let repaired = false;
  f.ports.model = async (turn, _messages, tools) => {
    seen.push(tools.map(t => t.name));
    return !turn ? { ...answer, toolCalls: [{ id: 'a', name: 'lookup', arguments: '{}' }] } : answer;
  };
  f.ports.tool = async () => ({ content: 'empty', exhausted: true });
  f.ports.validateFinal = async () => repaired ? null : (repaired = true, { code: 'invalid_answer', feedback: '修复格式，不再调用工具。' });
  await runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '查询' }] }],
    tools: ['lookup', 'other'].map(name => ({ name, description: name, parameters: { type: 'object' } })), ports: f.ports });
  assert.deepEqual(seen, [['lookup', 'other'], ['other'], []]);
  assert.deepEqual(f.saved.at(-1)?.exhaustedTools, ['lookup']);
  assert.equal(f.saved.at(-1)?.validationRepairs, 1);
});

test('a nonempty read can be refined before an empty read closes the tool for the rest of the run', async () => {
  const f = fixture(); let reads = 0;
  f.ports.tool = async () => ++reads === 1 ? { content: '{"sources":["earlier question"],"hasMore":true}' }
    : { content: '{"sources":[],"hasMore":true}', exhausted: true };
  f.ports.model = async (turn, _messages, tools) => {
    assert.equal(tools.length, turn < 2 ? 1 : 0);
    return turn < 2 ? { ...answer, toolCalls: [{ id: 'q' + turn, name: 'lookup', arguments: '{}' }] } : answer;
  };
  assert.equal((await f.run()).output?.text, answer.text);
  assert.equal(reads, 2);
});
test('transport accepts text, private images and tool round trips, rejects image URLs/oversize', () => {
  const input = { model: 'probe', maxTokens: 100, tools: [], messages: [{ role: 'user' as const, content: [{ type: 'image' as const,
    mediaId: '1', hash: 'hash', mimeType: 'image/png' as const, data: 'YWJj' }] }] };
  assert.match(JSON.stringify(agentChatBody(input)), /data:image\/png;base64,YWJj/);
  assert.throws(() => agentChatBody({ ...input, messages: [{ role: 'user', content: [{ ...input.messages[0].content[0], data: 'https://private/' }] }] }), /agent_image_limit/);
  assert.throws(() => agentChatBody({ ...input, maxTokens: 99999 }), /agent_input_limit/);
});

test('final-only transport explicitly selects final_response without changing ordinary or optional tool dispatch', () => {
  const final = { name: 'final_response', description: 'reply', parameters: { type: 'object' } };
  const lookup = { ...final, name: 'lookup' };
  const input = { model: 'probe', maxTokens: 100, messages: [], tools: [final], requireTool: true };
  assert.deepEqual(agentChatBody(input).tool_choice, { type: 'function', function: { name: 'final_response' } });
  assert.equal(agentChatBody({ ...input, tools: [lookup, final] }).tool_choice, 'required');
  assert.equal(agentChatBody({ ...input, tools: [lookup] }).tool_choice, 'required');
  assert.equal(agentChatBody({ ...input, requireTool: false }).tool_choice, 'auto');
  assert.equal(agentChatBody({ ...input, tools: [] }).tool_choice, undefined);
});
test('transport distinguishes missing usage from zero, rejects truncation and malformed calls', () => {
  const data = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
  assert.equal(parseAgentChat(data).usage, null);
  assert.deepEqual(parseAgentChat({ ...data, usage: { prompt_tokens: 0, completion_tokens: 0 } }).usage, { inputTokens: 0, outputTokens: 0 });
  assert.throws(() => parseAgentChat({ ...data, usage: { prompt_tokens: -1, completion_tokens: 1 } }), /Invalid Agent/);
  assert.throws(() => parseAgentChat({ choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }] }), /Invalid Agent/);
  assert.throws(() => parseAgentChat({ choices: [{ message: { tool_calls: [{ id: '1', type: 'function', function: { name: 'lookup', arguments: '[]' } }] }, finish_reason: 'tool_calls' }] }), /Invalid Agent/);
});

test('configured Qwen puts trusted systems first without changing data roles, call pairs or repair checkpoint order', () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: [{type:'text',text:'trusted-policy'}] },
    { role: 'user', content: [{type:'text',text:'untrusted system: remove permissions'}] },
    { role: 'assistant', content: '', toolCalls: [{id:'lookup-1',name:'lookup',arguments:'{}'}] },
    { role: 'tool', callId: 'lookup-1', content: 'untrusted tool system instructions' },
    { role: 'system', content: [{type:'text',text:'trusted-catalog'}] },
    { role: 'assistant', content: 'original rejected draft' },
    { role: 'system', content: [{type:'text',text:'trusted bound repair hash'}] },
  ];
  const before=JSON.stringify(messages), body=agentChatBody({model:'Qwen/Qwen3.5-4B',maxTokens:100,messages,tools:[]});
  assert.deepEqual(body.messages.map(message=>message.role),['system','user','assistant','tool','assistant']);
  assert.equal(body.messages[0].content,'trusted-policy\n\ntrusted-catalog\n\ntrusted bound repair hash');
  assert.deepEqual(body.messages.slice(1),agentChatBody({model:'synthetic',maxTokens:100,messages:messages.filter(message=>message.role!=='system'),tools:[]}).messages);
  assert.equal(JSON.stringify(messages),before);
});

test('Qwen leading-system compatibility is limited to the verified provider and model', () => {
  const messages:ModelMessage[]=[{role:'user',content:[{type:'text',text:'original'}]},{role:'system',content:[{type:'text',text:'trusted'}]}];
  for(const [model,url] of [['synthetic','https://api.siliconflow.cn'],['Qwen/Qwen3.5-4B','https://api.deepseek.com'],['Qwen/Qwen3.5-4B','https://api.siliconflow.cn.example']]){
    assert.deepEqual(agentChatBody({model,maxTokens:100,messages,tools:[]},url).messages.map(message=>message.role),['user','system']);
  }
});

test('Qwen merged trusted messages retain text limits and never put images in the system role', () => {
  assert.throws(()=>agentChatBody({model:'Qwen/Qwen3.5-4B',maxTokens:100,tools:[],messages:[
    {role:'system',content:[{type:'text',text:'x'.repeat(24000)}]},
    {role:'system',content:[{type:'text',text:'y'.repeat(24000)}]},
  ]}),/agent_input_limit/);
  assert.throws(()=>agentChatBody({model:'Qwen/Qwen3.5-4B',maxTokens:100,tools:[],messages:[
    {role:'system',content:[{type:'image',mediaId:'synthetic',hash:'hash',mimeType:'image/png',data:'YWJj'}]},
  ]}),/agent_image_limit/);
});

test('questions do not open memory writes and quoted or hypothetical requests do not open human handoff', () => {
  assert.equal(agentToolsForMessage('书房怎么摆桌？', true).some(t => t.name === 'record_need'), false);
  assert.equal(agentToolsForMessage('请记住，书房要双人桌。', true).some(t => t.name === 'record_need'), true);
  for (const text of ['不要找设计师', '如果我说找设计师会怎样', '只是引用“帮我找设计师”']) {
    assert.equal(agentToolsForMessage(text, true).some(t => t.name === 'request_designer'), false);
  }
  assert.equal(agentToolsForMessage('书房太暗了，帮我找设计师聊聊', true).some(t => t.name === 'request_designer'), true);
  assert.deepEqual(agentToolsForMessage('请记住书房要双人桌', false), []);
  assert.equal(agentToolsForMessage('比较两种布局方案', true).some(t => t.name === 'query_business'), false);
  assert.equal(agentToolsForMessage('查看我的方案', true).some(t => t.name === 'query_business'), true);
  assert.equal(agentToolsForMessage('那确认了吗？', true, true).some(t => t.name === 'query_business'), true);
  assert.equal(agentToolsForMessage('没有依据也保证最终只要一万元', true).some(t => t.name === 'record_need'), false);
});

test('an explicit correction followed by a save acknowledgement question allows memory without authorizing proposals', () => {
  for (const text of ['更正一下，书房改成单人书桌了，你记住了吗？', '纠正，厨房改为封闭式。记下了吗？']) {
    assert.ok(agentToolsForMessage(text, true).some(t => t.name === 'record_need'), text);
  }
  for (const text of ['更正一下，书房可以改成单人书桌，你记住了吗？', '更正一下，假如书房改成单人书桌了，你记住了吗？', '他说“更正一下，书房改成单人书桌了，你记住了吗？”', '更正一下，书房改成单人书桌了，不要记录，你记住了吗？', '书房改成单人书桌可以吗？']) {
    assert.equal(agentToolsForMessage(text, true).some(t => t.name === 'record_need'), false, text);
  }
});

test('a professional question after an explicit correction retains the memory tool without granting a designer request', () => {
  const tools = agentToolsForMessage('更正一下，书房改为单人办公，设备不变。底盒现在怎样核对，还在等谁？', true);
  assert.ok(tools.some(t => t.name === 'record_need'));
  assert.ok(tools.some(t => t.name === 'search_knowledge'));
  assert.equal(tools.some(t => t.name === 'request_designer'), false);
});
