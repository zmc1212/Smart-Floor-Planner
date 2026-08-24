import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { decryptText, encryptText, maskSecret } from '@/lib/crypto';
export { SMS_COPY } from '@/lib/sms-copy';

export const SMS_PROVIDERS = ['aliyun', 'tencent'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

type StoredProvider = {
  accessKeyIdEncrypted?: string;
  accessKeyIdMasked?: string;
  secretKeyEncrypted?: string;
  secretKeyMasked?: string;
  secretIdEncrypted?: string;
  secretIdMasked?: string;
  signName?: string;
  templateCode?: string;
  sdkAppId?: string;
  region?: string;
};

type StoredSmsConfig = {
  version?: number;
  enabled?: boolean;
  activeProvider?: SmsProvider;
  providers?: Partial<Record<SmsProvider, StoredProvider>>;
};

export type SmsConfigInput = {
  enabled?: unknown;
  activeProvider?: unknown;
  providers?: Partial<Record<SmsProvider, {
    accessKeyId?: unknown;
    secretKey?: unknown;
    secretId?: unknown;
    signName?: unknown;
    templateCode?: unknown;
    sdkAppId?: unknown;
    region?: unknown;
  }>>;
};

export type SmsProviderDto = {
  signName: string;
  templateCode: string;
  region: string;
  sdkAppId?: string;
  accessKeyIdMasked?: string;
  secretKeyMasked?: string;
  secretIdMasked?: string;
  hasAccessKeyId: boolean;
  hasSecretKey: boolean;
  hasSecretId: boolean;
};

export type SmsConfigDto = {
  version: 1;
  enabled: boolean;
  activeProvider: SmsProvider;
  providers: Record<SmsProvider, SmsProviderDto>;
  ready: boolean;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function providerDto(value: StoredProvider | undefined, provider: SmsProvider): SmsProviderDto {
  const item = value || {};
  return {
    signName: text(item.signName),
    templateCode: text(item.templateCode),
    region: text(item.region) || (provider === 'aliyun' ? 'cn-hangzhou' : 'ap-guangzhou'),
    ...(provider === 'tencent' ? { sdkAppId: text(item.sdkAppId) } : {}),
    ...(item.accessKeyIdMasked ? { accessKeyIdMasked: item.accessKeyIdMasked } : {}),
    ...(item.secretKeyMasked ? { secretKeyMasked: item.secretKeyMasked } : {}),
    ...(item.secretIdMasked ? { secretIdMasked: item.secretIdMasked } : {}),
    hasAccessKeyId: Boolean(item.accessKeyIdEncrypted),
    hasSecretKey: Boolean(item.secretKeyEncrypted),
    hasSecretId: Boolean(item.secretIdEncrypted),
  };
}

function isProviderReady(provider: SmsProvider, value: StoredProvider | undefined) {
  const item = providerDto(value, provider);
  return Boolean(
    item.signName && item.templateCode &&
    (provider === 'aliyun'
      ? item.hasAccessKeyId && item.hasSecretKey
      : item.sdkAppId && item.hasSecretId && item.hasSecretKey)
  );
}

function normalizeStored(input?: StoredSmsConfig | null): StoredSmsConfig {
  return {
    version: 1,
    enabled: Boolean(input?.enabled),
    activeProvider: input?.activeProvider === 'tencent' ? 'tencent' : 'aliyun',
    providers: {
      aliyun: input?.providers?.aliyun || {},
      tencent: input?.providers?.tencent || {},
    },
  };
}

export async function getSmsConfig(): Promise<SmsConfigDto> {
  return withPlatformTransaction(async (transaction) => {
    const record = await new PlatformConfigRepository(transaction).findByKey('default');
    const config = normalizeStored(record?.smsConfig as StoredSmsConfig | undefined);
    const active = config.activeProvider || 'aliyun';
    return {
      version: 1,
      enabled: Boolean(config.enabled),
      activeProvider: active,
      providers: {
        aliyun: providerDto(config.providers?.aliyun, 'aliyun'),
        tencent: providerDto(config.providers?.tencent, 'tencent'),
      },
      ready: isProviderReady(active, config.providers?.[active]),
    };
  });
}

async function getStoredSmsConfig() {
  return withPlatformTransaction(async (transaction) => {
    const record = await new PlatformConfigRepository(transaction).findByKey('default');
    return normalizeStored(record?.smsConfig as StoredSmsConfig | undefined);
  });
}

export async function saveSmsConfig(input: SmsConfigInput) {
  const current = await getStoredSmsConfig();
  const next = normalizeStored(current);
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (input.activeProvider === 'aliyun' || input.activeProvider === 'tencent') {
    next.activeProvider = input.activeProvider;
  }
  for (const provider of SMS_PROVIDERS) {
    const patch = input.providers?.[provider];
    if (!patch) continue;
    const existing = next.providers?.[provider] || {};
    const providerNext: StoredProvider = { ...existing };
    const signName = text(patch.signName);
    const templateCode = text(patch.templateCode);
    const region = text(patch.region);
    if (signName) providerNext.signName = signName;
    if (templateCode) providerNext.templateCode = templateCode;
    if (region) providerNext.region = region;
    if (provider === 'tencent') {
      const sdkAppId = text(patch.sdkAppId);
      if (sdkAppId) providerNext.sdkAppId = sdkAppId;
      const secretId = text(patch.secretId);
      const secretKey = text(patch.secretKey);
      if (secretId) {
        providerNext.secretIdEncrypted = encryptText(secretId);
        providerNext.secretIdMasked = maskSecret(secretId);
      }
      if (secretKey) {
        providerNext.secretKeyEncrypted = encryptText(secretKey);
        providerNext.secretKeyMasked = maskSecret(secretKey);
      }
    } else {
      const accessKeyId = text(patch.accessKeyId);
      const secretKey = text(patch.secretKey);
      if (accessKeyId) {
        providerNext.accessKeyIdEncrypted = encryptText(accessKeyId);
        providerNext.accessKeyIdMasked = maskSecret(accessKeyId);
      }
      if (secretKey) {
        providerNext.secretKeyEncrypted = encryptText(secretKey);
        providerNext.secretKeyMasked = maskSecret(secretKey);
      }
    }
    next.providers = { ...next.providers, [provider]: providerNext };
  }
  const active = next.activeProvider || 'aliyun';
  if (next.enabled && !isProviderReady(active, next.providers?.[active])) {
    throw new Error('启用短信前请完整配置当前供应商');
  }
  await withPlatformTransaction((transaction) =>
    new PlatformConfigRepository(transaction).upsert('default', { smsConfig: next })
  );
  return getSmsConfig();
}

export async function getSmsProviderRuntimeConfig(provider: SmsProvider) {
  const stored = await getStoredSmsConfig();
  const item = stored.providers?.[provider] || {};
  if (!stored.enabled) return { enabled: false as const, provider, config: null };
  if (!isProviderReady(provider, item)) {
    return { enabled: true as const, provider, config: null };
  }
  if (provider === 'aliyun') {
    return {
      enabled: true as const,
      provider,
      config: {
        accessKeyId: decryptText(item.accessKeyIdEncrypted),
        secretKey: decryptText(item.secretKeyEncrypted),
        signName: text(item.signName),
        templateCode: text(item.templateCode),
        region: text(item.region) || 'cn-hangzhou',
      },
    };
  }
  return {
    enabled: true as const,
    provider,
    config: {
      secretId: decryptText(item.secretIdEncrypted),
      secretKey: decryptText(item.secretKeyEncrypted),
      sdkAppId: text(item.sdkAppId),
      signName: text(item.signName),
      templateCode: text(item.templateCode),
      region: text(item.region) || 'ap-guangzhou',
    },
  };
}

export async function getSmsRuntimeConfig() {
  const stored = await getStoredSmsConfig();
  return getSmsProviderRuntimeConfig(stored.activeProvider || 'aliyun');
}
