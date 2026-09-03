import { AiProviderConfigRepository, PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import {
  PLATFORM_LLM_OVERRIDE_PROVIDER_KEY,
  toStoredModelMappings,
  type AiProviderRuntimeConfig,
} from '@/lib/ai/provider-types';

export const DEFAULT_PLATFORM_LLM_CONFIG = {
  enabled: false,
  providerKey: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'Qwen/Qwen2.5-7B-Instruct',
};

// Reasoning-capable models (for example DeepSeek R1) can take longer than the
// short provider-pool timeout. Keep this timeout scoped to the explicit LLM
// settings override; the regular AI provider routing remains unchanged.
export const PLATFORM_LLM_CHAT_TIMEOUT_MS = 90_000;

type StoredPlatformLlmConfig = {
  enabled?: unknown;
  providerKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKeyEncrypted?: unknown;
  apiKeyMasked?: unknown;
  lastTestStatus?: unknown;
  lastTestMessage?: unknown;
  lastTestAt?: unknown;
  lastTestBaseUrl?: unknown;
  lastTestModel?: unknown;
  lastTestApiKeyMasked?: unknown;
};

export type PlatformLlmConfigInput = {
  enabled?: unknown;
  providerKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
};

export type LlmCatalogModel = {
  id: string;
  label: string;
  free: boolean | null;
  ownedBy: string | null;
};

const SILICONFLOW_MODEL_PLAZA_URL = 'https://cloud.siliconflow.cn/open/models';
const NON_CHAT_MODEL_MARKERS = [
  'ocr', 'bge-', 'embed', 'rerank', 'asr', 'tts', 'whisper', 'sensevoice',
  'kolors', 'stable-diffusion', 'flux-1', 'flux.1', 'hunyuanvideo', 'index-tts',
  'indextts',
];

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isMissingLlmMigration(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || error || '').toLowerCase();
  return candidate?.code === '42703'
    || (message.includes('llm_config') && message.includes('column'));
}

export function isLocalLlmBaseUrl(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return ['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

export function normalizeLlmBaseUrl(value: unknown) {
  const input = asText(value);
  if (!input) throw new Error('Base URL 不能为空');
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Base URL 必须是有效的 HTTP 或 HTTPS 地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Base URL 必须是有效的 HTTP 或 HTTPS 地址');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base URL 不能包含账号、查询参数或锚点');
  }
  return input.replace(/\/+$/, '');
}

export function isLlmCredentialEncryptionReady() {
  if (process.env.NODE_ENV !== 'production') return true;
  return Boolean(
    process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim()
      || process.env.JWT_SECRET?.trim()
  );
}

function normalizeStoredConfig(input?: StoredPlatformLlmConfig | null) {
  const baseUrl = (() => {
    try {
      return normalizeLlmBaseUrl(input?.baseUrl || DEFAULT_PLATFORM_LLM_CONFIG.baseUrl);
    } catch {
      return DEFAULT_PLATFORM_LLM_CONFIG.baseUrl;
    }
  })();
  return {
    enabled: typeof input?.enabled === 'boolean'
      ? input.enabled
      : DEFAULT_PLATFORM_LLM_CONFIG.enabled,
    providerKey: asText(input?.providerKey) || DEFAULT_PLATFORM_LLM_CONFIG.providerKey,
    baseUrl,
    model: asText(input?.model) || DEFAULT_PLATFORM_LLM_CONFIG.model,
    apiKeyEncrypted: asText(input?.apiKeyEncrypted),
    apiKeyMasked: asText(input?.apiKeyMasked),
    lastTestStatus: asText(input?.lastTestStatus) || null,
    lastTestMessage: asText(input?.lastTestMessage) || null,
    lastTestAt: asText(input?.lastTestAt) || null,
    lastTestBaseUrl: asText(input?.lastTestBaseUrl) || null,
    lastTestModel: asText(input?.lastTestModel) || null,
    lastTestApiKeyMasked: asText(input?.lastTestApiKeyMasked) || null,
  };
}

function configDto(stored: ReturnType<typeof normalizeStoredConfig>) {
  const local = isLocalLlmBaseUrl(stored.baseUrl);
  const hasApiKey = Boolean(stored.apiKeyEncrypted);
  const credentialReady = isLlmCredentialEncryptionReady();
  const available = stored.enabled
    && Boolean(stored.model)
    && (local || (hasApiKey && credentialReady));
  let unavailableReason: string | null = null;
  if (!stored.enabled) unavailableReason = '大模型服务尚未启用。';
  else if (!stored.model) unavailableReason = '尚未配置模型名称。';
  else if (!local && !credentialReady) unavailableReason = '部署环境缺少可用的凭证加密密钥。';
  else if (!local && !hasApiKey) unavailableReason = '尚未配置 API Key / Access Token。';
  const testMatchesCurrent = stored.lastTestBaseUrl === stored.baseUrl
    && stored.lastTestModel === stored.model
    && stored.lastTestApiKeyMasked === (stored.apiKeyMasked || null);

  return {
    enabled: stored.enabled,
    providerKey: stored.providerKey,
    baseUrl: stored.baseUrl,
    model: stored.model,
    apiKeyMasked: stored.apiKeyMasked || null,
    hasApiKey,
    credentialReady,
    available,
    unavailableReason,
    lastTestStatus: testMatchesCurrent ? stored.lastTestStatus : null,
    lastTestMessage: testMatchesCurrent ? stored.lastTestMessage : null,
    lastTestAt: testMatchesCurrent ? stored.lastTestAt : null,
    routingSource: stored.enabled ? 'llm_settings' as const : 'ai_providers' as const,
    fallbackOnError: false,
  };
}

export function normalizeLlmProviderRuntimeBaseUrl(baseUrl: string) {
  return normalizeLlmBaseUrl(baseUrl).replace(/\/v1$/i, '');
}

export function isPlatformLlmOverrideModelKey(logicalModelKey: string) {
  return logicalModelKey === 'chat.general';
}

async function upsertLlmProviderProjection(
  transaction: PostgresTransaction,
  stored: ReturnType<typeof normalizeStoredConfig>,
  actorId?: bigint,
  updateExisting = true,
) {
  const repository = new AiProviderConfigRepository(transaction);
  const operationalState = {
    managedBy: 'llm-settings',
    providerPreset: stored.providerKey,
    lastTestedAt: stored.lastTestAt ? new Date(stored.lastTestAt) : null,
    lastTestOk: stored.lastTestStatus === '成功'
      ? true
      : stored.lastTestStatus === '失败'
        ? false
        : null,
    lastTestMessage: stored.lastTestMessage || '',
  };
  const values = {
    name: 'LLM 大模型配置（系统托管）',
    adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(stored.baseUrl),
    apiKeyEncrypted: stored.apiKeyEncrypted,
    apiKeyMasked: stored.apiKeyMasked,
    credentialsEncrypted: { apiKey: stored.apiKeyEncrypted },
    credentialsMasked: { apiKey: stored.apiKeyMasked },
    adapterConfig: { managedBy: 'llm-settings', providerPreset: stored.providerKey },
    capabilities: ['chat'],
    modelMappings: toStoredModelMappings({ 'chat.general': stored.model }),
    priority: 0,
    timeoutMs: PLATFORM_LLM_CHAT_TIMEOUT_MS,
    enabled: stored.enabled,
    costRules: [],
    operationalState,
    ...(actorId ? { updatedBy: actorId } : {}),
  };

  let provider = await repository.findByKey(PLATFORM_LLM_OVERRIDE_PROVIDER_KEY);
  if (!provider) {
    provider = await repository.createIfMissing({
      key: PLATFORM_LLM_OVERRIDE_PROVIDER_KEY,
      ...values,
      ...(actorId ? { createdBy: actorId } : {}),
    });
  } else if (updateExisting) {
    provider = await repository.update(provider.id, values);
  }
  if (!provider) throw new Error('无法建立 LLM 大模型运行配置');
  return provider;
}

async function readStoredConfig() {
  try {
    return await withPlatformTransaction(async (transaction) => {
      const row = await new PlatformConfigRepository(transaction).findByKey('default');
      return normalizeStoredConfig(row?.llmConfig as StoredPlatformLlmConfig | undefined);
    });
  } catch (error) {
    if (isMissingLlmMigration(error)) return normalizeStoredConfig(null);
    throw error;
  }
}

export async function getPlatformLlmConfig() {
  return configDto(await readStoredConfig());
}

export async function getPlatformLlmRuntimeConfig() {
  const stored = await readStoredConfig();
  let apiKey = '';
  if (stored.apiKeyEncrypted) {
    try {
      apiKey = decryptText(stored.apiKeyEncrypted);
    } catch {
      throw new Error('已保存的大模型凭据无法解密，请重新填写 API Key');
    }
  }
  return { ...stored, apiKey };
}

export async function getPlatformLlmOverrideRuntime(): Promise<AiProviderRuntimeConfig | null> {
  const stored = await readStoredConfig();
  if (!stored.enabled) return null;

  const availability = configDto(stored);
  if (!availability.available) {
    throw new Error(`LLM 大模型配置已启用但不可用：${availability.unavailableReason || '配置不完整'}`);
  }

  let apiKey = '';
  try {
    apiKey = stored.apiKeyEncrypted ? decryptText(stored.apiKeyEncrypted) : '';
  } catch {
    throw new Error('LLM 大模型配置已启用，但已保存凭据无法解密，请重新填写 API Key');
  }

  const provider = await withPlatformTransaction((transaction) =>
    upsertLlmProviderProjection(transaction, stored, undefined, false)
  );
  return {
    id: String(provider.id),
    key: PLATFORM_LLM_OVERRIDE_PROVIDER_KEY,
    name: 'LLM 大模型配置',
    adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(stored.baseUrl),
    apiKey,
    adapterConfig: { managedBy: 'llm-settings', providerPreset: stored.providerKey },
    capabilities: ['chat'],
    modelMappings: { 'chat.general': stored.model },
    timeoutMs: PLATFORM_LLM_CHAT_TIMEOUT_MS,
    costRules: [],
  };
}

export async function savePlatformLlmConfig(input: PlatformLlmConfigInput, actorId?: bigint) {
  if (typeof input.enabled !== 'boolean') throw new Error('启用状态无效');
  const baseUrl = normalizeLlmBaseUrl(input.baseUrl);
  const model = asText(input.model);
  if (!model) throw new Error('Model 模型名称不能为空');
  if (model.length > 240) throw new Error('Model 模型名称不能超过 240 个字符');
  const providerKey = asText(input.providerKey) || 'custom';
  if (!/^[a-z0-9_-]{2,40}$/i.test(providerKey)) throw new Error('服务预设无效');
  const submittedKey = asText(input.apiKey);
  if (submittedKey && !isLlmCredentialEncryptionReady()) {
    throw new Error('生产环境必须配置 AI_PROVIDER_KEY_ENCRYPTION_SECRET 或 JWT_SECRET 后才能保存大模型凭据');
  }

  try {
    const saved = await withPlatformTransaction(async (transaction) => {
      const repository = new PlatformConfigRepository(transaction);
      const currentRow = await repository.ensureForUpdate('default');
      const current = normalizeStoredConfig(
        currentRow?.llmConfig as StoredPlatformLlmConfig | undefined
      );
      const nextApiKeyEncrypted = submittedKey
        ? encryptText(submittedKey)
        : current.apiKeyEncrypted;
      const nextApiKeyMasked = submittedKey
        ? maskSecret(submittedKey)
        : current.apiKeyMasked;
      if (input.enabled && !isLocalLlmBaseUrl(baseUrl) && !nextApiKeyEncrypted) {
        throw new Error('启用 LLM Chat 覆盖前，请先填写 API Key / Access Token');
      }
      if (input.enabled && !isLlmCredentialEncryptionReady()) {
        throw new Error('启用 LLM Chat 覆盖前，请先配置生产环境凭证加密密钥');
      }
      const criticalChanged = current.baseUrl !== baseUrl
        || current.model !== model
        || (submittedKey && maskSecret(submittedKey) !== current.apiKeyMasked);
      const lastTestMatchesNext = current.lastTestBaseUrl === baseUrl
        && current.lastTestModel === model
        && current.lastTestApiKeyMasked === (submittedKey ? maskSecret(submittedKey) : current.apiKeyMasked);
      const next = {
        enabled: input.enabled as boolean,
        providerKey,
        baseUrl,
        model,
        apiKeyEncrypted: nextApiKeyEncrypted,
        apiKeyMasked: nextApiKeyMasked,
        lastTestStatus: criticalChanged && !lastTestMatchesNext ? null : current.lastTestStatus,
        lastTestMessage: criticalChanged && !lastTestMatchesNext ? null : current.lastTestMessage,
        lastTestAt: criticalChanged && !lastTestMatchesNext ? null : current.lastTestAt,
        lastTestBaseUrl: criticalChanged && !lastTestMatchesNext ? null : current.lastTestBaseUrl,
        lastTestModel: criticalChanged && !lastTestMatchesNext ? null : current.lastTestModel,
        lastTestApiKeyMasked: criticalChanged && !lastTestMatchesNext ? null : current.lastTestApiKeyMasked,
      };
      await repository.upsert('default', { llmConfig: next });
      await upsertLlmProviderProjection(transaction, normalizeStoredConfig(next), actorId);
      return normalizeStoredConfig(next);
    });
    return configDto(saved);
  } catch (error) {
    if (isMissingLlmMigration(error)) {
      throw new Error('LLM 配置字段尚未完成数据库迁移，请先运行 npm run db:migrate');
    }
    throw error;
  }
}

function bearerHeaders(apiKey: string) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function upstreamErrorText(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const nested = record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>).message
      : null;
    for (const value of [nested, record.message, record.detail, record.error]) {
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 400);
    }
  }
  return fallback.slice(0, 400);
}

async function readJsonResponse(response: Response, action: string) {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    if (response.ok) throw new Error(`${action}返回了无效 JSON`);
  }
  if (!response.ok) {
    throw new Error(`${action}失败：${upstreamErrorText(payload, text || `HTTP ${response.status}`)}`);
  }
  return payload;
}

export function parseLlmModelCatalog(payload: unknown, freeOnly = false): LlmCatalogModel[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const source = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const seen = new Set<string>();
  const models: LlmCatalogModel[] = [];
  for (const item of source) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const id = asText(row.id || row.name || item);
    if (!id || seen.has(id)) continue;
    const ownedBy = asText(row.owned_by || row.ownedBy) || null;
    const label = asText(row.label || row.display_name || row.displayName) || id;
    const pricing = row.pricing && typeof row.pricing === 'object'
      ? row.pricing as Record<string, unknown>
      : null;
    const priceValues = pricing ? [pricing.input, pricing.output, pricing.prompt, pricing.completion] : [];
    const explicitlyFree = row.free === true
      || priceValues.some((value) => value === 0 || value === '0')
      || /(^|[\s._/-])(free|免费)([\s._/-]|$)/i.test(`${id} ${label}`);
    const explicitlyPaid = row.free === false;
    const free = explicitlyFree ? true : explicitlyPaid ? false : null;
    if (freeOnly && free !== true) continue;
    seen.add(id);
    models.push({ id, label, free, ownedBy });
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

export function parseSiliconFlowFreeModelIds(html: string) {
  if (!html) return new Set<string>();
  const text = html.replace(/\\"/g, '"');
  const freeIds = new Set<string>();
  const paidIds = new Set<string>();
  const modelMatches = [...text.matchAll(/"modelName"\s*:\s*"([^"]+)"/g)];
  modelMatches.forEach((match, index) => {
    const id = match[1]?.trim();
    if (!id || id.toLowerCase().startsWith('pro/')) return;
    const start = match.index || 0;
    const end = modelMatches[index + 1]?.index ?? Math.min(text.length, start + 4_000);
    const section = text.slice(start, end);
    const status = section.match(/"status"\s*:\s*"([^"]+)"/i)?.[1]?.toLowerCase();
    if (status && ['disable', 'disabled', 'deprecated', 'offline'].includes(status)) return;
    const prices = [...section.matchAll(/"price"\s*:\s*"([^"]+)"/g)].map((item) => item[1]);
    if (prices.length) {
      if (prices.every((price) => ['0', '0.0', '0.00'].includes(price))) freeIds.add(id);
      else paidIds.add(id);
    } else if (/"(?:Free|免费)"|>\s*(?:Free|免费)\s*</i.test(section)) {
      freeIds.add(id);
    }
  });
  paidIds.forEach((id) => freeIds.delete(id));
  return freeIds;
}

async function fetchSiliconFlowFreeModelIds() {
  try {
    const response = await fetch(SILICONFLOW_MODEL_PLAZA_URL, {
      headers: { Accept: 'text/html', 'User-Agent': 'Smart-Floor-Planner' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const ids = parseSiliconFlowFreeModelIds(html);
    return ids.size || /"modelName"\s*:/.test(html.replace(/\\"/g, '"')) ? ids : null;
  } catch {
    return null;
  }
}

type LlmConnectionInput = {
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
  freeOnly?: unknown;
};

async function resolveRequestConfig(input: LlmConnectionInput) {
  const stored = await getPlatformLlmRuntimeConfig();
  const baseUrl = normalizeLlmBaseUrl(input.baseUrl || stored.baseUrl);
  const model = asText(input.model) || stored.model;
  const apiKey = asText(input.apiKey) || stored.apiKey;
  if (!model) throw new Error('Model 模型名称不能为空');
  if (!apiKey && !isLocalLlmBaseUrl(baseUrl)) {
    throw new Error('请填写有效的 API Key / Access Token');
  }
  return { baseUrl, model, apiKey };
}

export async function listPlatformLlmModels(input: LlmConnectionInput) {
  const { baseUrl, apiKey } = await resolveRequestConfig(input);
  const url = new URL(`${baseUrl}/models`);
  if (baseUrl.includes('siliconflow.cn')) url.searchParams.set('sub_type', 'chat');
  let response: Response;
  try {
    response = await fetch(url, {
      headers: bearerHeaders(apiKey),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`无法拉取模型目录：${error instanceof Error ? error.message : '网络连接失败'}`);
  }
  const payload = await readJsonResponse(response, '拉取模型目录');
  const freeOnly = input.freeOnly === true;
  let allModels = parseLlmModelCatalog(payload, false);
  const local = isLocalLlmBaseUrl(baseUrl);
  let siliconFlowPlazaAvailable = false;
  if (baseUrl.includes('siliconflow.cn')) {
    const freeIds = await fetchSiliconFlowFreeModelIds();
    siliconFlowPlazaAvailable = freeIds !== null;
    allModels = allModels
      .filter((item) => !NON_CHAT_MODEL_MARKERS.some((marker) => item.id.toLowerCase().includes(marker)))
      .map((item) => freeIds?.has(item.id) ? { ...item, free: true } : item);
  }
  const models = local
    ? allModels.map((model) => ({ ...model, free: true }))
    : freeOnly
      ? allModels.filter((model) => model.free === true)
      : allModels;
  return {
    models,
    freeOnly,
    message: models.length
      ? null
      : freeOnly
        ? baseUrl.includes('siliconflow.cn') && !siliconFlowPlazaAvailable
          ? '上游目录未标注免费模型，且暂时无法读取官方模型广场；请稍后重试或手动填写模型 ID。'
          : '上游目录没有提供可确认的免费模型，请关闭免费筛选或手动填写模型 ID。'
        : '上游未返回可用模型。',
  };
}

async function writeTestResult(
  status: '成功' | '失败',
  message: string,
  testedAt: string,
  baseUrl: string,
  model: string,
  apiKey: string
) {
  await withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const row = await repository.ensureForUpdate('default');
    const current = normalizeStoredConfig(row?.llmConfig as StoredPlatformLlmConfig | undefined);
    const next = normalizeStoredConfig({
      ...current,
      lastTestStatus: status,
      lastTestMessage: message.slice(0, 800),
      lastTestAt: testedAt,
      lastTestBaseUrl: baseUrl,
      lastTestModel: model,
      lastTestApiKeyMasked: apiKey ? maskSecret(apiKey) : null,
    });
    await repository.upsert('default', { llmConfig: next });
    await upsertLlmProviderProjection(transaction, next);
  });
}

function extractTestReply(payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : {};
  const message = first.message && typeof first.message === 'object'
    ? first.message as Record<string, unknown>
    : {};
  const reply = asText(message.content || first.text || record.output || record.response || record.text);
  return reply || '已收到有效响应';
}

export async function testPlatformLlmConnection(input: LlmConnectionInput) {
  const { baseUrl, model, apiKey } = await resolveRequestConfig(input);
  const testedAt = new Date().toISOString();
  const timeoutMs = PLATFORM_LLM_CHAT_TIMEOUT_MS;
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: bearerHeaders(apiKey),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '你好，请仅回复两个字：收到。' }],
        temperature: 0.1,
        max_tokens: 8,
        stream: false,
      }),
    });
    const payload = await readJsonResponse(response, '大模型连接测试');
    const reply = extractTestReply(payload);
    const message = `连接成功，模型响应：${reply}`;
    await writeTestResult('成功', message, testedAt, baseUrl, model, apiKey);
    return { status: '成功' as const, message, testedAt, baseUrl, model };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知连接错误';
    await writeTestResult('失败', detail, testedAt, baseUrl, model, apiKey).catch(() => undefined);
    throw new Error(
      isLocalLlmBaseUrl(baseUrl) && /abort|timeout/i.test(detail)
        ? '本地模型在 90 秒内没有返回，请确认服务已启动、模型已加载且模型名称完全一致'
        : detail
    );
  }
}
