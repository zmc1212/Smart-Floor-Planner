import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  decryptMediaStorageSecret,
  encryptMediaStorageSecret,
  isMediaStorageEncryptionReady,
  maskSecret,
} from '@/lib/crypto';
import { MediaAsset } from '@/models/MediaAsset';
import { MediaStorageConfig, type IMediaStorageConfig } from '@/models/MediaStorageConfig';
import { PlatformConfig } from '@/models/PlatformConfig';
import {
  getMediaStorageProvider,
  invalidateActiveMediaStorageCache,
  invalidateMediaStorageProviderCache,
  normalizeMediaStorageProviderKey,
} from './registry';
import { QINIU_REGIONS, type QiniuRegion } from './qiniu-provider';

const PROVIDER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const TEST_CHANGED_MESSAGE = '配置已变更，请重新测试';

export type MediaStorageConfigPayload = {
  key?: string;
  name?: string;
  driver?: string;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  region?: string;
  domain?: string;
  objectPrefix?: string;
};

export type MediaStorageAssetStats = {
  activeCount: number;
  activeBytes: number;
  pendingPurgeCount: number;
  pendingPurgeBytes: number;
  totalCount: number;
  totalBytes: number;
};

function requiredText(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function normalizedDomain(value: unknown) {
  const text = requiredText(value, 'HTTPS 下载域名');
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('HTTPS 下载域名格式不正确');
  }
  if (parsed.protocol !== 'https:') throw new Error('下载域名必须使用 HTTPS');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('下载域名不能包含凭证、查询参数或锚点');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('下载域名只能填写域名根地址');
  }
  return parsed.origin;
}

function normalizedRegion(value: unknown) {
  const region = requiredText(value, '区域') as QiniuRegion;
  if (!QINIU_REGIONS.includes(region)) throw new Error('不支持的七牛云区域');
  return region;
}

export function normalizeMediaStorageObjectPrefix(value: unknown) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const segments = raw.replace(/^\/+|\/+$/g, '').split('/');
  if (!segments.length || segments.some((segment) => (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(segment)
    || segment === '.'
    || segment === '..'
  ))) {
    throw new Error('存储前缀只能包含字母、数字、点、下划线、连字符和斜杠，且不能包含相对路径');
  }
  return `${segments.join('/')}/`;
}

function normalizedProviderKey(value: unknown) {
  const key = normalizeMediaStorageProviderKey(String(value || ''));
  if (key === 'local') throw new Error('local 为系统保留配置标识');
  if (!PROVIDER_KEY_RE.test(key)) {
    throw new Error('配置标识必须为 2-50 位小写字母、数字或连字符，且首尾不能为连字符');
  }
  return key;
}

function secretFields(accessKey: string, secretKey: string) {
  if (!isMediaStorageEncryptionReady()) {
    throw new Error('生产环境必须配置 MEDIA_STORAGE_KEY_ENCRYPTION_SECRET');
  }
  return {
    accessKeyEncrypted: encryptMediaStorageSecret(accessKey),
    accessKeyMasked: maskSecret(accessKey),
    secretKeyEncrypted: encryptMediaStorageSecret(secretKey),
    secretKeyMasked: maskSecret(secretKey),
  };
}

export function validateNewMediaStorageConfigPayload(payload: MediaStorageConfigPayload) {
  if (payload.driver && payload.driver !== 'qiniu') throw new Error('首期仅支持七牛云 qiniu 驱动');
  return {
    key: normalizedProviderKey(payload.key),
    name: requiredText(payload.name, '名称'),
    driver: 'qiniu' as const,
    accessKey: requiredText(payload.accessKey, 'AccessKey'),
    secretKey: requiredText(payload.secretKey, 'SecretKey'),
    bucket: requiredText(payload.bucket, 'Bucket'),
    region: normalizedRegion(payload.region),
    domain: normalizedDomain(payload.domain),
    objectPrefix: normalizeMediaStorageObjectPrefix(payload.objectPrefix),
  };
}

export function hasCriticalMediaStorageConfigChange(
  current: Pick<IMediaStorageConfig, 'bucket' | 'region' | 'domain' | 'objectPrefix'>,
  payload: MediaStorageConfigPayload
) {
  const nextBucket = payload.bucket === undefined ? current.bucket : requiredText(payload.bucket, 'Bucket');
  const nextRegion = payload.region === undefined ? current.region : normalizedRegion(payload.region);
  const nextDomain = payload.domain === undefined ? current.domain : normalizedDomain(payload.domain);
  const nextObjectPrefix = payload.objectPrefix === undefined
    ? current.objectPrefix
    : normalizeMediaStorageObjectPrefix(payload.objectPrefix);
  return nextBucket !== current.bucket
    || nextRegion !== current.region
    || nextDomain !== current.domain
    || nextObjectPrefix !== current.objectPrefix
    || Boolean(String(payload.accessKey || '').trim())
    || Boolean(String(payload.secretKey || '').trim());
}

export function assertMediaStorageConfigCanActivate(
  config: Pick<IMediaStorageConfig, 'status' | 'lastTestOk'>
) {
  if (config.status !== 'active') throw new Error('已归档配置不能设为默认');
  if (config.lastTestOk !== true) throw new Error('请先通过完整连通测试再设为默认');
}

export function assertMediaStorageConfigCanArchive(configKey: string, activeProviderKey: string) {
  if (normalizeMediaStorageProviderKey(activeProviderKey) === normalizeMediaStorageProviderKey(configKey)) {
    throw new Error('当前默认配置不能归档，请先切换到其他存储配置');
  }
}

export function safeMediaStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  return message
    .replace(/https:\/\/\S+/gi, '[已隐藏地址]')
    .replace(/[?&](?:e|token|sign|auth|download_token)=[^\s&]+/gi, '')
    .slice(0, 500);
}

export function serializeMediaStorageConfig(config: IMediaStorageConfig | Record<string, unknown>) {
  const value = typeof (config as IMediaStorageConfig).toObject === 'function'
    ? (config as IMediaStorageConfig).toObject()
    : config;
  return {
    id: String(value._id || ''),
    key: String(value.key || ''),
    name: String(value.name || ''),
    driver: String(value.driver || ''),
    accessKeyMasked: String(value.accessKeyMasked || ''),
    secretKeyMasked: String(value.secretKeyMasked || ''),
    bucket: String(value.bucket || ''),
    region: String(value.region || ''),
    domain: String(value.domain || ''),
    objectPrefix: String(value.objectPrefix || ''),
    status: String(value.status || 'active'),
    lastTestedAt: value.lastTestedAt || null,
    lastTestOk: typeof value.lastTestOk === 'boolean' ? value.lastTestOk : null,
    lastTestMessage: String(value.lastTestMessage || ''),
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
    archivedAt: value.archivedAt || null,
  };
}

export async function createMediaStorageConfig(
  payload: MediaStorageConfigPayload,
  actorId?: string
) {
  const validated = validateNewMediaStorageConfigPayload(payload);
  const config = await MediaStorageConfig.create({
    key: validated.key,
    name: validated.name,
    driver: validated.driver,
    ...secretFields(validated.accessKey, validated.secretKey),
    bucket: validated.bucket,
    region: validated.region,
    domain: validated.domain,
    objectPrefix: validated.objectPrefix,
    status: 'active',
    lastTestMessage: '尚未执行连通测试',
    createdBy: actorId,
    updatedBy: actorId,
  });
  invalidateMediaStorageProviderCache(config.key);
  return config;
}

export async function updateMediaStorageConfig(
  id: string,
  payload: MediaStorageConfigPayload,
  actorId?: string
) {
  const config = await MediaStorageConfig.findById(id)
    .select('+accessKeyEncrypted +secretKeyEncrypted');
  if (!config) throw new Error('媒体存储配置不存在');
  if (config.status === 'archived') throw new Error('已归档配置不能编辑');

  const nextName = payload.name === undefined ? config.name : requiredText(payload.name, '名称');
  const nextBucket = payload.bucket === undefined ? config.bucket : requiredText(payload.bucket, 'Bucket');
  const nextRegion = payload.region === undefined ? config.region : normalizedRegion(payload.region);
  const nextDomain = payload.domain === undefined ? config.domain : normalizedDomain(payload.domain);
  const nextObjectPrefix = payload.objectPrefix === undefined
    ? config.objectPrefix
    : normalizeMediaStorageObjectPrefix(payload.objectPrefix);
  const accessKey = String(payload.accessKey || '').trim();
  const secretKey = String(payload.secretKey || '').trim();
  const criticalChanged = hasCriticalMediaStorageConfigChange(config, payload);

  config.name = nextName;
  config.bucket = nextBucket;
  config.region = nextRegion;
  config.domain = nextDomain;
  config.objectPrefix = nextObjectPrefix;
  if (accessKey) {
    if (!isMediaStorageEncryptionReady()) throw new Error('生产环境必须配置 MEDIA_STORAGE_KEY_ENCRYPTION_SECRET');
    config.accessKeyEncrypted = encryptMediaStorageSecret(accessKey);
    config.accessKeyMasked = maskSecret(accessKey);
  }
  if (secretKey) {
    if (!isMediaStorageEncryptionReady()) throw new Error('生产环境必须配置 MEDIA_STORAGE_KEY_ENCRYPTION_SECRET');
    config.secretKeyEncrypted = encryptMediaStorageSecret(secretKey);
    config.secretKeyMasked = maskSecret(secretKey);
  }
  config.updatedBy = actorId ? new mongoose.Types.ObjectId(actorId) : config.updatedBy;
  if (criticalChanged) {
    config.lastTestOk = undefined;
    config.lastTestedAt = undefined;
    config.lastTestMessage = TEST_CHANGED_MESSAGE;
  }
  await config.save();
  invalidateMediaStorageProviderCache(config.key);
  return config;
}

export function shouldKeepGrsAiOutputUrl(input: {
  adapterType?: string;
  image?: string;
  persistGrsAiOutputs: boolean;
}) {
  return input.adapterType === 'grs'
    && input.persistGrsAiOutputs !== true
    && /^https?:\/\//i.test(String(input.image || '').trim());
}

export function assertGrsAiOutputPersistenceCanUseProvider(activeProviderKey: string) {
  if (normalizeMediaStorageProviderKey(activeProviderKey) === 'local') {
    throw new Error('请先将已测试通过的七牛云配置设为默认存储，再开启 GRS 结果转存');
  }
}

export async function getGrsAiOutputPersistenceEnabled() {
  const config = await PlatformConfig.findOne({ key: 'default' })
    .select('mediaStorage.persistGrsAiOutputs')
    .lean();
  return config?.mediaStorage?.persistGrsAiOutputs === true;
}

export async function updateGrsAiOutputPersistence(enabled: boolean, actorId?: string) {
  void actorId;
  const current = await PlatformConfig.findOne({ key: 'default' })
    .select('mediaStorage.activeProviderKey')
    .lean();
  const activeProviderKey = normalizeMediaStorageProviderKey(
    current?.mediaStorage?.activeProviderKey || process.env.MEDIA_STORAGE_PROVIDER || 'local'
  );

  if (enabled) {
    assertGrsAiOutputPersistenceCanUseProvider(activeProviderKey);
    const config = await MediaStorageConfig.findOne({ key: activeProviderKey })
      .select('driver status lastTestOk')
      .lean();
    if (!config || config.status !== 'active' || config.driver !== 'qiniu' || config.lastTestOk !== true) {
      throw new Error('当前默认存储不是可用的七牛云配置，不能接管 GRS 结果图');
    }
  }

  await PlatformConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        'mediaStorage.persistGrsAiOutputs': enabled,
      },
      $setOnInsert: { key: 'default' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  return { enabled, activeProviderKey };
}

export async function getMediaStorageAssetStats() {
  const rows = await MediaAsset.collection.aggregate<{
    _id: string;
    activeCount: number;
    activeBytes: number;
    pendingPurgeCount: number;
    pendingPurgeBytes: number;
    totalCount: number;
    totalBytes: number;
  }>([
    {
      $group: {
        _id: { $ifNull: ['$storageProvider', 'local'] },
        activeCount: { $sum: { $cond: [{ $eq: [{ $type: '$deletedAt' }, 'missing'] }, 1, 0] } },
        activeBytes: { $sum: { $cond: [{ $eq: [{ $type: '$deletedAt' }, 'missing'] }, '$size', 0] } },
        pendingPurgeCount: {
          $sum: {
            $cond: [
              { $and: [{ $ne: [{ $type: '$deletedAt' }, 'missing'] }, { $eq: [{ $type: '$purgedAt' }, 'missing'] }] },
              1,
              0,
            ],
          },
        },
        pendingPurgeBytes: {
          $sum: {
            $cond: [
              { $and: [{ $ne: [{ $type: '$deletedAt' }, 'missing'] }, { $eq: [{ $type: '$purgedAt' }, 'missing'] }] },
              '$size',
              0,
            ],
          },
        },
        totalCount: { $sum: 1 },
        totalBytes: { $sum: '$size' },
      },
    },
  ]).toArray();
  return Object.fromEntries(rows.map((row) => [normalizeMediaStorageProviderKey(row._id), {
    activeCount: row.activeCount,
    activeBytes: row.activeBytes,
    pendingPurgeCount: row.pendingPurgeCount,
    pendingPurgeBytes: row.pendingPurgeBytes,
    totalCount: row.totalCount,
    totalBytes: row.totalBytes,
  } satisfies MediaStorageAssetStats]));
}

export async function testMediaStorageProvider(providerKey: string) {
  const key = normalizeMediaStorageProviderKey(providerKey);
  const provider = await getMediaStorageProvider(key);
  const body = Buffer.from(`smart-floor-planner-media-storage-${crypto.randomUUID()}`, 'utf8');
  const logicalObjectKey = `_healthchecks/${key}/${crypto.randomUUID()}.txt`;
  const objectKey = provider.buildObjectKey?.(logicalObjectKey) || logicalObjectKey;
  let uploaded = false;
  try {
    const stored = await provider.putObject({ objectKey, buffer: body, contentType: 'text/plain' });
    uploaded = true;
    if (!provider.statObject) throw new Error('存储驱动未实现对象查询能力');
    const stat = await provider.statObject({ objectKey, bucket: stored.bucket });
    if (stat.size !== body.length) throw new Error('探针对象大小校验失败');
    const downloaded = await provider.getObject({ objectKey, bucket: stored.bucket });
    if (!downloaded.equals(body)) throw new Error('探针对象内容校验失败');
    if (provider.createSignedReadUrl) {
      const signedUrl = await provider.createSignedReadUrl({
        objectKey,
        bucket: stored.bucket,
        expiresInSeconds: 300,
      });
      const response = await fetch(signedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`私有签名下载失败（HTTP ${response.status}）`);
      const signedBody = Buffer.from(await response.arrayBuffer());
      if (!signedBody.equals(body)) throw new Error('私有签名下载内容校验失败');
    }
    await provider.deleteObject({ objectKey, bucket: stored.bucket });
    uploaded = false;
    return { ok: true, message: '上传、查询、私有下载和删除验证通过' };
  } finally {
    if (uploaded) {
      await provider.deleteObject({ objectKey }).catch((error) => {
        console.error('[Media Storage] Probe cleanup failed', safeMediaStorageError(error));
      });
    }
  }
}

export async function testAndRecordMediaStorageConfig(id: string) {
  const config = await MediaStorageConfig.findById(id);
  if (!config) throw new Error('媒体存储配置不存在');
  if (config.status === 'archived') throw new Error('已归档配置不能执行连通测试');

  try {
    const result = await testMediaStorageProvider(config.key);
    config.lastTestedAt = new Date();
    config.lastTestOk = true;
    config.lastTestMessage = result.message;
    await config.save();
    return result;
  } catch (error) {
    const message = safeMediaStorageError(error);
    config.lastTestedAt = new Date();
    config.lastTestOk = false;
    config.lastTestMessage = message;
    await config.save();
    throw new Error(message);
  } finally {
    invalidateMediaStorageProviderCache(config.key);
  }
}

export async function activateMediaStorageProvider(providerKey: string, actorId?: string) {
  const key = normalizeMediaStorageProviderKey(providerKey);
  if (key !== 'local') {
    const config = await MediaStorageConfig.findOne({ key });
    if (!config) throw new Error('媒体存储配置不存在');
    assertMediaStorageConfigCanActivate(config);
  }
  if (key === 'local' && await getGrsAiOutputPersistenceEnabled()) {
    throw new Error('请先关闭 GRS 结果转存，再切换默认存储到本地');
  }
  await PlatformConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        'mediaStorage.activeProviderKey': key,
        'mediaStorage.activatedAt': new Date(),
        ...(actorId ? { 'mediaStorage.activatedBy': actorId } : {}),
      },
      $setOnInsert: { key: 'default' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  invalidateActiveMediaStorageCache();
  return key;
}

export async function archiveMediaStorageConfig(id: string, actorId?: string) {
  const config = await MediaStorageConfig.findById(id);
  if (!config) throw new Error('媒体存储配置不存在');
  const platformConfig = await PlatformConfig.findOne({ key: 'default' })
    .select('mediaStorage.activeProviderKey')
    .lean();
  assertMediaStorageConfigCanArchive(
    config.key,
    platformConfig?.mediaStorage?.activeProviderKey || 'local'
  );
  if (config.status === 'archived') return config;
  config.status = 'archived';
  config.archivedAt = new Date();
  config.archivedBy = actorId ? new mongoose.Types.ObjectId(actorId) : undefined;
  config.updatedBy = actorId ? new mongoose.Types.ObjectId(actorId) : config.updatedBy;
  await config.save();
  invalidateMediaStorageProviderCache(config.key);
  return config;
}

export function mediaStorageEncryptionState() {
  return {
    ready: isMediaStorageEncryptionReady(),
    dedicated: Boolean(process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET?.trim()),
  };
}

export async function decryptedMediaStorageCredentials(id: string) {
  const config = await MediaStorageConfig.findById(id)
    .select('+accessKeyEncrypted +secretKeyEncrypted');
  if (!config) throw new Error('媒体存储配置不存在');
  return {
    accessKey: decryptMediaStorageSecret(config.accessKeyEncrypted),
    secretKey: decryptMediaStorageSecret(config.secretKeyEncrypted),
  };
}
