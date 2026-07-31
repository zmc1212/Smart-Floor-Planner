import { encryptText, maskSecret } from '@/lib/crypto';
import { AiProviderConfig, type IAiProviderConfig } from '@/models/AiProviderConfig';
import { AI_CAPABILITIES, LOGICAL_MODEL_KEYS, normalizeModelMappings, toStoredModelMappings, type AiCapability, type AiLogicalModelKey, type AiProviderAdapterType } from './provider-types';
import { getProviderAdapterManifest, validateProviderAdapterConfig } from './provider-adapter-manifest';

export function serializeProviderConfig(provider: IAiProviderConfig | Record<string, unknown>) {
  return {
    id: String(provider._id),
    key: provider.key,
    name: provider.name,
    adapterType: provider.adapterType,
    baseUrl: provider.baseUrl,
    apiKeyMasked: provider.apiKeyMasked || '',
    hasApiKey: Boolean(provider.apiKeyMasked),
    credentialsMasked: provider.credentialsMasked || (provider.apiKeyMasked ? { apiKey: provider.apiKeyMasked } : {}),
    adapterConfig: provider.adapterConfig || {},
    capabilities: provider.capabilities || [],
    modelMappings: normalizeModelMappings(provider.modelMappings),
    priority: provider.priority,
    timeoutMs: provider.timeoutMs,
    enabled: provider.enabled,
    costRules: provider.costRules || [],
    discoveredModels: provider.discoveredModels || [],
    lastTestedAt: provider.lastTestedAt || null,
    lastTestOk: provider.lastTestOk,
    lastTestMessage: provider.lastTestMessage || '',
    lastModelSyncAt: provider.lastModelSyncAt || null,
    lastUpstreamBalance: typeof provider.lastUpstreamBalance === 'number' ? provider.lastUpstreamBalance : null,
    lastUpstreamBalanceUnit: provider.lastUpstreamBalanceUnit || '',
    lastUpstreamBalanceAt: provider.lastUpstreamBalanceAt || null,
    lastUpstreamBalanceMessage: provider.lastUpstreamBalanceMessage || '',
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function validateProviderPayload(
  body: Record<string, unknown>,
  partial = false,
  existingAdapterType?: AiProviderAdapterType
) {
  const result: Record<string, unknown> = {};
  const adapterType = String(body.adapterType ?? existingAdapterType ?? '') as AiProviderAdapterType;
  if (!partial || body.key !== undefined) {
    const key = String(body.key || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(key)) throw new Error('供应商标识仅支持 2-50 位小写字母、数字和连字符');
    result.key = key;
  }
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) throw new Error('供应商名称不能为空');
    result.name = name;
  }
  if (!partial || body.adapterType !== undefined) {
    const adapterType = String(body.adapterType || '') as AiProviderAdapterType;
    if (!['grs', 'pollinations', 'openai_compatible'].includes(adapterType)) throw new Error('适配器类型无效');
    result.adapterType = adapterType;
  }
  if (!partial || body.adapterConfig !== undefined || body.adapterType !== undefined) {
    if (!['grs', 'pollinations', 'openai_compatible'].includes(adapterType)) {
      throw new Error('适配器类型无效');
    }
    result.adapterConfig = validateProviderAdapterConfig(adapterType, body.adapterConfig);
  }
  if (!partial || body.baseUrl !== undefined) {
    const baseUrl = String(body.baseUrl || '').trim().replace(/\/$/, '');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 必须使用 HTTP 或 HTTPS');
    result.baseUrl = baseUrl;
  }
  if (!partial || body.capabilities !== undefined) {
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    if (!capabilities.length || capabilities.some((item) => !AI_CAPABILITIES.includes(item as AiCapability))) {
      throw new Error('至少选择一项有效能力');
    }
    result.capabilities = [...new Set(capabilities)];
  }
  if (!partial || body.modelMappings !== undefined) {
    const mappings: Record<string, unknown> = body.modelMappings && typeof body.modelMappings === 'object'
      ? body.modelMappings as Record<string, unknown>
      : {};
    const cleaned: Partial<Record<AiLogicalModelKey, string>> = {};
    for (const key of LOGICAL_MODEL_KEYS) {
      const value = String(mappings[key] || '').trim();
      if (value) cleaned[key] = value;
    }
    result.modelMappings = toStoredModelMappings(cleaned);
  }
  if (!partial || body.priority !== undefined) {
    const priority = Math.trunc(Number(body.priority));
    if (!Number.isFinite(priority) || priority < 0 || priority > 10000) throw new Error('优先级必须在 0-10000 之间');
    result.priority = priority;
  }
  if (!partial || body.timeoutMs !== undefined) {
    const timeoutMs = Math.trunc(Number(body.timeoutMs));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('超时必须在 1000-600000 毫秒之间');
    result.timeoutMs = timeoutMs;
  }
  if (body.enabled !== undefined) result.enabled = Boolean(body.enabled);
  if (body.costRules !== undefined) {
    if (!Array.isArray(body.costRules)) throw new Error('成本规则格式无效');
    result.costRules = body.costRules.map((rule: Record<string, unknown>) => {
      const logicalModelKey = String(rule.logicalModelKey || '') as AiLogicalModelKey;
      const remoteModel = String(rule.remoteModel || '').trim();
      const resolutionTier = String(rule.resolutionTier || '').toUpperCase();
      const currency = String(rule.currency || '').trim().toUpperCase();
      const estimatedMicros = Math.trunc(Number(rule.estimatedMicros));
      if (
        !LOGICAL_MODEL_KEYS.includes(logicalModelKey)
        || !/^[A-Z]{3,8}$/.test(currency)
        || estimatedMicros < 0
        || (resolutionTier && !['1K', '2K', '4K', 'CUSTOM'].includes(resolutionTier))
      ) {
        throw new Error('成本规则无效');
      }
      return {
        logicalModelKey,
        ...(remoteModel ? { remoteModel } : {}),
        ...(resolutionTier ? { resolutionTier } : {}),
        currency,
        estimatedMicros,
      };
    });
  }
  return result;
}

export function encryptedKeyFields(apiKey: unknown, adapterType: AiProviderAdapterType = 'grs') {
  const manifest = getProviderAdapterManifest(adapterType);
  const apiKeyField = manifest.credentialFields.find((field) => field.key === 'apiKey');
  const value = String(apiKey || '').trim();
  if (apiKeyField?.required && !value) throw new Error(`${apiKeyField.label} 不能为空`);
  const encrypted = encryptText(value);
  const masked = maskSecret(value);
  return {
    apiKeyEncrypted: encrypted,
    apiKeyMasked: masked,
    credentialsEncrypted: { apiKey: encrypted },
    credentialsMasked: { apiKey: masked },
  };
}

export async function findProviderWithKey(id: string) {
  const provider = await AiProviderConfig.findById(id).select('+apiKeyEncrypted +credentialsEncrypted');
  if (!provider) throw new Error('AI 供应商配置不存在');
  return provider;
}
