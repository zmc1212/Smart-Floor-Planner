import { AI_CAPABILITIES, type AiCapability, type AiProviderAdapterType } from './provider-types';

export type ProviderCredentialField = {
  key: string;
  label: string;
  placeholder?: string;
  required: boolean;
};

export type ProviderAdapterConfigField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'switch' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type ProviderAdapterManifest = {
  type: AiProviderAdapterType;
  label: string;
  description: string;
  defaultBaseUrl: string;
  baseUrlPlaceholder: string;
  defaultCapabilities: AiCapability[];
  credentialFields: ProviderCredentialField[];
  configFields: ProviderAdapterConfigField[];
  supportsModelDiscovery: boolean;
  supportsBalanceLookup: boolean;
};

const API_KEY_CREDENTIAL: ProviderCredentialField = {
  key: 'apiKey',
  label: 'API Key',
  required: true,
};

const ALL_CAPABILITIES = [...AI_CAPABILITIES];

export const AI_PROVIDER_ADAPTER_MANIFESTS: Record<AiProviderAdapterType, ProviderAdapterManifest> = {
  grs: {
    type: 'grs',
    label: 'GRS',
    description: '支持连通测试、模型同步和上游余额查询。',
    defaultBaseUrl: 'https://grsai.dakka.com.cn',
    baseUrlPlaceholder: 'https://grsai.dakka.com.cn',
    defaultCapabilities: ALL_CAPABILITIES,
    credentialFields: [API_KEY_CREDENTIAL],
    configFields: [],
    supportsModelDiscovery: true,
    supportsBalanceLookup: true,
  },
  pollinations: {
    type: 'pollinations',
    label: 'Pollinations',
    description: '使用统一的文本、视觉和生图适配协议。',
    defaultBaseUrl: 'https://gen.pollinations.ai',
    baseUrlPlaceholder: 'https://gen.pollinations.ai',
    defaultCapabilities: ALL_CAPABILITIES,
    credentialFields: [API_KEY_CREDENTIAL],
    configFields: [],
    supportsModelDiscovery: true,
    supportsBalanceLookup: false,
  },
  openai_compatible: {
    type: 'openai_compatible',
    label: 'OpenAI Compatible',
    description: '适用于兼容 OpenAI API 协议的供应商；模型参数由后端适配器转换。',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    defaultCapabilities: ALL_CAPABILITIES,
    credentialFields: [API_KEY_CREDENTIAL],
    configFields: [],
    supportsModelDiscovery: true,
    supportsBalanceLookup: false,
  },
};

export function getProviderAdapterManifest(type: AiProviderAdapterType) {
  return AI_PROVIDER_ADAPTER_MANIFESTS[type];
}

export function validateProviderAdapterConfig(type: AiProviderAdapterType, value: unknown) {
  const manifest = getProviderAdapterManifest(type);
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result: Record<string, string | number | boolean> = {};
  const permittedKeys = new Set(manifest.configFields.map((field) => field.key));

  for (const key of Object.keys(raw)) {
    if (!permittedKeys.has(key)) throw new Error(`适配器 ${manifest.label} 不支持配置项 ${key}`);
  }

  for (const field of manifest.configFields) {
    const valueForField = raw[field.key];
    if (valueForField === undefined || valueForField === null || valueForField === '') {
      if (field.required) throw new Error(`${field.label} 不能为空`);
      continue;
    }
    if (field.type === 'number') {
      const numberValue = Number(valueForField);
      if (!Number.isFinite(numberValue)) throw new Error(`${field.label} 必须是数字`);
      result[field.key] = numberValue;
    } else if (field.type === 'switch') {
      result[field.key] = Boolean(valueForField);
    } else {
      const stringValue = String(valueForField).trim();
      if (!stringValue) throw new Error(`${field.label} 不能为空`);
      if (field.type === 'select' && !field.options?.some((option) => option.value === stringValue)) {
        throw new Error(`${field.label} 选项无效`);
      }
      result[field.key] = stringValue;
    }
  }

  return result;
}
