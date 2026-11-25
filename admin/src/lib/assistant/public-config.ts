import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction, type PostgresTransaction } from '@/db/transaction';

import {
  DEFAULT_PUBLIC_ASSISTANT_CONFIG,
  type PublicAssistantConfig,
  type PublicAssistantPrompt,
  type PublicXiaokConfig,
} from './public-config-values';

export { DEFAULT_PUBLIC_ASSISTANT_CONFIG, type PublicXiaokConfig } from './public-config-values';

type StoredPublicAssistantConfig = {
  enabled?: unknown;
  opening?: unknown;
  prompts?: unknown;
  version?: unknown;
};

type StoredAiPromptConfig = Record<string, unknown> & {
  publicAssistant?: unknown;
};

function text(value: unknown, fallback: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().slice(0, max);
}

function normalizePrompt(value: unknown): PublicAssistantPrompt | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const title = text(item.title, '', 12);
  const prompt = text(item.text, '', 80);
  return title && prompt ? { title, text: prompt } : null;
}

export function normalizePublicAssistantConfig(
  input?: StoredPublicAssistantConfig | null,
): PublicAssistantConfig {
  const prompts = Array.isArray(input?.prompts)
    ? input.prompts.map(normalizePrompt).filter((item): item is PublicAssistantPrompt => Boolean(item)).slice(0, 3)
    : [];
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : DEFAULT_PUBLIC_ASSISTANT_CONFIG.enabled,
    opening: text(input?.opening, DEFAULT_PUBLIC_ASSISTANT_CONFIG.opening, 600),
    prompts: prompts.length ? prompts : DEFAULT_PUBLIC_ASSISTANT_CONFIG.prompts,
    version: Number.isInteger(input?.version) && Number(input?.version) > 0
      ? Number(input?.version)
      : DEFAULT_PUBLIC_ASSISTANT_CONFIG.version,
  };
}

function readStoredPublicAssistant(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  return (value as StoredAiPromptConfig).publicAssistant as StoredPublicAssistantConfig | undefined;
}

async function readStoredConfig(transaction: PostgresTransaction) {
    const row = await new PlatformConfigRepository(transaction).findByKey('default');
    const raw = row?.aiPromptConfig as StoredAiPromptConfig | undefined;
    return normalizePublicAssistantConfig(readStoredPublicAssistant(raw));
}

export async function readPublicXiaokConfig(transaction?: PostgresTransaction): Promise<PublicXiaokConfig> {
  const config = transaction
    ? await readStoredConfig(transaction)
    : await withPlatformTransaction(readStoredConfig);
  return {
    enabled: config.enabled,
    guidanceOpening: config.opening,
    publicTopics: config.prompts,
    version: config.version,
  };
}

export async function getPublicAssistantConfig() {
  return withPlatformTransaction(readStoredConfig);
}

export type PublicAssistantConfigInput = {
  enabled?: unknown;
  opening?: unknown;
  prompts?: unknown;
  expectedVersion?: unknown;
};

function invalid(message: string, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function validatePublicAssistantInput(input: PublicAssistantConfigInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['enabled', 'opening', 'prompts', 'expectedVersion'].includes(key))) {
    invalid('通用小K配置字段无效');
  }
  if (typeof input.enabled !== 'boolean') invalid('enabled 必须是布尔值');
  if (typeof input.opening !== 'string' || !input.opening.trim() || input.opening.trim().length > 600) {
    invalid('开场白不能为空且不能超过 600 个字符');
  }
  if (!Array.isArray(input.prompts) || input.prompts.length < 1 || input.prompts.length > 3) {
    invalid('猜你想问必须配置 1 至 3 个问题');
  }
  const titles = new Set<string>();
  const prompts = input.prompts as unknown[];
  prompts.forEach((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`第 ${index + 1} 个问题格式无效`);
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['title', 'text'].includes(key))) invalid(`第 ${index + 1} 个问题字段无效`);
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 12) invalid(`第 ${index + 1} 个问题标题无效`);
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.trim().length > 80) invalid(`第 ${index + 1} 个问题内容无效`);
    const title = (item.title as string).trim();
    if (titles.has(title)) invalid('猜你想问的标题不能重复');
    titles.add(title);
  });
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) invalid('expectedVersion 无效');
}

export async function savePublicAssistantConfig(input: PublicAssistantConfigInput) {
  validatePublicAssistantInput(input);
  const next: PublicAssistantConfig = {
    enabled: input.enabled as boolean,
    opening: (input.opening as string).trim(),
    prompts: (input.prompts as PublicAssistantPrompt[]).map((item) => ({ title: item.title.trim(), text: item.text.trim() })),
    version: 1,
  };

  return withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const row = await repository.ensureForUpdate('default');
    const stored = row?.aiPromptConfig as StoredAiPromptConfig | undefined;
    const current = normalizePublicAssistantConfig(readStoredPublicAssistant(stored));
    if (Number(input.expectedVersion) !== current.version) invalid('配置版本已变化，请重新读取后再保存', 409);

    const saved: PublicAssistantConfig = { ...next, version: current.version + 1 };
    await repository.update('default', {
      aiPromptConfig: { ...(stored || {}), publicAssistant: saved },
    });
    return saved;
  });
}

export function publicAssistantConfigDto(config: PublicAssistantConfig) {
  return {
    enabled: config.enabled,
    opening: config.opening,
    prompts: config.prompts,
    version: config.version,
  };
}
