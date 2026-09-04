import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import {
  AiProviderConfigRepository,
  type AiProviderConfigRecord,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  isPlatformLlmOverrideProvider,
  normalizeModelMappings,
  toStoredModelMappings,
  type AiCapability,
  type AiLogicalModelKey,
  type AiProviderAdapter,
  type AiProviderAdapterType,
  type AiProviderRuntimeConfig,
} from './provider-types';
import { grsAdapter } from './providers/grs';
import { apiNebulaAdapter } from './providers/apinebula';
import { openAiCompatibleAdapter } from './providers/openai-compatible';
import { pollinationsAdapter } from './providers/pollinations';
import { httpError } from '@/lib/http-error';

function decryptProviderApiKey(
  config: Pick<AiProviderConfigRecord, 'credentialsEncrypted' | 'apiKeyEncrypted'>
) {
  const apiKey = config.credentialsEncrypted?.apiKey;
  return decryptText(typeof apiKey === 'string' ? apiKey : config.apiKeyEncrypted);
}

function toProviderRuntime(config: AiProviderConfigRecord): AiProviderRuntimeConfig {
  return {
    id: String(config.id),
    key: config.key,
    name: config.name,
    adapterType: config.adapterType as AiProviderAdapterType,
    baseUrl: config.baseUrl,
    apiKey: decryptProviderApiKey(config),
    adapterConfig: config.adapterConfig as AiProviderRuntimeConfig['adapterConfig'],
    capabilities: config.capabilities as AiCapability[],
    modelMappings: normalizeModelMappings(config.modelMappings),
    timeoutMs: config.timeoutMs,
    costRules: config.costRules as AiProviderRuntimeConfig['costRules'],
  };
}

const adapters = new Map<string, AiProviderAdapter>([
  ['grs', grsAdapter],
  ['apinebula', apiNebulaAdapter],
  ['pollinations', pollinationsAdapter],
  ['openai_compatible', openAiCompatibleAdapter],
]);

export function getAiProviderAdapter(type: string) {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Unsupported AI provider adapter: ${type}`);
  return adapter;
}

export async function ensureEnvironmentAiProviders() {
  const defaults = [
    {
      key: 'grs-primary',
      name: 'GRS AI',
      adapterType: 'grs',
      baseUrl: process.env.GRS_BASE_URL || 'https://grsai.dakka.com.cn',
      apiKey: process.env.GRS_API_KEY?.trim(),
      priority: 10,
      capabilities: ['chat', 'vision', 'image.generate', 'image.edit'],
      modelMappings: {
        'chat.general': process.env.GRS_CHAT_MODEL || 'gemini-3.1-pro',
        'vision.reference_analysis': process.env.GRS_VISION_MODEL || 'gemini-3.1-pro',
        'image.generate.standard': process.env.GRS_IMAGE_MODEL || 'gpt-image-2',
        'image.edit.standard': process.env.GRS_IMAGE_MODEL || 'gpt-image-2',
      },
    },
    {
      key: 'apinebula-fallback',
      name: 'API Nebula',
      adapterType: 'apinebula',
      baseUrl: process.env.APINEBULA_BASE_URL || 'https://apinebula.ai',
      apiKey: process.env.APINEBULA_API_KEY?.trim(),
      priority: 20,
      capabilities: ['image.generate', 'image.edit'],
      modelMappings: {
        'chat.general': '',
        'vision.reference_analysis': '',
        'image.generate.standard': process.env.APINEBULA_IMAGE_MODEL || 'gpt-image-2',
        'image.edit.standard': process.env.APINEBULA_IMAGE_MODEL || 'gpt-image-2',
      },
    },
    {
      key: 'pollinations-fallback',
      name: 'Pollinations',
      adapterType: 'pollinations',
      baseUrl: process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai',
      apiKey: process.env.POLLINATIONS_API_KEY?.trim(),
      priority: 100,
      capabilities: ['chat', 'vision', 'image.generate', 'image.edit'],
      modelMappings: {
        'chat.general': process.env.POLLINATIONS_CHAT_MODEL || 'openai',
        'vision.reference_analysis': process.env.POLLINATIONS_VISION_MODEL || 'openai',
        'image.generate.standard': process.env.POLLINATIONS_IMAGE_MODEL || 'flux',
        'image.edit.standard': process.env.POLLINATIONS_IMAGE_MODEL || 'flux',
      },
    },
  ] as const;

  await Promise.all(
    defaults.filter((item) => item.apiKey).map((item) =>
      withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).initializeFromEnvironment({
          key: item.key,
            name: item.name,
            adapterType: item.adapterType,
            baseUrl: item.baseUrl,
            apiKeyEncrypted: encryptText(item.apiKey || ''),
            apiKeyMasked: maskSecret(item.apiKey),
            credentialsEncrypted: { apiKey: encryptText(item.apiKey || '') },
            credentialsMasked: { apiKey: maskSecret(item.apiKey) },
            capabilities: [...item.capabilities],
            modelMappings: toStoredModelMappings(item.modelMappings),
            priority: item.priority,
            timeoutMs: 90000,
            enabled: true,
            costRules: [],
          })
      )
    )
  );
}

export async function listProviderRuntimes(capability: AiCapability, logicalModelKey: AiLogicalModelKey) {
  await ensureEnvironmentAiProviders();
  const configs = await withPlatformTransaction((transaction) =>
    new AiProviderConfigRepository(transaction).listEnabled({ capability })
  );

  return configs
    .filter((config) => !isPlatformLlmOverrideProvider(config.key))
    .filter((config) => Boolean(normalizeModelMappings(config.modelMappings)[logicalModelKey]))
    .sort((left, right) => {
      const leftFallback = left.key.endsWith('-fallback');
      const rightFallback = right.key.endsWith('-fallback');
      if (leftFallback !== rightFallback) return leftFallback ? 1 : -1;
      return left.priority - right.priority || left.createdAt.getTime() - right.createdAt.getTime();
    })
    .map(toProviderRuntime);
}

export async function listProviderRuntimesByAdapter(capability: AiCapability, adapterType: string) {
  await ensureEnvironmentAiProviders();
  const configs = await withPlatformTransaction((transaction) =>
    new AiProviderConfigRepository(transaction).listEnabled({
      capability,
      adapterType,
    })
  );

  return configs
    .filter((config) => !isPlatformLlmOverrideProvider(config.key))
    .map(toProviderRuntime);
}

export async function getProviderRuntimeById(id: string) {
  const config = await withPlatformTransaction((transaction) =>
    new AiProviderConfigRepository(transaction).findById(BigInt(id))
  );
  if (!config || isPlatformLlmOverrideProvider(config.key)) {
    throw httpError('AI 供应商配置不存在', 404);
  }
  return toProviderRuntime(config);
}
