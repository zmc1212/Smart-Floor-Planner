import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantThinkingOverrideAllowed, assertAssistantThinkingOverride, boundAssistantModel } from '../postgres-workflow-chat';
import { agentChatBody } from '../providers/agent-chat';

const official = { adapterType: 'openai_compatible' as const, adapterConfig: { providerPreset: 'dashscope' },
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };

test('user-selected Qwen3.8 Flash supports the existing non-thinking override only on its official bound runtime', () => {
  assert.equal(assistantThinkingOverrideAllowed(official, 'qwen3.8-flash', false), true);
  assert.equal(assistantThinkingOverrideAllowed(official, 'qwen3.7-flash', false), true);
  // Another registered platform model connects through the same endpoint, but
  // its thinking-control capability is unrecorded and the override stays off.
  assert.equal(assistantThinkingOverrideAllowed(official, 'qwen3-max', false), false);
  for (const changed of [{ ...official, baseUrl: 'https://fixture.invalid/compatible-mode/v1' },
    { ...official, baseUrl: 'https://dashscope.aliyuncs.com/other/v1' },
    { ...official, adapterConfig: { providerPreset: 'custom' } }, { ...official, adapterType: 'grs' as const }]) {
    assert.equal(assistantThinkingOverrideAllowed(changed, 'qwen3.8-flash', false), false);
  }
  const body = agentChatBody({ model: 'qwen3.8-flash', maxTokens: 2048, messages: [{ role: 'user', content: [{ type: 'text', text: '量房前需要准备什么？' }] }],
    tools: [{ name: 'final_response', description: 'answer', parameters: { type: 'object' } }], enableThinking: false, requireTool: true }, official.baseUrl);
  assert.equal(body.enable_thinking, false); assert.equal(body.max_tokens, 2048);
  // The final-only round uses the documented native schema channel instead of
  // sending the final tool again; thinking control is the subject of this test.
  assert.equal(body.tools, undefined); assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'final_response', strict: true, schema: { type: 'object' } } });
});

test('Beijing DeepSeek Flash uses a named final tool with thinking disabled', () => {
  const model = 'deepseek-v4.1-flash-1017';
  assert.equal(assistantThinkingOverrideAllowed(official, model, false), true);
  assert.equal(assistantThinkingOverrideAllowed(official, 'deepseek-v4.1-flash', false), true);
  assert.equal(assistantThinkingOverrideAllowed({ ...official, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }, model, false), false);
  const tool = { name: 'final_response', description: 'answer', parameters: { type: 'object' } };
  const body = agentChatBody({ model, maxTokens: 2048, messages: [], tools: [tool], enableThinking: false, requireTool: true }, official.baseUrl);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.response_format, undefined);
  assert.deepEqual(body.tools, [{ type: 'function', function: tool }]);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
});

test('the exact mainline ID passes readiness; unsupported bindings retain local configuration errors', () => {
  const model = 'deepseek-v4.1-flash', tool = { name: 'final_response', description: 'answer', parameters: { type: 'object' } };
  assert.doesNotThrow(() => assertAssistantThinkingOverride(official, model, false));
  const body = agentChatBody({ model, maxTokens: 2048, messages: [], tools: [tool], enableThinking: false, requireTool: true }, official.baseUrl);
  assert.equal(body.model, model); assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
  assert.equal(body.response_format, undefined);
  assert.throws(() => assertAssistantThinkingOverride(official, 'unregistered-model', false),
    { code: 'assistant_thinking_configuration_invalid', status: 503 });
  assert.throws(() => boundAssistantModel({ ...official, key: 'dashscope' }, { model, providerKey: 'other' }),
    { code: 'assistant_model_configuration_invalid', status: 503 });
});
