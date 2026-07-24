import { decryptMediaStorageSecret } from '@/lib/crypto';
import { MediaStorageConfig } from '@/models/MediaStorageConfig';
import { PlatformConfig } from '@/models/PlatformConfig';
import { LocalMediaStorageProvider } from './local-provider';
import { QiniuMediaStorageProvider, type QiniuRegion } from './qiniu-provider';
import type { MediaStorageProvider } from './types';

const PROVIDER_CACHE_TTL_MS = 60_000;

type CachedProvider = {
  expiresAt: number;
  provider: MediaStorageProvider;
};

let activeProviderKeyCache: { expiresAt: number; key: string } | null = null;
const providerCache = new Map<string, CachedProvider>();

export type MediaStorageProviderFactory = () => MediaStorageProvider;

export class MediaStorageRegistry {
  private readonly factories = new Map<string, MediaStorageProviderFactory>();

  register(key: string, factory: MediaStorageProviderFactory) {
    const normalizedKey = normalizeMediaStorageProviderKey(key);
    if (this.factories.has(normalizedKey)) {
      throw new Error(`Media storage provider is already registered: ${normalizedKey}`);
    }
    this.factories.set(normalizedKey, factory);
  }

  resolve(key?: string | null) {
    const normalizedKey = normalizeMediaStorageProviderKey(key);
    const factory = this.factories.get(normalizedKey);
    if (!factory) throw new Error(`Unsupported media storage provider: ${normalizedKey}`);
    const provider = factory();
    if (normalizeMediaStorageProviderKey(provider.key) !== normalizedKey) {
      throw new Error(`Media storage provider factory returned mismatched key: ${provider.key}`);
    }
    return provider;
  }
}

export function normalizeMediaStorageProviderKey(value?: string | null) {
  return String(value || '').trim().toLowerCase() || 'local';
}

export function invalidateMediaStorageProviderCache(key?: string | null) {
  if (key) providerCache.delete(normalizeMediaStorageProviderKey(key));
  else providerCache.clear();
}

export function invalidateActiveMediaStorageCache() {
  activeProviderKeyCache = null;
}

export async function getMediaStorageProvider(key?: string | null): Promise<MediaStorageProvider> {
  const normalizedKey = normalizeMediaStorageProviderKey(key);
  if (normalizedKey === 'local') return new LocalMediaStorageProvider();

  const cached = providerCache.get(normalizedKey);
  if (cached && cached.expiresAt > Date.now()) return cached.provider;

  const config = await MediaStorageConfig.findOne({ key: normalizedKey })
    .select('+accessKeyEncrypted +secretKeyEncrypted')
    .lean();
  if (!config) {
    throw new Error(`不支持的媒体存储配置：${normalizedKey}`);
  }
  if (config.driver !== 'qiniu') {
    throw new Error(`不支持的媒体存储驱动：${config.driver}`);
  }

  const provider = new QiniuMediaStorageProvider({
    key: config.key,
    accessKey: decryptMediaStorageSecret(config.accessKeyEncrypted),
    secretKey: decryptMediaStorageSecret(config.secretKeyEncrypted),
    bucket: config.bucket,
    region: config.region as QiniuRegion,
    domain: config.domain,
    objectPrefix: config.objectPrefix || '',
  });
  providerCache.set(normalizedKey, {
    provider,
    expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS,
  });
  return provider;
}

async function getActiveProviderKey() {
  if (activeProviderKeyCache && activeProviderKeyCache.expiresAt > Date.now()) {
    return activeProviderKeyCache.key;
  }
  const platformConfig = await PlatformConfig.findOne({ key: 'default' })
    .select('mediaStorage.activeProviderKey')
    .lean();
  const key = normalizeMediaStorageProviderKey(
    platformConfig?.mediaStorage?.activeProviderKey || process.env.MEDIA_STORAGE_PROVIDER || 'local'
  );
  activeProviderKeyCache = { key, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
  return key;
}

export async function getDefaultMediaStorageProvider(): Promise<MediaStorageProvider> {
  const key = await getActiveProviderKey();
  if (key !== 'local') {
    const config = await MediaStorageConfig.findOne({ key }).select('status').lean();
    if (!config) throw new Error(`默认媒体存储配置不存在：${key}`);
    if (config.status !== 'active') throw new Error(`默认媒体存储配置已归档：${key}`);
  }
  return getMediaStorageProvider(key);
}
