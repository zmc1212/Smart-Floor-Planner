export const CAPABILITIES = ['chat', 'vision', 'image.generate', 'image.edit'] as const;
export const MODEL_KEYS = ['chat.general', 'vision.reference_analysis', 'image.generate.standard', 'image.edit.standard'] as const;
export const RESOLUTION_TIERS = ['1K', '2K', '4K', 'CUSTOM'] as const;

export type CostRule = {
  logicalModelKey: string;
  remoteModel?: string;
  resolutionTier?: string;
  currency: string;
  estimatedMicros: number;
};

export type Provider = {
  id: string;
  key: string;
  name: string;
  adapterType: 'grs' | 'apinebula' | 'pollinations' | 'openai_compatible';
  baseUrl: string;
  apiKeyMasked: string;
  credentialsMasked: Record<string, string>;
  adapterConfig: Record<string, string | number | boolean>;
  capabilities: string[];
  modelMappings: Record<string, string>;
  priority: number;
  timeoutMs: number;
  enabled: boolean;
  costRules: CostRule[];
  discoveredModels: string[];
  lastTestOk?: boolean;
  lastUpstreamBalance?: number | null;
  lastUpstreamBalanceUnit?: string;
  lastUpstreamBalanceAt?: string | null;
  lastUpstreamBalanceMessage?: string;
};

export type ProviderFormState = Omit<Provider, 'id' | 'apiKeyMasked' | 'credentialsMasked' | 'discoveredModels' | 'lastTestOk' | 'costRules' | 'lastUpstreamBalance' | 'lastUpstreamBalanceUnit' | 'lastUpstreamBalanceAt' | 'lastUpstreamBalanceMessage'> & {
  id?: string;
  apiKey: string;
  costs: Array<Omit<CostRule, 'estimatedMicros'> & { estimatedMicros: string }>;
};

export type ImageModel = {
  id: string;
  key: string;
  name: string;
  remoteModel: string;
  family: string;
  catalogVersion: string;
  maxReferenceImages: number;
  aspectRatios: string[];
  resolutionTiers: string[];
  supportsCustomSize: boolean;
  enabled: boolean;
  isDefault: boolean;
  executable: boolean;
};

export function defaultCosts() {
  return MODEL_KEYS.map((logicalModelKey) => ({
    logicalModelKey,
    currency: 'CNY',
    estimatedMicros: '0',
  }));
}

export function emptyProviderForm(): ProviderFormState {
  return {
    key: '',
    name: '',
    adapterType: 'grs',
    baseUrl: 'https://grsai.dakka.com.cn',
    apiKey: '',
    adapterConfig: {},
    capabilities: [...CAPABILITIES],
    modelMappings: {
      'chat.general': 'gemini-3.1-pro',
      'vision.reference_analysis': 'gemini-3.1-pro',
      'image.generate.standard': 'gpt-image-2',
      'image.edit.standard': 'gpt-image-2',
    },
    priority: 100,
    timeoutMs: 90000,
    enabled: true,
    costs: defaultCosts(),
  };
}

export function providerToForm(provider: Provider): ProviderFormState {
  const costs = (provider.costRules.length ? provider.costRules : defaultCosts()).map((rule) => ({
    ...rule,
    estimatedMicros: String(rule.estimatedMicros),
  }));
  return { ...provider, id: provider.id, apiKey: '', costs };
}
