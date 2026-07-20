import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
import { AiProviderConfig } from '@/models/AiProviderConfig';
import { normalizeModelMappings, toStoredModelMappings, type AiCapability, type AiLogicalModelKey, type AiProviderAdapter, type AiProviderRuntimeConfig } from './provider-types';
import { grsAdapter } from './providers/grs';
import { openAiCompatibleAdapter } from './providers/openai-compatible';
import { pollinationsAdapter } from './providers/pollinations';

const adapters = new Map<string, AiProviderAdapter>([
  ['grs', grsAdapter],
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
      AiProviderConfig.updateOne(
        { key: item.key },
        {
          $setOnInsert: {
            name: item.name,
            adapterType: item.adapterType,
            baseUrl: item.baseUrl,
            apiKeyEncrypted: encryptText(item.apiKey || ''),
            apiKeyMasked: maskSecret(item.apiKey),
            capabilities: item.capabilities,
            modelMappings: toStoredModelMappings(item.modelMappings),
            priority: item.priority,
            timeoutMs: 90000,
            enabled: true,
            costRules: [],
          },
        },
        { upsert: true }
      )
    )
  );
}

export async function listProviderRuntimes(capability: AiCapability, logicalModelKey: AiLogicalModelKey) {
  await ensureEnvironmentAiProviders();
  const configs = await AiProviderConfig.find({
    enabled: true,
    capabilities: capability,
  })
    .select('+apiKeyEncrypted')
    .sort({ priority: 1, createdAt: 1 });

  return configs.map((config): AiProviderRuntimeConfig => ({
    id: String(config._id),
    key: config.key,
    name: config.name,
    adapterType: config.adapterType,
    baseUrl: config.baseUrl,
    apiKey: decryptText(config.apiKeyEncrypted),
    capabilities: config.capabilities,
    modelMappings: normalizeModelMappings(config.modelMappings),
    timeoutMs: config.timeoutMs,
    costRules: config.costRules,
  })).filter((runtime) => Boolean(runtime.modelMappings[logicalModelKey]));
}

export async function getProviderRuntimeById(id: string) {
  const config = await AiProviderConfig.findById(id).select('+apiKeyEncrypted');
  if (!config) throw new Error('AI 供应商配置不存在');
  return {
    id: String(config._id),
    key: config.key,
    name: config.name,
    adapterType: config.adapterType,
    baseUrl: config.baseUrl,
    apiKey: decryptText(config.apiKeyEncrypted),
    capabilities: config.capabilities,
    modelMappings: normalizeModelMappings(config.modelMappings),
    timeoutMs: config.timeoutMs,
    costRules: config.costRules,
  } satisfies AiProviderRuntimeConfig;
}
