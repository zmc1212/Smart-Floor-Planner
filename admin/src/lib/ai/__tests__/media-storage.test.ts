import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalMediaStorageProvider } from '@/lib/media-storage/local-provider';
import { QiniuMediaStorageProvider } from '@/lib/media-storage/qiniu-provider';
import {
  assertMediaStorageConfigCanActivate,
  assertMediaStorageConfigCanArchive,
  assertGrsAiOutputPersistenceCanUseProvider,
  hasCriticalMediaStorageConfigChange,
  isDirectQiniuDisplayUrlsEnabled,
  normalizeMediaStorageObjectPrefix,
  safeMediaStorageError,
  serializeMediaStorageConfig,
  shouldKeepGrsAiOutputUrl,
  shouldUseDirectQiniuDisplayUrl,
  validateNewMediaStorageConfigPayload,
} from '@/lib/media-storage/config-service';
import {
  decryptMediaStorageSecret,
  encryptMediaStorageSecret,
  maskSecret,
} from '@/lib/crypto';
import {
  migrateMediaObject,
  persistMediaObject,
  resolveMediaObjectDelivery,
  sha256Hex,
} from '@/lib/media-storage/operations';
import { MediaStorageRegistry } from '@/lib/media-storage/registry';
import type {
  MediaStorageLocation,
  MediaStorageProvider,
  PutMediaObjectInput,
} from '@/lib/media-storage/types';

class MemoryMediaStorageProvider implements MediaStorageProvider {
  readonly objects = new Map<string, Buffer>();
  readonly deletedKeys: string[] = [];

  constructor(readonly key: string) {}

  async putObject(input: PutMediaObjectInput) {
    this.objects.set(input.objectKey, Buffer.from(input.buffer));
    return { checksumSha256: sha256Hex(input.buffer) };
  }

  async getObject(input: MediaStorageLocation) {
    const buffer = this.objects.get(input.objectKey);
    if (!buffer) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    return Buffer.from(buffer);
  }

  async deleteObject(input: MediaStorageLocation) {
    this.deletedKeys.push(input.objectKey);
    this.objects.delete(input.objectKey);
  }
}

test('local provider writes, reads, and idempotently deletes inside its root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sfp-media-storage-'));
  try {
    const provider = new LocalMediaStorageProvider(root);
    const buffer = Buffer.from('local-media');
    const stored = await provider.putObject({
      objectKey: 'tenant/2026/asset.bin',
      buffer,
      contentType: 'application/octet-stream',
    });

    assert.equal(stored.checksumSha256, sha256Hex(buffer));
    assert.deepEqual(await provider.getObject({ objectKey: 'tenant/2026/asset.bin' }), buffer);
    await provider.deleteObject({ objectKey: 'tenant/2026/asset.bin' });
    await provider.deleteObject({ objectKey: 'tenant/2026/asset.bin' });
    await assert.rejects(
      provider.getObject({ objectKey: 'tenant/2026/asset.bin' }),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('local provider rejects object keys outside its configured root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sfp-media-storage-'));
  try {
    const provider = new LocalMediaStorageProvider(root);
    await assert.rejects(
      provider.putObject({
        objectKey: '../escape.bin',
        buffer: Buffer.from('escape'),
        contentType: 'application/octet-stream',
      }),
      /outside the configured storage directory/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('registry resolves legacy missing providers as local and rejects unknown providers', () => {
  const registry = new MediaStorageRegistry();
  registry.register('local', () => new MemoryMediaStorageProvider('local'));

  assert.equal(registry.resolve(undefined).key, 'local');
  assert.throws(() => registry.resolve('cos'), /Unsupported media storage provider: cos/);
});

test('failed metadata commit removes an uploaded object', async () => {
  const provider = new MemoryMediaStorageProvider('memory');
  await assert.rejects(
    persistMediaObject({
      provider,
      objectKey: 'asset.bin',
      buffer: Buffer.from('content'),
      contentType: 'application/octet-stream',
      commit: async () => {
        throw new Error('database unavailable');
      },
    }),
    /database unavailable/
  );

  assert.equal(provider.objects.has('asset.bin'), false);
  assert.deepEqual(provider.deletedKeys, ['asset.bin']);
});

test('delivery returns bytes for local providers and redirects for signed providers', async () => {
  const local = new MemoryMediaStorageProvider('local');
  local.objects.set('asset.bin', Buffer.from('content'));
  const localDelivery = await resolveMediaObjectDelivery({
    provider: local,
    location: { objectKey: 'asset.bin' },
    expiresInSeconds: 3600,
  });
  assert.equal(localDelivery.kind, 'buffer');
  if (localDelivery.kind === 'buffer') assert.equal(localDelivery.buffer.toString(), 'content');

  const signed: MediaStorageProvider = {
    ...new MemoryMediaStorageProvider('signed'),
    key: 'signed',
    putObject: async () => ({}),
    getObject: async () => Buffer.alloc(0),
    deleteObject: async () => undefined,
    createSignedReadUrl: async ({ objectKey, expiresInSeconds }) => (
      `https://assets.example.com/${objectKey}?ttl=${expiresInSeconds}`
    ),
  };
  const signedDelivery = await resolveMediaObjectDelivery({
    provider: signed,
    location: { objectKey: 'asset.bin' },
    expiresInSeconds: 900,
  });
  assert.deepEqual(signedDelivery, {
    kind: 'redirect',
    url: 'https://assets.example.com/asset.bin?ttl=900',
  });
});

test('migration verifies the target before committing and only then deletes the source', async () => {
  const source = new MemoryMediaStorageProvider('source');
  const target = new MemoryMediaStorageProvider('target');
  const buffer = Buffer.from('migrate-me');
  source.objects.set('asset.bin', buffer);
  let committed = false;

  const result = await migrateMediaObject({
    sourceProvider: source,
    targetProvider: target,
    source: { objectKey: 'asset.bin' },
    contentType: 'application/octet-stream',
    expectedSize: buffer.length,
    expectedChecksumSha256: sha256Hex(buffer),
    commit: async (stored) => {
      assert.equal(stored.checksumSha256, sha256Hex(buffer));
      assert.equal(source.objects.has('asset.bin'), true);
      committed = true;
    },
  });

  assert.equal(committed, true);
  assert.equal(source.objects.has('asset.bin'), false);
  assert.deepEqual(target.objects.get('asset.bin'), buffer);
  assert.equal(result.sourceDeleteError, undefined);
});

test('failed migration commit preserves the source and removes the target', async () => {
  const source = new MemoryMediaStorageProvider('source');
  const target = new MemoryMediaStorageProvider('target');
  source.objects.set('asset.bin', Buffer.from('migrate-me'));

  await assert.rejects(
    migrateMediaObject({
      sourceProvider: source,
      targetProvider: target,
      source: { objectKey: 'asset.bin' },
      contentType: 'application/octet-stream',
      commit: async () => {
        throw new Error('database changed');
      },
    }),
    /database changed/
  );

  assert.equal(source.objects.has('asset.bin'), true);
  assert.equal(target.objects.has('asset.bin'), false);
});

function fakeQiniuResponse<T>(data: T, statusCode = 200) {
  return {
    data,
    resp: { statusCode },
    ok: () => statusCode >= 200 && statusCode < 300,
  };
}

function createFakeQiniuSdk(options?: { deleteStatus?: number; uploadReject?: boolean }) {
  const calls: Array<{ operation: string; bucket?: string; key?: string; scope?: string }> = [];
  class Mac { constructor(public accessKey: string, public secretKey: string) {} }
  class Config { constructor(public options: unknown) {} }
  class PutPolicy {
    constructor(public options: { scope: string }) { calls.push({ operation: 'policy', scope: options.scope }); }
    uploadToken() { return 'upload-token'; }
  }
  class PutExtra { constructor(...args: unknown[]) { void args; } }
  class FormUploader {
    async put(_token: string, key: string, body: Buffer) {
      void body;
      calls.push({ operation: 'put', key });
      if (options?.uploadReject) throw new Error('request contained secret URL');
      return fakeQiniuResponse({ key, hash: 'hash' });
    }
  }
  class BucketManager {
    async stat(bucket: string, key: string) {
      calls.push({ operation: 'stat', bucket, key });
      return fakeQiniuResponse({ fsize: 7, hash: 'hash', mimeType: 'text/plain' });
    }
    async delete(bucket: string, key: string) {
      calls.push({ operation: 'delete', bucket, key });
      const status = options?.deleteStatus || 200;
      return fakeQiniuResponse(status === 612 ? { error: 'no such file' } : {}, status);
    }
    privateDownloadUrl(domain: string, key: string, deadline: number) {
      calls.push({ operation: 'sign', key });
      return `${domain}/${key}?e=${deadline}&token=private`;
    }
  }
  const sdk = {
    auth: { digest: { Mac } },
    conf: { Config },
    zone: {
      Zone_z0: {}, Zone_cn_east_2: {}, Zone_z1: {}, Zone_z2: {}, Zone_na0: {}, Zone_as0: {},
    },
    rs: { PutPolicy, BucketManager },
    form_up: { PutExtra, FormUploader },
  };
  return { sdk, calls };
}

function qiniuOptions() {
  return {
    key: 'qiniu-primary',
    accessKey: 'access-key',
    secretKey: 'secret-key',
    bucket: 'private-bucket',
    region: 'z0' as const,
    domain: 'https://media.example.com',
  };
}

test('qiniu provider uploads, stats, signs, downloads, and deletes private objects', async () => {
  const { sdk, calls } = createFakeQiniuSdk();
  const provider = new QiniuMediaStorageProvider(
    { ...qiniuOptions(), objectPrefix: 'smart-floor/ai-assets/' },
    sdk as unknown as typeof import('qiniu')
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('content'), { status: 200 });
  try {
    assert.equal(
      provider.buildObjectKey?.('tenant/asset.txt'),
      'smart-floor/ai-assets/tenant/asset.txt'
    );
    assert.deepEqual(await provider.putObject({
      objectKey: 'tenant/asset.txt',
      buffer: Buffer.from('content'),
      contentType: 'text/plain',
    }), { bucket: 'private-bucket' });
    assert.equal((await provider.statObject({ objectKey: 'tenant/asset.txt' })).size, 7);
    assert.equal((await provider.getObject({ objectKey: 'tenant/asset.txt' })).toString(), 'content');
    const url = await provider.createSignedReadUrl({ objectKey: 'tenant/asset.txt', expiresInSeconds: 60 });
    assert.match(url, /^https:\/\/media\.example\.com\/tenant\/asset\.txt\?e=/);
    await provider.deleteObject({ objectKey: 'tenant/asset.txt' });
    assert.ok(calls.some((call) => call.scope === 'private-bucket:tenant/asset.txt'));
    assert.ok(calls.some((call) => call.operation === 'stat'));
    assert.ok(calls.some((call) => call.operation === 'sign'));
    assert.ok(calls.some((call) => call.operation === 'delete'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('qiniu delete treats status 612 as idempotent success', async () => {
  const { sdk } = createFakeQiniuSdk({ deleteStatus: 612 });
  const provider = new QiniuMediaStorageProvider(qiniuOptions(), sdk as unknown as typeof import('qiniu'));
  await provider.deleteObject({ objectKey: 'missing.txt' });
});

test('qiniu SDK failures are mapped without leaking upstream details', async () => {
  const { sdk } = createFakeQiniuSdk({ uploadReject: true });
  const provider = new QiniuMediaStorageProvider(qiniuOptions(), sdk as unknown as typeof import('qiniu'));
  await assert.rejects(
    provider.putObject({ objectKey: 'asset.txt', buffer: Buffer.from('x'), contentType: 'text/plain' }),
    (error: Error) => error.message === '七牛云上传失败（SDK 或网络异常）'
  );
});

test('media storage config validation enforces stable keys, prefixes, supported regions, and HTTPS origins', () => {
  const valid = validateNewMediaStorageConfigPayload({
    key: 'qiniu-primary', name: '主存储', driver: 'qiniu', accessKey: 'ak', secretKey: 'sk',
    bucket: 'private-bucket', region: 'z0', domain: 'https://media.example.com/',
    objectPrefix: 'smart-floor/ai-assets',
  });
  assert.equal(valid.domain, 'https://media.example.com');
  assert.equal(valid.objectPrefix, 'smart-floor/ai-assets/');
  assert.throws(() => validateNewMediaStorageConfigPayload({ ...valid, key: 'local' }), /系统保留/);
  assert.throws(() => validateNewMediaStorageConfigPayload({ ...valid, region: 'unknown' }), /不支持的七牛云区域/);
  assert.throws(() => validateNewMediaStorageConfigPayload({ ...valid, domain: 'http://media.example.com' }), /必须使用 HTTPS/);
  assert.throws(() => validateNewMediaStorageConfigPayload({ ...valid, domain: 'https://media.example.com/path' }), /域名根地址/);
  assert.throws(() => validateNewMediaStorageConfigPayload({ ...valid, objectPrefix: '../escape' }), /相对路径/);
});

test('storage prefixes normalize separators and reject unsafe path segments', () => {
  assert.equal(normalizeMediaStorageObjectPrefix(''), '');
  assert.equal(normalizeMediaStorageObjectPrefix('/smart-floor\\ai-assets/'), 'smart-floor/ai-assets/');
  assert.throws(() => normalizeMediaStorageObjectPrefix('smart-floor//ai-assets'), /相对路径/);
  assert.throws(() => normalizeMediaStorageObjectPrefix('smart-floor/../ai-assets'), /相对路径/);
});

test('Mini Program effect images default to direct Qiniu display URLs', () => {
  assert.equal(isDirectQiniuDisplayUrlsEnabled(), true);
  assert.equal(isDirectQiniuDisplayUrlsEnabled({}), true);
  assert.equal(isDirectQiniuDisplayUrlsEnabled({ persistGrsAiOutputs: true }), true);
  assert.equal(isDirectQiniuDisplayUrlsEnabled({ directQiniuDisplayUrls: true }), true);
  assert.equal(isDirectQiniuDisplayUrlsEnabled({ directQiniuDisplayUrls: false }), false);
});

test('direct Qiniu display requires both the platform switch and a signed-read provider', () => {
  assert.equal(shouldUseDirectQiniuDisplayUrl({ hasSignedReadUrl: true }), true);
  assert.equal(shouldUseDirectQiniuDisplayUrl({ directQiniuDisplayUrls: true, hasSignedReadUrl: true }), true);
  assert.equal(shouldUseDirectQiniuDisplayUrl({ directQiniuDisplayUrls: false, hasSignedReadUrl: true }), false);
  assert.equal(shouldUseDirectQiniuDisplayUrl({ directQiniuDisplayUrls: true, hasSignedReadUrl: false }), false);
});

test('GRS output storage policy keeps only remote GRS result URLs when transfer is disabled', () => {
  assert.equal(shouldKeepGrsAiOutputUrl({
    adapterType: 'grs', image: 'https://grs.example.com/result.png', persistGrsAiOutputs: false,
  }), true);
  assert.equal(shouldKeepGrsAiOutputUrl({
    adapterType: 'grs', image: 'data:image/png;base64,abc', persistGrsAiOutputs: false,
  }), false);
  assert.equal(shouldKeepGrsAiOutputUrl({
    adapterType: 'openai', image: 'https://images.example.com/result.png', persistGrsAiOutputs: false,
  }), false);
  assert.equal(shouldKeepGrsAiOutputUrl({
    adapterType: 'grs', image: 'https://grs.example.com/result.png', persistGrsAiOutputs: true,
  }), false);
  assert.throws(() => assertGrsAiOutputPersistenceCanUseProvider('local'), /七牛云配置/);
  assert.doesNotThrow(() => assertGrsAiOutputPersistenceCanUseProvider('qiniu-primary'));
});

test('media storage credentials encrypt, decrypt, mask, and never serialize encrypted fields', () => {
  const previous = process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET;
  process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET = 'unit-test-media-storage-secret';
  try {
    const encrypted = encryptMediaStorageSecret('secret-value');
    assert.notEqual(encrypted, 'secret-value');
    assert.equal(decryptMediaStorageSecret(encrypted), 'secret-value');
    assert.equal(maskSecret('123456789012'), '12345***9012');
    const serialized = serializeMediaStorageConfig({
      _id: 'config-id', key: 'qiniu-primary', name: '主存储', driver: 'qiniu',
      accessKeyMasked: 'abc***xyz', secretKeyMasked: 'def***uvw',
      accessKeyEncrypted: encrypted, secretKeyEncrypted: encrypted,
      bucket: 'private-bucket', region: 'z0', domain: 'https://media.example.com', status: 'active',
    });
    const json = JSON.stringify(serialized);
    assert.equal(json.includes(encrypted), false);
    assert.equal(json.includes('accessKeyEncrypted'), false);
    assert.equal(json.includes('secretKeyEncrypted'), false);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET;
    else process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET = previous;
  }
});

test('safe media storage errors remove signed URLs', () => {
  const message = safeMediaStorageError(new Error('failed https://media.example.com/a?e=123&token=secret'));
  assert.equal(message.includes('token=secret'), false);
  assert.equal(message.includes('https://'), false);
});

test('config changes invalidate connectivity only for storage-critical fields or credentials', () => {
  const current = {
    bucket: 'private-bucket',
    region: 'z0',
    domain: 'https://media.example.com',
    objectPrefix: '',
  };
  assert.equal(hasCriticalMediaStorageConfigChange(current, { name: '新名称' }), false);
  assert.equal(hasCriticalMediaStorageConfigChange(current, { bucket: 'other-bucket' }), true);
  assert.equal(hasCriticalMediaStorageConfigChange(current, { objectPrefix: 'smart-floor' }), true);
  assert.equal(hasCriticalMediaStorageConfigChange(current, { accessKey: 'rotated-ak' }), true);
});

test('activation and archive guards reject untested, failed, archived, and current-default configs', () => {
  assert.doesNotThrow(() => assertMediaStorageConfigCanActivate({ status: 'active', lastTestOk: true }));
  assert.throws(() => assertMediaStorageConfigCanActivate({ status: 'active' }), /完整连通测试/);
  assert.throws(() => assertMediaStorageConfigCanActivate({ status: 'active', lastTestOk: false }), /完整连通测试/);
  assert.throws(() => assertMediaStorageConfigCanActivate({ status: 'archived', lastTestOk: true }), /已归档/);
  assert.throws(() => assertMediaStorageConfigCanArchive('qiniu-primary', 'qiniu-primary'), /当前默认配置不能归档/);
});

test('an upload failure never commits metadata or attempts a local fallback', async () => {
  let committed = false;
  const failingProvider: MediaStorageProvider = {
    key: 'qiniu-primary',
    putObject: async () => { throw new Error('七牛云上传失败'); },
    getObject: async () => Buffer.alloc(0),
    deleteObject: async () => undefined,
  };
  await assert.rejects(
    persistMediaObject({
      provider: failingProvider,
      objectKey: 'asset.bin',
      buffer: Buffer.from('content'),
      contentType: 'application/octet-stream',
      commit: async () => { committed = true; },
    }),
    /七牛云上传失败/
  );
  assert.equal(committed, false);
});
