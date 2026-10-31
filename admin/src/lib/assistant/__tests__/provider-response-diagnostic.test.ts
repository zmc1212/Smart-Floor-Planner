import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentResponseDiagnostic, parseAgentChat, executeAgentChat, completeJsonBeforeExtraBrace } from '@/lib/ai/providers/agent-chat';
import { AiProviderError, type AiProviderRuntimeConfig } from '@/lib/ai/provider-types';

const packet = { id: 'synthetic-response', choices: [{ message: { content: '{"ok":true}', tool_calls: null }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 50, completion_tokens: 5 } };
test('documented nullable no-call frames preserve text and usage without inventing a tool call', () => {
  const result = parseAgentChat(packet);
  assert.equal(result.text, '{"ok":true}'); assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 5 });
  assert.throws(() => parseAgentChat({ ...packet, choices: [{ message: { content: '', tool_calls: null }, finish_reason: 'stop' }] }), /Invalid/);
  assert.throws(() => parseAgentChat({ ...packet, choices: [{ message: { content: '{"ok":', tool_calls: null }, finish_reason: 'length' }] }), /Invalid/);
});
test('invalid-frame diagnostics retain shape and quantities, never private prose or arguments', () => {
  const invalid = { ...packet, choices: [{ message: { content: 'private source text', tool_calls: [{ type: 'function', id: 'bad.id',
    function: { name: 'final_response', arguments: '{"private":"synthetic secret"}' } }] }, finish_reason: 'length' }] };
  const data = agentResponseDiagnostic(invalid, 'synthetic-request');
  assert.equal(data.finishReason, 'length'); assert.equal(data.calls[0].idValid, false);
  assert.equal(data.calls[0].argumentsObject, true); assert.equal(data.usage.input, 50);
  assert.doesNotMatch(JSON.stringify(data), /private source text|synthetic secret|bad\.id/);
  assert.match(data.responseHash, /^[a-f0-9]{64}$/);
});
test('one invalid HTTP response retains safe diagnostics and remains unknown with no retry', async () => {
  const original = globalThis.fetch; let calls = 0;
  const runtime: AiProviderRuntimeConfig = { id: 'synthetic', key: 'synthetic', name: 'synthetic', adapterType: 'openai_compatible',
    baseUrl: 'https://example.com', apiKey: 'synthetic', capabilities: ['chat'], modelMappings: {}, timeoutMs: 1000 };
  try {
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...packet,
      choices: [{ message: { content: 'private source text', tool_calls: null }, finish_reason: 'length' }] }), { status: 200 }); };
    await assert.rejects(executeAgentChat(runtime, { model: 'synthetic', messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }],
      tools: [], maxTokens: 100 }), error => error instanceof AiProviderError && error.disposition === 'unknown'
      && error.diagnostic?.protocol === 'provider-response-diagnostic-v1' && error.diagnostic.finishReason === 'length'
      && error.privateResponse?.protocol === 'invalid-provider-frame-v1' && !JSON.stringify(error).includes('private source text'));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('saved1608 surface removes one unmatched final brace without changing strings or completing JSON', () => {
  assert.equal(completeJsonBeforeExtraBrace('{"ok":true}}'),'{"ok":true}');
  const text=JSON.stringify({text:'quoted } and " and \\',list:[{ok:true}]});
  assert.equal(completeJsonBeforeExtraBrace(text+'}'),text);
  for(const raw of ['{"ok":true','{"ok":true}} trailing','{"ok":true}}}','{"ok":True}}','[true]}','{"ok":true}'])
    assert.equal(completeJsonBeforeExtraBrace(raw),null);
});

test('observed normalization is exact-model final-only and retains private original arguments', async () => {
  const original=globalThis.fetch;
  const runtime:AiProviderRuntimeConfig={id:'synthetic',key:'synthetic',name:'synthetic',adapterType:'openai_compatible',
    baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',apiKey:'synthetic',capabilities:['chat'],modelMappings:{},timeoutMs:1000};
  const invalid={...packet,choices:[{message:{content:'',tool_calls:[{type:'function',id:'synthetic-call',function:{name:'final_response',arguments:'{"ok":true}}'}}]},finish_reason:'tool_calls'}]};
  const input={model:'qwen3.7-flash',messages:[{role:'user' as const,content:[{type:'text' as const,text:'synthetic'}]}],maxTokens:100,
    tools:[{name:'final_response',description:'synthetic',parameters:{type:'object',properties:{ok:{type:'boolean'}}}}],enableThinking:false,requireTool:true};
  try{globalThis.fetch=async()=>new Response(JSON.stringify(invalid),{status:200});
    const result=await executeAgentChat(runtime,input);assert.equal(result.toolCalls[0].arguments,'{"ok":true}');
    assert.equal(result.wireNormalization?.rawArguments,'{"ok":true}}');assert.doesNotMatch(JSON.stringify(result.observation),/rawArguments/);
    await assert.rejects(executeAgentChat(runtime,{...input,model:'qwen3.8-flash'}));
    await assert.rejects(executeAgentChat({...runtime,baseUrl:'https://example.com'},input));
    await assert.rejects(executeAgentChat(runtime,{...input,tools:[{...input.tools[0],name:'record_need'}]}));
  }finally{globalThis.fetch=original;}
});
