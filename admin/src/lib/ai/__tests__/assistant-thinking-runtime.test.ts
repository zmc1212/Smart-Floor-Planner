import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantThinkingOverrideAllowed } from '../postgres-workflow-chat';
import { agentChatBody } from '../providers/agent-chat';

const official = { adapterType: 'openai_compatible' as const, adapterConfig: { providerPreset: 'dashscope' },
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };

test('user-selected Qwen3.8 Flash supports the existing non-thinking override only on its official bound runtime', () => {
  assert.equal(assistantThinkingOverrideAllowed(official, 'qwen3.8-flash', false), true);
  assert.equal(assistantThinkingOverrideAllowed(official, 'qwen3.7-flash', false), false);
  for (const changed of [{ ...official, baseUrl: 'https://fixture.invalid/compatible-mode/v1' },
    { ...official, baseUrl: 'https://dashscope.aliyuncs.com/other/v1' },
    { ...official, adapterConfig: { providerPreset: 'custom' } }, { ...official, adapterType: 'grs' as const }]) {
    assert.equal(assistantThinkingOverrideAllowed(changed, 'qwen3.8-flash', false), false);
  }
  const body = agentChatBody({ model: 'qwen3.8-flash', maxTokens: 2048, messages: [{ role: 'user', content: [{ type: 'text', text: '量房前需要准备什么？' }] }],
    tools: [{ name: 'final_response', description: 'answer', parameters: { type: 'object' } }], enableThinking: false, requireTool: true }, official.baseUrl);
  assert.equal(body.enable_thinking, false); assert.equal(body.max_tokens, 2048);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
});
