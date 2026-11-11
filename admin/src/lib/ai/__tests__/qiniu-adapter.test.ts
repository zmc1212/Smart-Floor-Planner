import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLlmProviderRuntimeBaseUrl } from '@/lib/platform-llm-config';
import { resolveLlmModelFree } from '@/lib/llm-model-options';
import { assistantThinkingOverrideAllowed, boundAssistantModel } from '../postgres-workflow-chat';
import type { AiProviderRuntimeConfig } from '../provider-types';
import { executeAgentChat } from '../providers/agent-chat';
import { openAiCompatibleAdapter } from '../providers/openai-compatible';
import { getQiniuModelFree, isQiniuOfficialBaseUrl, QINIU_BASE_URL, QINIU_CONATUS_MODEL, QINIU_CONATUS_START, QINIU_CONATUS_END } from '../providers/qiniu';
import { thinkingBody } from '../providers/thinking';

const runtime: AiProviderRuntimeConfig = {
  id: 'synthetic-qiniu', key: 'llm-settings-override', name: '七牛云', adapterType: 'openai_compatible',
  baseUrl: normalizeLlmProviderRuntimeBaseUrl(QINIU_BASE_URL), apiKey: 'synthetic-not-a-key',
  adapterConfig: { providerPreset: 'qiniu' }, timeoutMs: 1000, capabilities: ['chat', 'vision'],
  modelMappings: { 'chat.general': QINIU_CONATUS_MODEL },
};

test('Conatus tariff is limited to the exact official model and campaign window', () => {
  assert.equal(getQiniuModelFree(QINIU_BASE_URL, QINIU_CONATUS_MODEL, QINIU_CONATUS_START), true);
  assert.equal(getQiniuModelFree(QINIU_BASE_URL, QINIU_CONATUS_MODEL, QINIU_CONATUS_END - 1), true);
  for (const now of [QINIU_CONATUS_START - 1, QINIU_CONATUS_END, NaN]) {
    assert.equal(getQiniuModelFree(QINIU_BASE_URL, QINIU_CONATUS_MODEL, now), null);
  }
  for (const endpoint of ['http://api.qnaigc.com/v1', 'https://api.qnaigc.com.invalid/v1',
    'https://api.qnaigc.com/other', 'https://user:secret@api.qnaigc.com/v1', 'https://api.qnaigc.com/v1?key=secret']) {
    assert.equal(isQiniuOfficialBaseUrl(endpoint), false);
    assert.equal(getQiniuModelFree(endpoint, QINIU_CONATUS_MODEL, QINIU_CONATUS_START), null);
    assert.equal(assistantThinkingOverrideAllowed({ ...runtime, baseUrl: endpoint }, QINIU_CONATUS_MODEL, false), false);
  }
  assert.equal(getQiniuModelFree(QINIU_BASE_URL, 'qiniu/conatus-paid', QINIU_CONATUS_START), null);
  assert.equal(resolveLlmModelFree({ baseUrl: QINIU_BASE_URL, model: QINIU_CONATUS_MODEL, catalogFree: false }), false);
});

test('enterprise binding and thinking control cannot borrow another provider or model', () => {
  const config = { providerKey: 'qiniu', model: QINIU_CONATUS_MODEL };
  assert.equal(boundAssistantModel(runtime, config), QINIU_CONATUS_MODEL);
  assert.throws(() => boundAssistantModel(runtime, { ...config, providerKey: 'siliconflow' }), /no longer matches/);
  assert.throws(() => boundAssistantModel(runtime, config, 'old-model'), /no longer matches/);
  assert.equal(assistantThinkingOverrideAllowed(runtime, QINIU_CONATUS_MODEL, false), true);
  assert.equal(assistantThinkingOverrideAllowed(runtime, 'other-model', false), false);
  assert.equal(assistantThinkingOverrideAllowed({ ...runtime, adapterConfig: { providerPreset: 'custom' } }, QINIU_CONATUS_MODEL, false), false);
  assert.deepEqual(thinkingBody(QINIU_BASE_URL, false), { thinking: { type: 'disabled' } });
});

test('Conatus ordinary chat and discovery retain one v1 segment and bearer authentication', async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-not-a-key');
    if (!init?.body) return Response.json({ data: [{ id: QINIU_CONATUS_MODEL }] });
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, QINIU_CONATUS_MODEL);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.enable_thinking, undefined);
    return Response.json({ choices: [{ message: { content: '收到' } }] });
  };
  try {
    assert.equal(await openAiCompatibleAdapter.chat(runtime, { model: QINIU_CONATUS_MODEL,
      messages: [{ role: 'user', content: '你好' }], enableThinking: false }), '收到');
    assert.deepEqual(await openAiCompatibleAdapter.listModels!(runtime), [QINIU_CONATUS_MODEL]);
    assert.deepEqual(urls, ['https://api.qnaigc.com/v1/chat/completions', 'https://api.qnaigc.com/v1/models']);
  } finally { globalThis.fetch = previous; }
});

test('Conatus Agent preserves image input, tool receipts, forced final and actual usage', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.qnaigc.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,YWJj');
    assert.equal(body.messages[2].tool_call_id, 'synthetic-read');
    assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'final_response' } });
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.response_format, undefined);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: 'synthetic-final', type: 'function', function: { name: 'final_response', arguments: '{"answer":"已读记录"}' } },
    ] } }], usage: { prompt_tokens: 120, completion_tokens: 18, prompt_tokens_details: { cached_tokens: 30 } } });
  };
  try {
    const output = await executeAgentChat(runtime, { model: QINIU_CONATUS_MODEL, enableThinking: false, maxTokens: 128,
      messages: [
        { role: 'user', content: [{ type: 'text', text: '看看这张图里的插座位置。' }, { type: 'image', mediaId: 'synthetic-media', hash: 'synthetic-hash', mimeType: 'image/png', data: 'YWJj' }] },
        { role: 'assistant', content: '', toolCalls: [{ id: 'synthetic-read', name: 'read_project', arguments: '{}' }] },
        { role: 'tool', callId: 'synthetic-read', content: '{"status":"read"}' },
      ], tools: [{ name: 'final_response', description: 'Final answer', parameters: { type: 'object' } }], requireTool: true });
    assert.equal(output.toolCalls[0].name, 'final_response');
    assert.deepEqual(output.usage, { inputTokens: 120, outputTokens: 18, cachedInputTokens: 30 });
  } finally { globalThis.fetch = previous; }
});

test('Conatus quota rejection is returned after one attempt without retrying another model', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: 'quota_exhausted', message: 'synthetic quota exhausted' } }, { status: 429 });
  };
  try {
    await assert.rejects(executeAgentChat(runtime, { model: QINIU_CONATUS_MODEL, messages: [
      { role: 'user', content: [{ type: 'text', text: '卫生间装修怎么准备？' }] },
    ], tools: [], maxTokens: 128 }), { code: 'HTTP_429' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
