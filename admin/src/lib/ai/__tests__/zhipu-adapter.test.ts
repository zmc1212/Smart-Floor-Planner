import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import type { AiProviderRuntimeConfig } from '../provider-types';
import { executeAgentChat } from '../providers/agent-chat';
import { providerUrl } from '../providers/http';
import { openAiCompatibleAdapter } from '../providers/openai-compatible';
import { temperatureBody, thinkingBody } from '../providers/thinking';
import { ZHIPU_BASE_URL } from '../providers/zhipu';

const runtime: AiProviderRuntimeConfig = {
  id: 'synthetic-zhipu', key: 'llm-settings-override', name: '智谱官方',
  adapterType: 'openai_compatible', baseUrl: normalizeLlmProviderRuntimeBaseUrl(ZHIPU_BASE_URL),
  apiKey: 'synthetic-zhipu-key', timeoutMs: 1000, capabilities: ['chat', 'vision'],
  modelMappings: { 'chat.general': 'glm-4.7-flash', 'vision.reference_analysis': 'glm-4.6v-flash' },
};

test('Zhipu chat and visual calls use the official v4 endpoint and bearer credentials', async () => {
  const previous = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-zhipu-key');
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: '收到' } }] });
  };
  try {
    assert.equal(await openAiCompatibleAdapter.chat(runtime, {
      model: 'glm-4.7-flash', messages: [{ role: 'user', content: '你好' }], temperature: 0,
    }), '收到');
    assert.equal(bodies[0].model, 'glm-4.7-flash');
    assert.equal('temperature' in bodies[0], false);
    assert.equal('thinking' in bodies[0], false);
    const content = [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,YWJj' } }];
    await openAiCompatibleAdapter.chat({ ...runtime, baseUrl: `${ZHIPU_BASE_URL}/` }, {
      model: 'glm-4.6v-flash', messages: [{ role: 'user', content }], enableThinking: false,
    });
    assert.deepEqual(bodies[1].messages, [{ role: 'user', content }]);
    assert.deepEqual(bodies[1].thinking, { type: 'disabled' });
    assert.equal('enable_thinking' in bodies[1], false);
  } finally { globalThis.fetch = previous; }
});

test('Zhipu model discovery shares the official v4 root', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/models');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-zhipu-key');
    return Response.json({ data: [{ id: 'glm-4.7-flash' }] });
  };
  try {
    const models = await openAiCompatibleAdapter.listModels!(runtime);
    assert.deepEqual(models, ['glm-4.7-flash']);
  } finally { globalThis.fetch = previous; }
});

test('Zhipu Agent dispatch preserves forced final tools and parses usage on the same v4 endpoint', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal('temperature' in body, false);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tools[0].function.name, 'final_response');
    return Response.json({
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
        { id: 'synthetic-call', type: 'function', function: { name: 'final_response', arguments: '{"answer":"收到"}' } },
      ] } }], usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
  };
  try {
    const output = await executeAgentChat(runtime, {
      model: 'glm-4.7-flash', messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      tools: [{ name: 'final_response', description: 'answer', parameters: { type: 'object' } }],
      maxTokens: 128, requireTool: true, enableThinking: false,
    });
    assert.equal(output.toolCalls[0].name, 'final_response');
    assert.deepEqual(output.usage, { inputTokens: 12, outputTokens: 8 });
  } finally { globalThis.fetch = previous; }
});

test('Zhipu wire rules match the official endpoint only and preserve other provider behavior', () => {
  for (const baseUrl of [
    'https://api.siliconflow.cn', 'https://dashscope.aliyuncs.com/compatible-mode',
    'https://api.deepseek.com', 'http://127.0.0.1:11434',
    'https://open.bigmodel.cn.invalid/api/paas/v4', 'https://open.bigmodel.cn/another-api',
  ]) {
    assert.equal(providerUrl(baseUrl, '/v1/chat/completions'), `${baseUrl}/v1/chat/completions`);
    assert.deepEqual(temperatureBody(baseUrl, 0), { temperature: 0 });
  }
  assert.deepEqual(thinkingBody(ZHIPU_BASE_URL, true), { thinking: { type: 'enabled' } });
  assert.deepEqual(temperatureBody(ZHIPU_BASE_URL, 0.7), { temperature: 0.7 });
  assert.deepEqual(thinkingBody('https://custom.invalid', false), { enable_thinking: false });
});

test('Zhipu authentication errors are surfaced after one dispatch', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: 'synthetic invalid credential' } }, { status: 401 });
  };
  try {
    await assert.rejects(openAiCompatibleAdapter.chat(runtime, {
      model: 'glm-4.7-flash', messages: [{ role: 'user', content: '你好' }],
    }), { code: 'HTTP_401' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
