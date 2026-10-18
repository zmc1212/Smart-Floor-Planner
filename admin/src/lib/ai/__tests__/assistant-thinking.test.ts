import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAiCompatibleAdapter } from '../providers/openai-compatible';
import type { AiProviderRuntimeConfig } from '../provider-types';
import { agentChatBody } from '../providers/agent-chat';
test('OpenAI-compatible thinking toggle is opt-in; existing chat bodies stay unchanged',async()=>{
  const previous=globalThis.fetch,bodies:Array<Record<string,unknown>>=[];
  globalThis.fetch=async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:'{"selections":[]}'}}]}));};
  try {
    const runtime={baseUrl:'https://example.invalid',apiKey:'test-only',timeoutMs:1000,name:'fixture'} as AiProviderRuntimeConfig;
    await openAiCompatibleAdapter.chat(runtime,{model:'fixture',messages:[],maxTokens:128});
    await openAiCompatibleAdapter.chat(runtime,{model:'fixture',messages:[],maxTokens:128,enableThinking:false});
    assert.equal('enable_thinking' in bodies[0],false);assert.equal(bodies[1].enable_thinking,false);
    await openAiCompatibleAdapter.chat({ ...runtime, baseUrl: 'https://api.deepseek.com' }, { model: 'deepseek-flash', messages: [], enableThinking: false });
    assert.deepEqual(bodies[2].thinking, { type: 'disabled' });
    assert.equal('enable_thinking' in bodies[2], false);
    const agent = agentChatBody({ model: 'deepseek-flash', messages: [], tools: [{ name: 'final_response', description: 'answer', parameters: { type: 'object' } }], maxTokens: 128, requireTool: true, enableThinking: false }, 'https://api.deepseek.com/v1');
    assert.deepEqual(agent.thinking, { type: 'disabled' });
    assert.equal(agent.tool_choice, 'required');
  }finally{globalThis.fetch=previous;}
});
