import { createHash } from 'node:crypto';
import { AiProviderConfigRepository, PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import { thinkingBody } from '@/lib/ai/providers/thinking';
import { getZhipuModelFree, isZhipuOfficialBaseUrl } from '@/lib/ai/providers/zhipu';
import { getQiniuModelFree, isQiniuConatusModel } from '@/lib/ai/providers/qiniu';
import {
  PLATFORM_LLM_OVERRIDE_PROVIDER_KEY,
  PLATFORM_VLM_OVERRIDE_PROVIDER_KEY,
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
export type PlatformModelPurpose = 'chat' | 'vision';

export function normalizeLlmPurpose(value?: unknown): PlatformModelPurpose {
  if (value === undefined || value === 'chat') return 'chat';
  if (value === 'vision') return 'vision';
  throw new Error('模型配置用途无效');
}

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
  lastTestCredentialFingerprint?: unknown;
  profiles?: unknown;
  vision?: unknown;
  reuseLlmCredentials?: unknown;
};

export type PlatformLlmConfigInput = {
  enabled?: unknown;
  providerKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
  purpose?: unknown;
  reuseLlmCredentials?: unknown;
};

export type LlmCatalogModel = {
  id: string;
  label: string;
  free: boolean | null;
  ownedBy: string | null;
};

const SILICONFLOW_MODEL_PLAZA_URL = 'https://cloud.siliconflow.cn/open/models';
const SILICONFLOW_PRICING_URL = 'https://www.siliconflow.cn/pricing';
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

export function normalizeStoredConfig(input?: StoredPlatformLlmConfig | null, purpose: PlatformModelPurpose = 'chat') {
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
    model: asText(input?.model) || (purpose === 'vision' ? 'Qwen/Qwen3-VL-8B-Instruct' : DEFAULT_PLATFORM_LLM_CONFIG.model),
    reuseLlmCredentials: purpose === 'vision' && input?.reuseLlmCredentials === true,
    apiKeyEncrypted: asText(input?.apiKeyEncrypted),
    apiKeyMasked: asText(input?.apiKeyMasked),
    lastTestStatus: asText(input?.lastTestStatus) || null,
    lastTestMessage: asText(input?.lastTestMessage) || null,
    lastTestAt: asText(input?.lastTestAt) || null,
    lastTestBaseUrl: asText(input?.lastTestBaseUrl) || null,
    lastTestModel: asText(input?.lastTestModel) || null,
    lastTestApiKeyMasked: asText(input?.lastTestApiKeyMasked) || null,
    lastTestCredentialFingerprint: asText(input?.lastTestCredentialFingerprint) || null,
  };
}

function credentialFingerprint(stored: ReturnType<typeof normalizeStoredConfig>) {
  return createHash('sha256').update(stored.apiKeyEncrypted).digest('hex');
}

function configDto(stored: ReturnType<typeof normalizeStoredConfig>, credentials = stored) {
  const local = isLocalLlmBaseUrl(credentials.baseUrl);
  const hasApiKey = Boolean(credentials.apiKeyEncrypted);
  const credentialReady = isLlmCredentialEncryptionReady();
  const available = stored.enabled
    && Boolean(stored.model)
    && (local || (hasApiKey && credentialReady));
  let unavailableReason: string | null = null;
  if (!stored.enabled) unavailableReason = '大模型服务尚未启用。';
  else if (!stored.model) unavailableReason = '尚未配置模型名称。';
  else if (!local && !credentialReady) unavailableReason = '部署环境缺少可用的凭证加密密钥。';
  else if (!local && !hasApiKey) unavailableReason = '尚未配置 API Key / Access Token。';
  const testMatchesCurrent = stored.lastTestBaseUrl === credentials.baseUrl
    && stored.lastTestModel === stored.model
    && (stored.lastTestCredentialFingerprint
      ? stored.lastTestCredentialFingerprint === credentialFingerprint(credentials)
      : stored.lastTestApiKeyMasked === (credentials.apiKeyMasked || null));

  return {
    enabled: stored.enabled,
    providerKey: stored.providerKey,
    baseUrl: stored.baseUrl,
    model: stored.model,
    reuseLlmCredentials: stored.reuseLlmCredentials,
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

type StoredConnection = ReturnType<typeof normalizeStoredConfig>;
type StoredSettings = StoredConnection & {
  profiles: Record<string, StoredConnection>;
  vision: StoredConnection & { profiles: Record<string, StoredConnection> };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeProfiles(value: unknown, purpose: PlatformModelPurpose) {
  return Object.fromEntries(Object.entries(asRecord(value))
    .filter(([key]) => /^[a-z0-9_-]{2,40}$/i.test(key))
    .map(([key, profile]) => [key, normalizeStoredConfig({ ...asRecord(profile), providerKey: key }, purpose)]));
}

function normalizeSettings(value: unknown): StoredSettings {
  const record = asRecord(value);
  const chat = normalizeStoredConfig(record);
  const visionRecord = asRecord(record.vision);
  const vision = normalizeStoredConfig(visionRecord, 'vision');
  return {
    ...chat,
    profiles: { ...normalizeProfiles(record.profiles, 'chat'), [chat.providerKey]: chat },
    vision: {
      ...vision,
      profiles: { ...normalizeProfiles(visionRecord.profiles, 'vision'), [vision.providerKey]: vision },
    },
  };
}

function purposeConfig(settings: StoredSettings, purpose: PlatformModelPurpose) {
  return purpose === 'vision' ? settings.vision : settings;
}

function effectiveCredentials(settings: StoredSettings, purpose: PlatformModelPurpose) {
  return purpose === 'vision' && settings.vision.reuseLlmCredentials ? settings : purposeConfig(settings, purpose);
}

function settingsDto(settings: StoredSettings, purpose: PlatformModelPurpose) {
  const stored = purposeConfig(settings, purpose);
  return {
    ...configDto(stored, effectiveCredentials(settings, purpose)),
    purpose,
    providerProfiles: Object.fromEntries(Object.entries(stored.profiles)
      .map(([key, profile]) => [key, configDto(profile)])),
    linkedLlm: purpose === 'vision' ? {
      providerKey: settings.providerKey, baseUrl: settings.baseUrl,
      hasApiKey: Boolean(settings.apiKeyEncrypted), apiKeyMasked: settings.apiKeyMasked || null,
    } : null,
  };
}

/** Saved credentials belong to an exact preset and endpoint, never to an arbitrary edited URL. */
export function selectLlmSavedConnection(
  stored: StoredConnection,
  profiles: Record<string, StoredConnection>,
  providerKey: string,
  baseUrl: string,
) {
  const candidate = providerKey === stored.providerKey ? stored : profiles[providerKey];
  return candidate && candidate.baseUrl === baseUrl ? candidate : null;
}

export function normalizeLlmProviderRuntimeBaseUrl(baseUrl: string) {
  return normalizeLlmBaseUrl(baseUrl).replace(/\/v1$/i, '');
}

export function isPlatformLlmOverrideModelKey(logicalModelKey: string) {
  return logicalModelKey === 'chat.general' || logicalModelKey === 'vision.reference_analysis';
}

async function upsertLlmProviderProjection(
  transaction: PostgresTransaction,
  stored: ReturnType<typeof normalizeStoredConfig>,
  actorId?: bigint,
  updateExisting = true,
  purpose: PlatformModelPurpose = 'chat',
) {
  const vision = purpose === 'vision';
  const key = vision ? PLATFORM_VLM_OVERRIDE_PROVIDER_KEY : PLATFORM_LLM_OVERRIDE_PROVIDER_KEY;
  const dto = configDto(stored);
  const repository = new AiProviderConfigRepository(transaction);
  const operationalState = {
    managedBy: 'llm-settings',
    providerPreset: stored.providerKey,
    lastTestedAt: dto.lastTestAt ? new Date(dto.lastTestAt) : null,
    lastTestOk: dto.lastTestStatus === '成功'
      ? true
      : dto.lastTestStatus === '失败'
        ? false
        : null,
    lastTestMessage: dto.lastTestMessage || '',
  };
  const values = {
    name: vision ? 'VLM 视觉模型配置（系统托管）' : 'LLM 大模型配置（系统托管）',
    adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(stored.baseUrl),
    apiKeyEncrypted: stored.apiKeyEncrypted,
    apiKeyMasked: stored.apiKeyMasked,
    credentialsEncrypted: { apiKey: stored.apiKeyEncrypted },
    credentialsMasked: { apiKey: stored.apiKeyMasked },
    adapterConfig: { managedBy: 'llm-settings', providerPreset: stored.providerKey },
    capabilities: [vision ? 'vision' : 'chat'],
    modelMappings: toStoredModelMappings({ [vision ? 'vision.reference_analysis' : 'chat.general']: stored.model }),
    priority: 0,
    timeoutMs: PLATFORM_LLM_CHAT_TIMEOUT_MS,
    enabled: stored.enabled,
    costRules: [],
    operationalState,
    ...(actorId ? { updatedBy: actorId } : {}),
  };

  let provider = await repository.findByKey(key);
  if (!provider) {
    provider = await repository.createIfMissing({
      key,
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
      return normalizeSettings(row?.llmConfig);
    });
  } catch (error) {
    if (isMissingLlmMigration(error)) return normalizeSettings(null);
    throw error;
  }
}

export async function getPlatformLlmConfig(purpose?: unknown) {
  return settingsDto(await readStoredConfig(), normalizeLlmPurpose(purpose));
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

export async function getPlatformLlmOverrideRuntime(purpose: PlatformModelPurpose = 'chat'): Promise<AiProviderRuntimeConfig | null> {
  const settings = await readStoredConfig();
  const selected = purposeConfig(settings, purpose);
  const stored = { ...selected, ...effectiveCredentials(settings, purpose),
    enabled: selected.enabled, model: selected.model };
  if (!stored.enabled) return null;

  const label = purpose === 'vision' ? 'VLM 视觉模型配置' : 'LLM 大模型配置';
  const availability = configDto(stored);
  if (!availability.available) {
    throw new Error(`${label}已启用但不可用：${availability.unavailableReason || '配置不完整'}`);
  }

  let apiKey = '';
  try {
    apiKey = stored.apiKeyEncrypted ? decryptText(stored.apiKeyEncrypted) : '';
  } catch {
    throw new Error('LLM 大模型配置已启用，但已保存凭据无法解密，请重新填写 API Key');
  }

  const provider = await withPlatformTransaction((transaction) =>
    upsertLlmProviderProjection(transaction, stored, undefined, false, purpose)
  );
  return {
    id: String(provider.id),
    key: purpose === 'vision' ? PLATFORM_VLM_OVERRIDE_PROVIDER_KEY : PLATFORM_LLM_OVERRIDE_PROVIDER_KEY,
    name: label,
    adapterType: 'openai_compatible',
    baseUrl: normalizeLlmProviderRuntimeBaseUrl(stored.baseUrl),
    apiKey,
    adapterConfig: { managedBy: 'llm-settings', providerPreset: stored.providerKey },
    capabilities: [purpose === 'vision' ? 'vision' : 'chat'],
    modelMappings: { [purpose === 'vision' ? 'vision.reference_analysis' : 'chat.general']: stored.model },
    timeoutMs: PLATFORM_LLM_CHAT_TIMEOUT_MS,
    costRules: [],
  };
}

export async function savePlatformLlmConfig(input: PlatformLlmConfigInput, actorId?: bigint) {
  const purpose = normalizeLlmPurpose(input.purpose);
  const reuseLlmCredentials = purpose === 'vision' && input.reuseLlmCredentials === true;
  if (typeof input.enabled !== 'boolean') throw new Error('启用状态无效');
  const submittedBaseUrl = reuseLlmCredentials ? '' : normalizeLlmBaseUrl(input.baseUrl);
  const model = asText(input.model);
  if (!model) throw new Error('Model 模型名称不能为空');
  if (model.length > 240) throw new Error('Model 模型名称不能超过 240 个字符');
  const submittedProviderKey = asText(input.providerKey) || 'custom';
  if (!reuseLlmCredentials && !/^[a-z0-9_-]{2,40}$/i.test(submittedProviderKey)) throw new Error('服务预设无效');
  const submittedKey = reuseLlmCredentials ? '' : asText(input.apiKey);
  if (submittedKey && !isLlmCredentialEncryptionReady()) {
    throw new Error('生产环境必须配置 AI_PROVIDER_KEY_ENCRYPTION_SECRET 或 JWT_SECRET 后才能保存大模型凭据');
  }

  try {
    const saved = await withPlatformTransaction(async (transaction) => {
      const repository = new PlatformConfigRepository(transaction);
      const currentRow = await repository.ensureForUpdate('default');
      const settings = normalizeSettings(currentRow?.llmConfig);
      const selected = purposeConfig(settings, purpose);
      const providerKey = reuseLlmCredentials ? selected.providerKey : submittedProviderKey;
      const baseUrl = reuseLlmCredentials ? selected.baseUrl : submittedBaseUrl;
      const current = selectLlmSavedConnection(selected, selected.profiles, providerKey, baseUrl)
        || normalizeStoredConfig({ providerKey, baseUrl, model }, purpose);
      const nextApiKeyEncrypted = submittedKey
        ? encryptText(submittedKey)
        : current.apiKeyEncrypted;
      const nextApiKeyMasked = submittedKey
        ? maskSecret(submittedKey)
        : current.apiKeyMasked;
      const credentials = reuseLlmCredentials ? settings : {
        ...current, baseUrl, apiKeyEncrypted: nextApiKeyEncrypted, apiKeyMasked: nextApiKeyMasked,
      };
      if (input.enabled && !isLocalLlmBaseUrl(credentials.baseUrl) && !credentials.apiKeyEncrypted) {
        throw new Error(reuseLlmCredentials
          ? '请先在 LLM 大模型中保存 API Key，或关闭复用并单独配置 VLM 凭据'
          : '启用模型覆盖前，请先填写当前服务商与接口地址的 API Key / Access Token');
      }
      if (input.enabled && !isLlmCredentialEncryptionReady()) {
        throw new Error('启用 LLM Chat 覆盖前，请先配置生产环境凭证加密密钥');
      }
      const lastTestMatchesNext = current.lastTestBaseUrl === credentials.baseUrl
        && current.lastTestModel === model
        && current.lastTestCredentialFingerprint === credentialFingerprint(credentials);
      const next = {
        enabled: input.enabled as boolean,
        providerKey,
        baseUrl,
        model,
        reuseLlmCredentials,
        apiKeyEncrypted: nextApiKeyEncrypted,
        apiKeyMasked: nextApiKeyMasked,
        lastTestStatus: lastTestMatchesNext ? current.lastTestStatus : null,
        lastTestMessage: lastTestMatchesNext ? current.lastTestMessage : null,
        lastTestAt: lastTestMatchesNext ? current.lastTestAt : null,
        lastTestBaseUrl: lastTestMatchesNext ? current.lastTestBaseUrl : null,
        lastTestModel: lastTestMatchesNext ? current.lastTestModel : null,
        lastTestApiKeyMasked: lastTestMatchesNext ? current.lastTestApiKeyMasked : null,
        lastTestCredentialFingerprint: lastTestMatchesNext ? current.lastTestCredentialFingerprint : null,
      };
      const updated = { ...next, profiles: { ...selected.profiles, [providerKey]: next } };
      const nextSettings: StoredSettings = purpose === 'vision'
        ? { ...settings, vision: updated }
        : { ...settings, ...updated };
      await repository.upsert('default', { llmConfig: nextSettings });
      await upsertLlmProviderProjection(transaction, nextSettings, actorId);
      const visionCredentials = effectiveCredentials(nextSettings, 'vision');
      await upsertLlmProviderProjection(transaction, {
        ...nextSettings.vision,
        baseUrl: visionCredentials.baseUrl, providerKey: visionCredentials.providerKey,
        apiKeyEncrypted: visionCredentials.apiKeyEncrypted, apiKeyMasked: visionCredentials.apiKeyMasked,
      }, actorId, true, 'vision');
      return nextSettings;
    });
    return settingsDto(saved, purpose);
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

function redactCredential(message: string, apiKey: string) {
  return apiKey ? message.split(apiKey).join('[redacted]') : message;
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

function catalogTokenPrice(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    if (['free', '免费'].includes(value.trim().toLowerCase())) return 0;
  }
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
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
    const inputPrices = [pricing?.input, pricing?.prompt].map(catalogTokenPrice);
    const outputPrices = [pricing?.output, pricing?.completion].map(catalogTokenPrice);
    const explicitlyPaid = row.free === false
      || [...inputPrices, ...outputPrices].some((price) => price !== null && price > 0);
    const explicitlyFree = row.free === true || (inputPrices.includes(0) && outputPrices.includes(0));
    const free = explicitlyPaid ? false : explicitlyFree ? true : null;
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

/** Rendered tariff rows override the plaza's sometimes stale/default zero prices. */
export function parseSiliconFlowPricingPage(html: string) {
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const entries = [...text.matchAll(/<a\b[^>]*\btitle="([\w./-]+)"[^>]*>/g)];
  const prices = new Map<string, boolean>();
  entries.forEach((entry, index) => {
    const id = entry[1];
    if (!id.includes('/')) return;
    const start = entry.index || 0;
    const end = Math.min(entries[index + 1]?.index ?? text.length, start + 8_000);
    const section = text.slice(start, end);
    const rates = [...section.matchAll(/[¥￥]\s*([\d,]+(?:\.\d+)?)/g)]
      .map(match => Number(match[1].replaceAll(',', '')));
    const paid = rates.some(rate => rate > 0);
    const free = rates.length >= 2 && rates.every(rate => rate === 0)
      || (section.match(/>\s*(?:免费|Free)\s*</gi)?.length ?? 0) >= 2;
    if (paid || free) prices.set(id, prices.get(id) === false || paid ? false : true);
  });
  return prices;
}

export function mergeSiliconFlowModelPrices(plazaHtml: string, pricingHtml: string) {
  const prices = new Map([...parseSiliconFlowFreeModelIds(plazaHtml)].map(id => [id, true]));
  for (const [id, free] of parseSiliconFlowPricingPage(pricingHtml)) {
    if (free === false || !prices.has(id)) prices.set(id, free);
  }
  return prices;
}

async function fetchSiliconFlowModelPrices() {
  try {
    const responses = await Promise.all([SILICONFLOW_MODEL_PLAZA_URL, SILICONFLOW_PRICING_URL].map(url => fetch(url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Smart-Floor-Planner' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })));
    if (responses.some(response => !response.ok)) return null;
    const [plazaHtml, pricingHtml] = await Promise.all(responses.map(response => response.text()));
    // A missing/unrecognizable tariff page cannot validate the plaza's zero prices.
    if (!parseSiliconFlowPricingPage(pricingHtml).size) return null;
    return mergeSiliconFlowModelPrices(plazaHtml, pricingHtml);
  } catch {
    return null;
  }
}

type LlmConnectionInput = {
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
  freeOnly?: unknown;
  providerKey?: unknown;
  purpose?: unknown;
  reuseLlmCredentials?: unknown;
};

async function resolveRequestConfig(input: LlmConnectionInput) {
  const purpose = normalizeLlmPurpose(input.purpose);
  const settings = await readStoredConfig();
  const stored = purposeConfig(settings, purpose);
  const reuseLlmCredentials = purpose === 'vision'
    && (typeof input.reuseLlmCredentials === 'boolean' ? input.reuseLlmCredentials : stored.reuseLlmCredentials);
  const providerKey = reuseLlmCredentials ? settings.providerKey : asText(input.providerKey) || stored.providerKey;
  const baseUrl = reuseLlmCredentials ? settings.baseUrl : normalizeLlmBaseUrl(input.baseUrl || stored.baseUrl);
  const model = asText(input.model) || stored.model;
  const saved = reuseLlmCredentials ? settings : selectLlmSavedConnection(stored, stored.profiles, providerKey, baseUrl);
  const submittedKey = reuseLlmCredentials ? '' : asText(input.apiKey);
  let apiKey = submittedKey;
  if (!apiKey && saved?.apiKeyEncrypted) {
    try { apiKey = decryptText(saved.apiKeyEncrypted); }
    catch { throw new Error('当前服务商的已保存凭据无法解密，请重新填写 API Key'); }
  }
  if (!model) throw new Error('Model 模型名称不能为空');
  if (!apiKey && !isLocalLlmBaseUrl(baseUrl)) {
    throw new Error('请填写有效的 API Key / Access Token');
  }
  let fingerprint: string | null = null;
  if (saved) {
    try {
      if (!submittedKey || (saved.apiKeyEncrypted && decryptText(saved.apiKeyEncrypted) === submittedKey)) {
        fingerprint = credentialFingerprint(saved);
      }
    } catch { /* A replacement key can still test even when the old key cannot decrypt. */ }
  }
  return { baseUrl, model, apiKey, purpose, providerKey, fingerprint };
}

/** Catalog hints only; custom aliases may have no vision marker and remain manually selectable. */
export function isVisionModel(model: string) {
  return /(?:^|[\s/_.:-])vl(?:[\s/_.:-]|\d|$)|vision|glm[^/]*\d(?:\.\d+)?v|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|pixtral|llava|internvl|qvq|step[^/]*vl|qwen[^/]*omni|o[134](?:[\s/_.:-]|$)/i.test(model);
}

function catalogVisionCapability(model: LlmCatalogModel, payload: unknown, baseUrl: string) {
  const rows = asRecord(payload).data || asRecord(payload).models;
  const row = Array.isArray(rows) ? rows.find((item) => asRecord(item).id === model.id || asRecord(item).name === model.id) : null;
  const metadata = asRecord(row);
  const modalities = metadata.input_modalities || asRecord(metadata.architecture).input_modalities;
  return Array.isArray(modalities) ? modalities.includes('image') : isQiniuConatusModel(baseUrl, model.id) || isVisionModel(model.id);
}

export async function listPlatformLlmModels(input: LlmConnectionInput) {
  const { baseUrl, apiKey, purpose } = await resolveRequestConfig(input);
  const url = new URL(`${baseUrl}/models`);
  // SiliconFlow classifies VLMs under chat; "vision" is not a supported sub_type.
  if (new URL(baseUrl).hostname === 'api.siliconflow.cn') url.searchParams.set('sub_type', 'chat');
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
  const payload = await readJsonResponse(response, '拉取模型目录').catch((error: unknown) => {
    throw new Error(redactCredential(error instanceof Error ? error.message : '拉取模型目录失败', apiKey));
  });
  const freeOnly = input.freeOnly === true;
  let allModels = parseLlmModelCatalog(payload, false).map((item) => ({
    ...item, free: item.free ?? getZhipuModelFree(baseUrl, item.id) ?? getQiniuModelFree(baseUrl, item.id),
  }));
  if (purpose === 'vision') allModels = allModels.filter((item) => catalogVisionCapability(item, payload, baseUrl));
  const local = isLocalLlmBaseUrl(baseUrl);
  let siliconFlowPlazaAvailable = false;
  if (baseUrl.includes('siliconflow.cn')) {
    const prices = purpose === 'vision' ? null : await fetchSiliconFlowModelPrices();
    siliconFlowPlazaAvailable = prices !== null;
    allModels = allModels
      .filter((item) => !NON_CHAT_MODEL_MARKERS.some((marker) => item.id.toLowerCase().includes(marker)))
      .map((item) => prices?.has(item.id)
        ? { ...item, free: item.free === false || prices.get(item.id) === false ? false : true } : item);
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
        : purpose === 'vision' ? '目录中没有可识别的视觉模型；可手动填写支持图片输入的模型 ID 或自定义别名。' : '上游未返回可用模型。',
  };
}

async function writeTestResult(
  status: '成功' | '失败',
  message: string,
  testedAt: string,
  tested: Awaited<ReturnType<typeof resolveRequestConfig>>,
) {
  if (!tested.fingerprint) return; // Unsaved credentials must not overwrite a saved connection's status.
  await withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const row = await repository.ensureForUpdate('default');
    const settings = normalizeSettings(row?.llmConfig);
    const current = purposeConfig(settings, tested.purpose);
    const credentials = effectiveCredentials(settings, tested.purpose);
    if (credentials.providerKey !== tested.providerKey || credentials.baseUrl !== tested.baseUrl
      || current.model !== tested.model || credentialFingerprint(credentials) !== tested.fingerprint) return;
    const next = normalizeStoredConfig({
      ...current,
      lastTestStatus: status,
      lastTestMessage: message.slice(0, 800),
      lastTestAt: testedAt,
      lastTestBaseUrl: tested.baseUrl,
      lastTestModel: tested.model,
      lastTestApiKeyMasked: credentials.apiKeyMasked,
      lastTestCredentialFingerprint: tested.fingerprint,
    }, tested.purpose);
    const updated = { ...next, profiles: { ...current.profiles, [current.providerKey]: next } };
    const nextSettings = tested.purpose === 'vision' ? { ...settings, vision: updated } : { ...settings, ...updated };
    await repository.upsert('default', { llmConfig: nextSettings });
    await upsertLlmProviderProjection(transaction, {
      ...next, baseUrl: credentials.baseUrl, providerKey: credentials.providerKey,
      apiKeyEncrypted: credentials.apiKeyEncrypted, apiKeyMasked: credentials.apiKeyMasked,
    }, undefined, true, tested.purpose);
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
  const content = message.content;
  const reply = asText(Array.isArray(content)
    ? content.map((part) => asText(asRecord(part).text)).join('')
    : content || first.text || record.output || record.response || record.text);
  if (!reply) throw new Error('模型未返回可验证的文本响应，请核对模型能力与 Token 限制');
  return reply;
}

// An opaque red 64x64 PNG. No customer image or external image URL is used by the probe.
const VISION_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEX/AAAZ4gk3AAAAD0lEQVR4nGNgGAWjgHwAAAJAAAFZNqEDAAAAAElFTkSuQmCC';

export async function testPlatformLlmConnection(input: LlmConnectionInput) {
  const tested = await resolveRequestConfig(input);
  const { baseUrl, model, apiKey, purpose } = tested;
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
        messages: [{ role: 'user', content: purpose === 'vision' ? [
          { type: 'text', text: '这张图片主要是什么颜色？只回答颜色名称。' },
          { type: 'image_url', image_url: { url: VISION_TEST_IMAGE } },
        ] : '你好，请仅回复两个字：收到。' }],
        temperature: 0.1,
        ...thinkingBody(baseUrl, isZhipuOfficialBaseUrl(baseUrl) || isQiniuConatusModel(baseUrl, model) ? false : undefined),
        max_tokens: 256,
        stream: false,
      }),
    });
    const payload = await readJsonResponse(response, '大模型连接测试');
    const reply = redactCredential(extractTestReply(payload), apiKey);
    if (purpose === 'vision' && !/红|red/i.test(reply)) {
      throw new Error(`模型未正确识别视觉测试图，请确认支持图片输入。模型响应：${reply.slice(0, 160)}`);
    }
    const message = `连接成功，${purpose === 'vision' ? '视觉测试' : '模型'}响应：${reply.slice(0, 500)}`;
    await writeTestResult('成功', message, testedAt, tested);
    return { status: '成功' as const, message, testedAt, baseUrl, model };
  } catch (error) {
    const detail = redactCredential(error instanceof Error ? error.message : '未知连接错误', apiKey);
    await writeTestResult('失败', detail, testedAt, tested).catch(() => undefined);
    throw new Error(
      isLocalLlmBaseUrl(baseUrl) && /abort|timeout/i.test(detail)
        ? '本地模型在 90 秒内没有返回，请确认服务已启动、模型已加载且模型名称完全一致'
        : detail
    );
  }
}
