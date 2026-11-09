import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { eq } from 'drizzle-orm';
import { platformConfigs } from '@/db/schema';
import { withPlatformTransaction } from '@/db/transaction';
import { PlatformConfigRepository, AiProviderConfigRepository } from '@/db/repositories';
import { closePostgresPool, getPostgresPool } from '@/lib/postgresql';
import { encryptText, maskSecret } from '@/lib/crypto';
import {
  getPlatformLlmConfig, getPlatformLlmOverrideRuntime, getPlatformLlmRuntimeConfig,
  listPlatformLlmModels, savePlatformLlmConfig, testPlatformLlmConnection,
} from '@/lib/platform-llm-config';
import { isPlatformLlmOverrideProvider } from '@/lib/ai/provider-types';
import { openAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';

// A disposable schema clones only two table definitions, never business rows.
// Run: npx tsx --test src/db/__tests__/platform-llm-config.test.ts
const schemaName = `llm_config_test_${process.pid}_${Date.now()}`;
let owner: Pool;
let server: Server;
let baseUrl = '';
let originalDatabaseUrl: string | undefined;
let probeReply = '红色';
const requests: Array<{ path: string; authorization?: string; body: Record<string, unknown> }> = [];
let delayReply: (() => Promise<void>) | undefined;

before(async () => {
  loadEnvConfig(process.cwd());
  originalDatabaseUrl = process.env.DATABASE_URL;
  const target = new URL(originalDatabaseUrl!);
  const migration = new URL(process.env.DATABASE_MIGRATION_URL || originalDatabaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'LLM fixture requires the local development database');
  assert.equal(migration.host, target.host);
  assert.equal(migration.pathname, target.pathname);
  assert.match(schemaName, /^llm_config_test_\d+_\d+$/);
  owner = new Pool({ connectionString: migration.toString(), max: 1 });
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  await owner.query(`create schema ${quote(schemaName)}`);
  for (const table of ['platform_configs', 'ai_provider_configs']) {
    await owner.query(`create table ${quote(schemaName)}.${table} (like app.${table} including all)`);
  }
  const role = decodeURIComponent(target.username);
  await owner.query(`grant usage on schema ${quote(schemaName)} to ${quote(role)}`);
  await owner.query(`grant select, insert, update, delete on all tables in schema ${quote(schemaName)} to ${quote(role)}`);
  await owner.query(`grant usage, select on all sequences in schema ${quote(schemaName)} to ${quote(role)}`);
  await closePostgresPool();
  // Drizzle explicitly qualifies the app schema, so search_path alone cannot
  // isolate these tables. Rewrite only these two names inside this test process;
  // reject any unexpected application-table access before PostgreSQL sees it.
  getPostgresPool().on('connect', (client) => {
    const query = client.query.bind(client);
    client.query = ((input: string | { text: string }, ...args: unknown[]) => {
      const text = typeof input === 'string' ? input : input.text;
      const isolated = text.replace(/"app"\."(platform_configs|ai_provider_configs)"/g, `"${schemaName}"."$1"`);
      assert.doesNotMatch(isolated, /"app"\./, 'unexpected application-table access in isolated LLM test');
      return Reflect.apply(query, client, [typeof input === 'string' ? isolated : { ...input, text: isolated }, ...args]);
    }) as typeof client.query;
  });
  const active = await withPlatformTransaction(async (tx) => {
    const rows = await tx.select().from(platformConfigs);
    assert.equal(rows.length, 0, 'fixture schema starts with no real config');
    return rows;
  });
  assert.deepEqual(active, []);
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url || '', authorization: req.headers.authorization, body });
    if (req.url?.includes('/chat/completions')) await delayReply?.();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url?.includes('/models') ? { data: [
      { id: 'text-only-model' }, { id: 'Qwen/Test-VL' },
      { id: 'private-vision-alias', architecture: { input_modalities: ['image', 'text'] } },
      { id: 'gpt-4o-text-alias', input_modalities: ['text'] },
    ] } : { choices: [{ message: { content: probeReply } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closePostgresPool();
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  if (owner) {
    await owner.query(`drop schema if exists "${schemaName}" cascade`);
    await owner.end();
  }
});

const chat = (providerKey: string, apiKey?: string) => ({ enabled: true, providerKey, baseUrl, model: `${providerKey}-text`, apiKey });

test('legacy configuration gains a masked provider profile without losing its encrypted key', async () => {
  const apiKey = 'synthetic-legacy-key-01';
  await withPlatformTransaction((tx) => new PlatformConfigRepository(tx).upsert('default', { llmConfig: {
    enabled: true, providerKey: 'legacy', baseUrl, model: 'legacy-text',
    apiKeyEncrypted: encryptText(apiKey), apiKeyMasked: maskSecret(apiKey),
  } }));
  const dto = await getPlatformLlmConfig();
  assert.equal(dto.providerProfiles.legacy.hasApiKey, true);
  assert.equal(dto.providerProfiles.legacy.model, 'legacy-text');
  assert.equal(JSON.stringify(dto).includes(apiKey), false);
  assert.equal(JSON.stringify(dto).includes('apiKeyEncrypted'), false);
  assert.equal((await getPlatformLlmRuntimeConfig()).apiKey, apiKey);
});

test('saving and reentering several providers preserves each key, endpoint and model', async () => {
  await savePlatformLlmConfig(chat('first', 'synthetic-provider-first-01'));
  await savePlatformLlmConfig(chat('second', 'synthetic-provider-second-02'));
  const dto = await savePlatformLlmConfig(chat('first'));
  assert.equal(dto.hasApiKey, true);
  assert.equal(dto.providerProfiles.second.hasApiKey, true);
  assert.equal((await getPlatformLlmRuntimeConfig()).apiKey, 'synthetic-provider-first-01');
  await listPlatformLlmModels({ providerKey: 'second', baseUrl, model: 'second-text' });
  assert.equal(requests.at(-1)?.authorization, 'Bearer synthetic-provider-second-02');
  assert.equal((await getPlatformLlmConfig()).providerKey, 'first', 'listing an inactive provider must not switch routing');
  const restored = await savePlatformLlmConfig({ enabled: true, providerKey: 'legacy', baseUrl, model: 'legacy-text' });
  assert.equal(restored.hasApiKey, true);
  assert.equal((await getPlatformLlmRuntimeConfig()).apiKey, 'synthetic-legacy-key-01');
});

test('edited endpoints and unknown providers never receive another saved key', async () => {
  const beforeCount = requests.length;
  await assert.rejects(listPlatformLlmModels({ providerKey: 'first', baseUrl: 'https://changed.example.invalid/v1' }), /API Key/);
  await assert.rejects(listPlatformLlmModels({ providerKey: 'unknown', baseUrl: 'https://changed.example.invalid/v1' }), /API Key/);
  assert.equal(requests.length, beforeCount);
  await listPlatformLlmModels({ providerKey: 'unknown', baseUrl, model: 'unknown-text' });
  assert.equal(requests.at(-1)?.authorization, undefined);
  await assert.rejects(savePlatformLlmConfig({ enabled: true, providerKey: 'first', baseUrl: 'https://changed.example.invalid/v1', model: 'text' }), /当前服务商/);
  assert.equal((await getPlatformLlmConfig()).providerKey, 'legacy');
});

test('VLM persists independently, filters vision metadata, sends a real image and uses its runtime adapter', async () => {
  const beforeChat = await getPlatformLlmConfig();
  await savePlatformLlmConfig({ ...chat('visual', 'synthetic-visual-key-03'), purpose: 'vision', model: 'private-vision-alias' });
  assert.equal((await getPlatformLlmConfig()).model, beforeChat.model);
  const catalog = await listPlatformLlmModels({ purpose: 'vision' });
  assert.deepEqual(catalog.models.map((item) => item.id).sort(), ['private-vision-alias', 'Qwen/Test-VL'].sort());
  const result = await testPlatformLlmConnection({ purpose: 'vision' });
  assert.equal(result.status, '成功');
  const message = (requests.at(-1)?.body.messages as Array<{ content: Array<{ type: 'text' | 'image_url'; image_url?: { url: string } }> }>)[0];
  assert.equal(message.content[1].type, 'image_url');
  assert.match(message.content[1].image_url!.url, /^data:image\/png;base64,/);
  const image = await loadImage(Buffer.from(message.content[1].image_url!.url.split(',')[1], 'base64'));
  assert.deepEqual([image.width, image.height], [64, 64]);
  const canvas = createCanvas(64, 64);
  const painter = canvas.getContext('2d');
  painter.drawImage(image, 0, 0);
  assert.deepEqual([...painter.getImageData(32, 32, 1, 1).data], [255, 0, 0, 255], 'the actual probe decodes as opaque red');
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, '成功');
  const runtime = await getPlatformLlmOverrideRuntime('vision');
  assert.ok(runtime);
  assert.equal(runtime.modelMappings['vision.reference_analysis'], 'private-vision-alias');
  assert.equal(runtime.modelMappings['chat.general'], undefined);
  assert.equal(runtime.apiKey, 'synthetic-visual-key-03');
  assert.equal(await openAiCompatibleAdapter.chat(runtime, { model: 'private-vision-alias', messages: [{ role: 'user', content: message.content }] }), '红色');
  const chatRuntime = await getPlatformLlmOverrideRuntime();
  assert.equal(chatRuntime?.apiKey, 'synthetic-legacy-key-01');
  const dto = await getPlatformLlmConfig('vision');
  assert.equal(JSON.stringify(dto).includes('synthetic-visual-key'), false);
});

test('reusing LLM credentials resolves on the server, retains a separate visual model and invalidates tests after rotation', async () => {
  await savePlatformLlmConfig({ ...chat('visual'), baseUrl: '', purpose: 'vision', model: 'private-vision-alias', reuseLlmCredentials: true });
  const runtime = await getPlatformLlmOverrideRuntime('vision');
  assert.equal(runtime?.apiKey, 'synthetic-legacy-key-01');
  assert.equal(runtime?.modelMappings['vision.reference_analysis'], 'private-vision-alias');
  await listPlatformLlmModels({ purpose: 'vision', reuseLlmCredentials: true, baseUrl: 'https://ignored.example.invalid/v1', apiKey: 'synthetic-ignored-key' });
  assert.equal(requests.at(-1)?.authorization, 'Bearer synthetic-legacy-key-01');
  await testPlatformLlmConnection({ purpose: 'vision' });
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, '成功');
  await savePlatformLlmConfig(chat('legacy', 'synthetic-rotated-legacy-key-04'));
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, null);
  await savePlatformLlmConfig({ ...chat('visual'), purpose: 'vision', model: 'private-vision-alias', reuseLlmCredentials: false });
  assert.equal((await getPlatformLlmOverrideRuntime('vision'))?.apiKey, 'synthetic-visual-key-03');
});

test('wrong image recognition and empty output fail and preserve retryable status', async () => {
  probeReply = '蓝色';
  await assert.rejects(testPlatformLlmConnection({ purpose: 'vision' }), /未正确识别/);
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, '失败');
  probeReply = '';
  await assert.rejects(testPlatformLlmConnection({ purpose: 'vision' }), /未返回可验证/);
  probeReply = 'synthetic-visual-key-03 红色';
  const tested = await testPlatformLlmConnection({ purpose: 'vision' });
  assert.equal(tested.message.includes('synthetic-visual-key-03'), false, 'upstream credential echoes are redacted');
  assert.equal(JSON.stringify(await getPlatformLlmConfig('vision')).includes('synthetic-visual-key-03'), false);
  probeReply = '红色';
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, '成功');
});

test('an in-flight test cannot mark a newly saved credential as tested', async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  delayReply = async () => { entered(); await gate; };
  const pending = testPlatformLlmConnection({ purpose: 'vision' });
  await ready;
  try {
    await savePlatformLlmConfig({ ...chat('visual', 'synthetic-replaced-visual-key-05'), purpose: 'vision', model: 'private-vision-alias' });
  } finally { release(); delayReply = undefined; }
  await pending;
  assert.equal((await getPlatformLlmConfig('vision')).lastTestStatus, null);
});

test('disabling VLM restores default routing without disabling chat; both projections remain hidden', async () => {
  await savePlatformLlmConfig({ ...chat('visual'), enabled: false, purpose: 'vision', model: 'private-vision-alias' });
  assert.equal(await getPlatformLlmOverrideRuntime('vision'), null);
  assert.ok(await getPlatformLlmOverrideRuntime());
  const keys = await withPlatformTransaction(async (tx) => (await new AiProviderConfigRepository(tx).list()).map((row) => row.key));
  assert.equal(keys.includes('llm-settings-override'), true);
  assert.equal(keys.includes('vlm-settings-override'), true);
  assert.equal(keys.filter((key) => !isPlatformLlmOverrideProvider(key)).length, 0);
  await withPlatformTransaction(async (tx) => {
    const [row] = await tx.select().from(platformConfigs).where(eq(platformConfigs.key, 'default'));
    const raw = JSON.stringify(row.llmConfig);
    assert.equal(raw.includes('synthetic-replaced-visual-key-05'), false, 'database contains ciphertext only');
  });
});

test('Zhipu official profiles persist across provider switches and share the v4 probe/runtime endpoint', async () => {
  const officialBaseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  const config = { enabled: true, providerKey: 'zhipu', baseUrl: officialBaseUrl, model: 'glm-4.7-flash' };
  await savePlatformLlmConfig({ ...config, apiKey: 'synthetic-zhipu-key-06' });
  await savePlatformLlmConfig(chat('legacy'));
  const restored = await savePlatformLlmConfig(config);
  assert.equal(restored.providerKey, 'zhipu');
  assert.equal(restored.hasApiKey, true);
  assert.equal(restored.providerProfiles.zhipu.baseUrl, officialBaseUrl);
  assert.equal(JSON.stringify(restored).includes('synthetic-zhipu-key-06'), false);
  await assert.rejects(listPlatformLlmModels({
    ...config, baseUrl: 'https://changed.example.invalid/api/paas/v4',
  }), /API Key/);
  const previous = globalThis.fetch;
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)));
    assert.equal(String(url), `${officialBaseUrl}/chat/completions`);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-zhipu-key-06');
    return Response.json({ choices: [{ message: { content: '收到' } }] });
  };
  try {
    assert.equal((await testPlatformLlmConnection({})).status, '成功');
    const runtime = await getPlatformLlmOverrideRuntime();
    assert.ok(runtime);
    assert.equal(runtime.adapterConfig?.providerPreset, 'zhipu');
    assert.equal(await openAiCompatibleAdapter.chat(runtime, {
      model: runtime.modelMappings['chat.general']!, messages: [{ role: 'user', content: '你好' }],
    }), '收到');
    assert.deepEqual(urls, [`${officialBaseUrl}/chat/completions`, `${officialBaseUrl}/chat/completions`]);
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' }, 'the short probe must leave tokens for a visible reply');
    assert.equal('thinking' in bodies[1], false, 'normal business calls keep the caller thinking policy');
    assert.equal((await getPlatformLlmConfig()).lastTestStatus, '成功');
  } finally { globalThis.fetch = previous; }
});

test('Zhipu discovery returns free, paid and unknown prices without changing saved configuration', async () => {
  const saved = await getPlatformLlmConfig();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://open.bigmodel.cn/api/paas/v4/models');
    return Response.json({ data: [
      { id: 'glm-4.7-flash' }, { id: 'glm-4.7' }, { id: 'glm-5.3-flash' },
      { id: 'glm-4.6v-flash', free: false }, { id: 'glm-4.6v', free: true },
      { id: 'glm-4v-flash', pricing: { input: 0, output: '0.1' } },
      { id: 'unknown-free-alias' },
    ] });
  };
  try {
    const request = { providerKey: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' };
    const catalog = await listPlatformLlmModels(request);
    assert.deepEqual(Object.fromEntries(catalog.models.map((item) => [item.id, item.free])), {
      'glm-4.7-flash': true, 'glm-4.7': false, 'glm-5.3-flash': false,
      'glm-4.6v-flash': false, 'glm-4.6v': true, 'glm-4v-flash': false, 'unknown-free-alias': null,
    });
    const freeCatalog = await listPlatformLlmModels({ ...request, freeOnly: true });
    assert.deepEqual(freeCatalog.models.map((item) => item.id), ['glm-4.6v', 'glm-4.7-flash']);
    const visual = await listPlatformLlmModels({ ...request, purpose: 'vision', apiKey: 'synthetic-zhipu-price-key' });
    assert.equal(visual.models.find((item) => item.id === 'glm-4.6v-flash')?.free, false);
    assert.equal(visual.models.find((item) => item.id === 'glm-4.6v')?.free, true);
    const after = await getPlatformLlmConfig();
    assert.equal(after.providerKey, saved.providerKey);
    assert.equal(after.model, saved.model);
    assert.equal(after.apiKeyMasked, saved.apiKeyMasked);
  } finally { globalThis.fetch = previous; }
});
