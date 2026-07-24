import * as qiniu from 'qiniu';
import type {
  MediaStorageLocation,
  MediaStorageProvider,
  PutMediaObjectInput,
  StoredMediaObject,
} from './types';

export const QINIU_REGIONS = [
  'z0',
  'cn-east-2',
  'z1',
  'z2',
  'na0',
  'as0',
] as const;

export type QiniuRegion = typeof QINIU_REGIONS[number];

export type QiniuMediaStorageOptions = {
  key: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: QiniuRegion;
  domain: string;
  objectPrefix?: string;
};

type QiniuResponse<T = unknown> = {
  data: T & { error?: string; error_code?: string };
  resp: { statusCode?: number };
  ok(): boolean;
};

type QiniuSdk = typeof qiniu;

function qiniuZone(sdk: QiniuSdk, region: QiniuRegion) {
  const zones: Record<QiniuRegion, qiniu.conf.Zone> = {
    z0: sdk.zone.Zone_z0,
    'cn-east-2': sdk.zone.Zone_cn_east_2,
    z1: sdk.zone.Zone_z1,
    z2: sdk.zone.Zone_z2,
    na0: sdk.zone.Zone_na0,
    as0: sdk.zone.Zone_as0,
  };
  return zones[region];
}

function responseStatus(response: QiniuResponse) {
  return Number(response.resp?.statusCode || 0);
}

function assertQiniuResponse(response: QiniuResponse, operation: string) {
  if (response.ok()) return;
  const status = responseStatus(response);
  const code = String(response.data?.error_code || '').trim();
  throw new Error(
    `七牛云${operation}失败${status ? `（HTTP ${status}${code ? `/${code}` : ''}）` : ''}`
  );
}

export class QiniuMediaStorageProvider implements MediaStorageProvider {
  readonly key: string;
  private readonly options: QiniuMediaStorageOptions;
  private readonly mac: qiniu.auth.digest.Mac;
  private readonly config: qiniu.conf.Config;
  private readonly uploader: qiniu.form_up.FormUploader;
  private readonly bucketManager: qiniu.rs.BucketManager;
  private readonly sdk: QiniuSdk;

  constructor(options: QiniuMediaStorageOptions, sdk: QiniuSdk = qiniu) {
    this.options = options;
    this.key = options.key;
    this.sdk = sdk;
    this.mac = new sdk.auth.digest.Mac(options.accessKey, options.secretKey);
    this.config = new sdk.conf.Config({
      zone: qiniuZone(sdk, options.region),
      useHttpsDomain: true,
    });
    this.uploader = new sdk.form_up.FormUploader(this.config);
    this.bucketManager = new sdk.rs.BucketManager(this.mac, this.config);
  }

  private bucket(input?: MediaStorageLocation) {
    const bucket = input?.bucket || this.options.bucket;
    if (bucket !== this.options.bucket) {
      throw new Error('媒体资产 Bucket 与存储配置不匹配');
    }
    return bucket;
  }

  buildObjectKey(objectKey: string) {
    const normalizedKey = String(objectKey || '').replace(/^\/+/, '');
    const prefix = String(this.options.objectPrefix || '');
    return prefix ? `${prefix}${normalizedKey}` : normalizedKey;
  }

  private async sdkRequest<T>(operation: string, request: () => Promise<QiniuResponse<T>>) {
    try {
      const response = await request();
      assertQiniuResponse(response, operation);
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('七牛云')) throw error;
      throw new Error(`七牛云${operation}失败（SDK 或网络异常）`);
    }
  }

  async putObject(input: PutMediaObjectInput): Promise<StoredMediaObject> {
    const putPolicy = new this.sdk.rs.PutPolicy({
      scope: `${this.options.bucket}:${input.objectKey}`,
    });
    const uploadToken = putPolicy.uploadToken(this.mac);
    const putExtra = new this.sdk.form_up.PutExtra(undefined, undefined, input.contentType);
    await this.sdkRequest('上传', () => this.uploader.put(
      uploadToken,
      input.objectKey,
      input.buffer,
      putExtra
    ) as Promise<QiniuResponse<{ hash?: string; key?: string }>>);
    return { bucket: this.options.bucket };
  }

  async getObject(input: MediaStorageLocation) {
    const url = await this.createSignedReadUrl({ ...input, expiresInSeconds: 300 });
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`七牛云下载失败（HTTP ${response.status}）`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObject(input: MediaStorageLocation) {
    try {
      const response = await this.bucketManager.delete(
        this.bucket(input),
        input.objectKey
      ) as QiniuResponse;
      const status = responseStatus(response);
      if (response.ok() || status === 612) return;
      assertQiniuResponse(response, '删除');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('七牛云')) throw error;
      throw new Error('七牛云删除失败（SDK 或网络异常）');
    }
  }

  async statObject(input: MediaStorageLocation) {
    const response = await this.sdkRequest('查询', () => this.bucketManager.stat(
      this.bucket(input),
      input.objectKey
    ) as Promise<QiniuResponse<{ fsize?: number; hash?: string; mimeType?: string }>>);
    return {
      size: Number(response.data.fsize || 0),
      checksum: response.data.hash,
      contentType: response.data.mimeType,
    };
  }

  async createSignedReadUrl(input: MediaStorageLocation & { expiresInSeconds: number }) {
    this.bucket(input);
    const deadline = Math.floor(Date.now() / 1000) + Math.max(1, input.expiresInSeconds);
    return this.bucketManager.privateDownloadUrl(
      this.options.domain,
      input.objectKey,
      deadline
    );
  }
}
