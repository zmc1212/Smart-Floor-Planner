import crypto from 'crypto';
import type { MediaStorageLocation, MediaStorageProvider, StoredMediaObject } from './types';

export function sha256Hex(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function resolveMediaObjectDelivery(input: {
  provider: MediaStorageProvider;
  location: MediaStorageLocation;
  expiresInSeconds: number;
}) {
  if (input.provider.createSignedReadUrl) {
    return {
      kind: 'redirect' as const,
      url: await input.provider.createSignedReadUrl({
        ...input.location,
        expiresInSeconds: input.expiresInSeconds,
      }),
    };
  }
  return {
    kind: 'buffer' as const,
    buffer: await input.provider.getObject(input.location),
  };
}

export async function persistMediaObject<T>(input: {
  provider: MediaStorageProvider;
  objectKey: string;
  buffer: Buffer;
  contentType: string;
  commit: (stored: StoredMediaObject & { checksumSha256: string }) => Promise<T>;
}) {
  let stored: StoredMediaObject | undefined;
  try {
    stored = await input.provider.putObject({
      objectKey: input.objectKey,
      buffer: input.buffer,
      contentType: input.contentType,
    });
    const checksumSha256 = stored.checksumSha256 || sha256Hex(input.buffer);
    const value = await input.commit({ ...stored, checksumSha256 });
    return { value, stored: { ...stored, checksumSha256 } };
  } catch (error) {
    if (stored) {
      await input.provider.deleteObject({
        objectKey: input.objectKey,
        bucket: stored.bucket,
      }).catch((cleanupError) => {
        console.error('[Media Storage] Failed to remove uncommitted object', cleanupError);
      });
    }
    throw error;
  }
}

export async function migrateMediaObject(input: {
  sourceProvider: MediaStorageProvider;
  targetProvider: MediaStorageProvider;
  source: MediaStorageLocation;
  targetObjectKey?: string;
  contentType: string;
  expectedSize?: number;
  expectedChecksumSha256?: string;
  commit: (stored: StoredMediaObject & { checksumSha256: string }) => Promise<void>;
}) {
  const sourceBuffer = await input.sourceProvider.getObject(input.source);
  if (Number.isFinite(input.expectedSize) && sourceBuffer.length !== input.expectedSize) {
    throw new Error(`Source media size mismatch: expected ${input.expectedSize}, got ${sourceBuffer.length}`);
  }

  const sourceChecksum = sha256Hex(sourceBuffer);
  if (input.expectedChecksumSha256 && sourceChecksum !== input.expectedChecksumSha256) {
    throw new Error('Source media checksum mismatch');
  }

  const targetObjectKey = input.targetObjectKey || input.source.objectKey;
  let targetStored: StoredMediaObject | undefined;
  let committed = false;
  try {
    targetStored = await input.targetProvider.putObject({
      objectKey: targetObjectKey,
      buffer: sourceBuffer,
      contentType: input.contentType,
    });
    const targetBuffer = await input.targetProvider.getObject({
      objectKey: targetObjectKey,
      bucket: targetStored.bucket,
    });
    const targetChecksum = sha256Hex(targetBuffer);
    if (targetBuffer.length !== sourceBuffer.length || targetChecksum !== sourceChecksum) {
      throw new Error('Target media verification failed');
    }

    await input.commit({ ...targetStored, checksumSha256: sourceChecksum });
    committed = true;
  } catch (error) {
    if (targetStored && !committed) {
      await input.targetProvider.deleteObject({
        objectKey: targetObjectKey,
        bucket: targetStored.bucket,
      }).catch((cleanupError) => {
        console.error('[Media Storage] Failed to remove uncommitted migration target', cleanupError);
      });
    }
    throw error;
  }

  let sourceDeleteError: string | undefined;
  try {
    await input.sourceProvider.deleteObject(input.source);
  } catch (error) {
    sourceDeleteError = error instanceof Error ? error.message : String(error);
  }

  return {
    objectKey: targetObjectKey,
    bucket: targetStored?.bucket,
    checksumSha256: sourceChecksum,
    sourceDeleteError,
  };
}
