import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  isPlatformLlmOverrideModelKey,
  normalizeLlmBaseUrl,
  normalizeLlmProviderRuntimeBaseUrl,
  parseLlmModelCatalog,
  parseSiliconFlowFreeModelIds,
  PLATFORM_LLM_CHAT_TIMEOUT_MS,
} from '../platform-llm-config';
import { isShorterModelPrefix, shouldShowLlmModelOption } from '../llm-model-options';

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

test('LLM override is limited to the general chat logical model', () => {
  assert.equal(isPlatformLlmOverrideModelKey('chat.general'), true);
  assert.equal(isPlatformLlmOverrideModelKey('vision.reference_analysis'), false);
  assert.equal(isPlatformLlmOverrideModelKey('image.generate.standard'), false);
  assert.equal(isPlatformLlmOverrideModelKey('image.edit.standard'), false);
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

test('model catalog normalizes OpenAI rows and honors explicit free metadata', () => {
  const rows = parseLlmModelCatalog({
    data: [
      { id: 'paid-model', owned_by: 'vendor', free: false },
      { id: 'free-model', display_name: 'Free Model', pricing: { input: '0' } },
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
