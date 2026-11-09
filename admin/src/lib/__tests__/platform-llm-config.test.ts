import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  isPlatformLlmOverrideModelKey,
  normalizeLlmBaseUrl,
  normalizeLlmProviderRuntimeBaseUrl,
  parseLlmModelCatalog,
  parseSiliconFlowFreeModelIds,
  parseSiliconFlowPricingPage,
  mergeSiliconFlowModelPrices,
  PLATFORM_LLM_CHAT_TIMEOUT_MS,
  normalizeStoredConfig,
  selectLlmSavedConnection,
  normalizeLlmPurpose,
  isVisionModel,
} from '../platform-llm-config';
import { isShorterModelPrefix, llmModelPriceLabel, resolveLlmModelFree, shouldShowLlmModelOption } from '../llm-model-options';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('LLM Base URL accepts only clean HTTP(S) endpoints', () => {
  assert.equal(
    normalizeLlmBaseUrl('https://api.siliconflow.cn/v1/'),
    'https://api.siliconflow.cn/v1'
  );
  assert.throws(() => normalizeLlmBaseUrl('file:///tmp/models'), /HTTP 或 HTTPS/);
  assert.throws(
    () => normalizeLlmBaseUrl('https://user:secret@example.com/v1'),
    /不能包含账号/
  );
});

test('LLM runtime keeps one OpenAI-compatible v1 path segment', () => {
  assert.equal(
    normalizeLlmProviderRuntimeBaseUrl('https://api.siliconflow.cn/v1'),
    'https://api.siliconflow.cn'
  );
  assert.equal(
    normalizeLlmProviderRuntimeBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    'https://dashscope.aliyuncs.com/compatible-mode'
  );
});

test('model overrides cover chat and vision independently, keeping image routing unchanged', () => {
  assert.equal(isPlatformLlmOverrideModelKey('chat.general'), true);
  assert.equal(isPlatformLlmOverrideModelKey('vision.reference_analysis'), true);
  assert.equal(isPlatformLlmOverrideModelKey('image.generate.standard'), false);
  assert.equal(isPlatformLlmOverrideModelKey('image.edit.standard'), false);
});

test('saved credentials require an exact provider and normalized endpoint match', () => {
  const first = normalizeStoredConfig({ providerKey: 'first', baseUrl: 'https://first.invalid/v1', apiKeyEncrypted: 'cipher-first' });
  const second = normalizeStoredConfig({ providerKey: 'second', baseUrl: 'https://second.invalid/v1', apiKeyEncrypted: 'cipher-second' });
  assert.equal(selectLlmSavedConnection(first, { second }, 'second', second.baseUrl), second);
  assert.equal(selectLlmSavedConnection(first, { second }, 'first', first.baseUrl), first);
  assert.equal(selectLlmSavedConnection(first, { second }, 'second', first.baseUrl), null);
  assert.equal(selectLlmSavedConnection(first, { second }, 'unknown', first.baseUrl), null);
  assert.equal(selectLlmSavedConnection(first, { second }, 'first', 'https://changed.invalid/v1'), null);
});

test('purpose parsing preserves legacy chat clients and rejects unknown scopes', () => {
  assert.equal(normalizeLlmPurpose(), 'chat');
  assert.equal(normalizeLlmPurpose('vision'), 'vision');
  assert.throws(() => normalizeLlmPurpose('image'), /用途无效/);
});

test('vision catalog hints include common model families without treating pure text as visual', () => {
  for (const id of ['Qwen/Qwen2.5-VL-7B-Instruct', 'Qwen/Qwen3-VL-8B-Instruct', 'zai-org/GLM-4.5V', 'gpt-4o', 'gemini-2.5-pro', 'llava']) {
    assert.equal(isVisionModel(id), true, id);
  }
  for (const id of ['deepseek-chat', 'Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-R1']) assert.equal(isVisionModel(id), false, id);
});

test('LLM override reserves a longer timeout for reasoning chat models', () => {
  assert.equal(PLATFORM_LLM_CHAT_TIMEOUT_MS, 90_000);
});

test('prompt assist keeps the 120-second API and Mini Program timeout boundary', () => {
  const miniRoute = source('../../app/api/miniprogram/ai/studio/prompt-assist/route.ts');
  const adminRoute = source('../../app/api/ai/creation/prompt-assist/route.ts');
  const miniClient = readFileSync(
    new URL('../../../../miniprogram/utils/aiDesignService.js', import.meta.url),
    'utf8'
  );

  assert.match(miniRoute, /export const maxDuration = 120/);
  assert.match(adminRoute, /export const maxDuration = 120/);
  assert.match(miniClient, /\/miniprogram\/ai\/studio\/prompt-assist'[\s\S]*timeout: 120000/);
});

test('SiliconFlow public catalog parser keeps price-zero active models only', () => {
  const ids = parseSiliconFlowFreeModelIds(`
    {"modelName":"Qwen/Free","status":"online","price":"0","price":"0.00"}
    {"modelName":"Qwen/Paid","status":"online","price":"0","price":"0.01"}
    {"modelName":"Qwen/Offline","status":"offline","price":"0"}
  `);
  assert.deepEqual([...ids], ['Qwen/Free']);
});

test('rendered SiliconFlow tariffs override conflicting zero plaza prices without leaking adjacent rows', () => {
  const plaza = '{"modelName":"zai-org/GLM-5.3-Flash","price":"0"}{"modelName":"Qwen/Free","price":"0"}';
  const pricing = `<script><a title="Qwen/Free">¥ 99</a></script>
    <a title="zai-org/GLM-5.3-Flash">GLM-5.3-Flash</a><span>¥ 0.80</span><span>¥ 2.80</span><span>¥ 0.23</span>
    <a title="XingChenAGI/Xing4.0-29B">Xing4.0-29B</a><span>免费</span><span>免费</span>
    <a title="Qwen/Partial">partial</a><span>免费</span>
    <a title="Qwen/Zero">zero</a><span>¥ 0.00</span><span>¥ 0</span>
    <a title="Qwen/Conflict">conflict</a><span>免费</span><span>免费</span><span>¥ 1.00</span>
    <a title="Qwen/Zero">duplicate</a><span>¥ 1,000.00</span><span>¥ 0</span>`;
  assert.deepEqual(Object.fromEntries(parseSiliconFlowPricingPage(pricing)), {
    'zai-org/GLM-5.3-Flash': false, 'XingChenAGI/Xing4.0-29B': true,
    'Qwen/Zero': false, 'Qwen/Conflict': false,
  });
  const merged = mergeSiliconFlowModelPrices(plaza, pricing);
  assert.equal(merged.get('zai-org/GLM-5.3-Flash'), false);
  assert.equal(merged.get('Qwen/Free'), true);
  assert.equal(merged.has('Qwen/Partial'), false);
  assert.equal(merged.get('XingChenAGI/Xing4.0-29B'), true);
  assert.equal(parseSiliconFlowPricingPage('unavailable').size, 0);
});

test('model catalog normalizes OpenAI rows and honors explicit free metadata', () => {
  const rows = parseLlmModelCatalog({
    data: [
      { id: 'paid-model', owned_by: 'vendor', free: false },
      { id: 'free-model', display_name: 'Free Model', pricing: { input: '0', output: '0.00' } },
      { id: 'free-model', display_name: 'duplicate' },
    ],
  });
  assert.deepEqual(rows, [
    { id: 'free-model', label: 'Free Model', free: true, ownedBy: null },
    { id: 'paid-model', label: 'paid-model', free: false, ownedBy: 'vendor' },
  ]);
  assert.deepEqual(parseLlmModelCatalog({ data: rows }, true), [
    { id: 'free-model', label: 'Free Model', free: true, ownedBy: null },
  ]);
});

test('catalog pricing never treats partial zero rates, free-looking names or positive-rate conflicts as free', () => {
  const payload = { data: [
    { id: 'zero-input-paid-output', pricing: { input: 0, output: '0.5' } },
    { id: 'paid-input-zero-output', pricing: { input: '0.1', output: 0 } },
    { id: 'conflicting-free-flag', free: true, pricing: { prompt: '0', completion: '0.01' } },
    { id: 'explicit-paid', free: false, pricing: { input: 0, output: 0 } },
    { id: 'partial-zero', pricing: { input: '0' } },
    { id: 'name-free', display_name: '免费体验' },
    { id: 'invalid-price', pricing: { input: '', output: null } },
    { id: 'negative-price', pricing: { input: -1, output: 0 } },
    { id: 'decimal-zero', pricing: { input: '0.00', output: '0e-8' } },
    { id: 'alias-zero', pricing: { prompt: 'free', completion: '免费' } },
    { id: 'explicit-free', free: true },
  ] };
  assert.deepEqual(Object.fromEntries(parseLlmModelCatalog(payload).map((item) => [item.id, item.free])), {
    'zero-input-paid-output': false,
    'paid-input-zero-output': false,
    'conflicting-free-flag': false,
    'explicit-paid': false,
    'partial-zero': null,
    'name-free': null,
    'invalid-price': null,
    'negative-price': null,
    'decimal-zero': true,
    'alias-zero': true,
    'explicit-free': true,
  });
  assert.deepEqual(parseLlmModelCatalog(payload, true).map((item) => item.id), [
    'alias-zero', 'decimal-zero', 'explicit-free',
  ]);
});

test('model price labels use exact official Zhipu tariffs, preserve upstream flags and keep proxy prices unknown', () => {
  const baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  for (const [model, label] of [
    ['glm-4.7-flash', '免费'], ['glm-4.6v-flash', '免费'],
    ['glm-4.7', '付费'], ['glm-4.6v', '付费'], ['glm-5.3', '付费'],
    ['glm-5.3-flash', '付费'], ['glm-4.7-flashx', '付费'],
    ['glm-4.7-flash-new-alias', '价格未知'], ['toString', '价格未知'],
  ]) {
    assert.equal(llmModelPriceLabel(resolveLlmModelFree({ baseUrl, model })), label, model);
  }
  assert.equal(resolveLlmModelFree({ baseUrl, model: 'glm-4.7-flash', catalogFree: false }), false);
  assert.equal(resolveLlmModelFree({ baseUrl, model: 'glm-4.7', catalogFree: true }), true);
  assert.equal(resolveLlmModelFree({ baseUrl, model: '__proto__' }), null);
  assert.equal(resolveLlmModelFree({ baseUrl, model: 'constructor' }), null);
  assert.equal(resolveLlmModelFree({ baseUrl: 'https://proxy.invalid/api/paas/v4', model: 'glm-4.7-flash' }), null);
  assert.equal(resolveLlmModelFree({ baseUrl: 'https://open.bigmodel.cn.invalid/api/paas/v4', model: 'glm-4.7-flash' }), null);
  assert.equal(resolveLlmModelFree({ baseUrl: 'http://localhost:11434/v1', model: 'installed-local-model', local: true }), true);
});

test('LLM settings route, menu, permission, migration, and secret boundary stay connected', () => {
  const service = source('../platform-llm-config.ts');
  const configDtoSource = service.slice(
    service.indexOf('function configDto'),
    service.indexOf('export function normalizeLlmProviderRuntimeBaseUrl')
  );
  const page = source('../../app/(admin)/(platform)/llm-settings/page.tsx');
  const sidebar = source('../../components/Sidebar.tsx');
  const roles = source('../admin-user-roles.ts');
  const proxy = source('../../proxy.ts');
  const route = source('../../app/api/platform/llm-config/route.ts');
  const providerRoute = source('../../app/api/admin/ai-providers/route.ts');
  const providerRegistry = source('../ai/provider-registry.ts');
  const workflowChat = source('../ai/postgres-workflow-chat.ts');
  const migration = source('../../../drizzle/0055_platform_llm_config.sql');

  assert.match(page, /LLM大模型配置/);
  assert.match(page, /\/api\/platform\/llm-config\/models/);
  assert.match(page, /\/api\/platform\/llm-config\/test/);
  assert.match(sidebar, /key: 'llm-settings', label: 'LLM大模型配置'/);
  assert.match(roles, /key: 'llm-settings', label: 'LLM大模型配置'/);
  assert.match(proxy, /'\/llm-settings': 'llm-settings'/);
  assert.match(proxy, /'\/api\/platform\/llm-config': 'llm-settings'/);
  assert.match(route, /roles: \['super_admin', 'admin'\]/);
  assert.match(service, /PLATFORM_LLM_OVERRIDE_PROVIDER_KEY/);
  assert.match(service, /fallbackOnError: false/);
  assert.match(workflowChat, /getPlatformLlmOverrideRuntime/);
  assert.match(workflowChat, /llmOverride\s*\?\s*\[llmOverride\]/);
  assert.match(providerRegistry, /!isPlatformLlmOverrideProvider\(config\.key\)/);
  assert.match(providerRoute, /!isPlatformLlmOverrideProvider\(provider\.key\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "llm_config" jsonb/);
  assert.match(service, /nextApiKeyEncrypted = submittedKey\s+\? encryptText\(submittedKey\)/);
  assert.doesNotMatch(configDtoSource, /\n\s+apiKey:/);
});

test('model picker shows the complete catalog when the input exactly matches an option', () => {
  const options = [
    { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen/Qwen2.5-7B-Instruct · 免费' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'deepseek-ai/DeepSeek-R1 · 免费' },
  ];

  assert.equal(
    options.every((option) =>
      shouldShowLlmModelOption('Qwen/Qwen2.5-7B-Instruct', option, options)
    ),
    true
  );
});

test('model picker filters only after the user enters a non-exact query', () => {
  const options = [
    { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen/Qwen2.5-7B-Instruct · 免费' },
    { value: 'deepseek-ai/DeepSeek-R1', label: 'deepseek-ai/DeepSeek-R1 · 免费' },
  ];

  assert.equal(shouldShowLlmModelOption('deepseek', options[0], options), false);
  assert.equal(shouldShowLlmModelOption('deepseek', options[1], options), true);
});

test('model picker detects shorter ids that could overwrite the selected model', () => {
  assert.equal(isShorterModelPrefix('Qwen/Qwen2.5-7B', 'Qwen/Qwen2.5-7B-Instruct'), true);
  assert.equal(
    isShorterModelPrefix('Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'),
    false
  );
});
