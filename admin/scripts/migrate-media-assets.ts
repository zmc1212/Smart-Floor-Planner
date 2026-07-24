import mongoose from 'mongoose';
import { loadEnvConfig } from '@next/env';
import { MediaAsset } from '../src/models/MediaAsset';
import { migrateMediaObject } from '../src/lib/media-storage/operations';
import {
  getMediaStorageProvider,
  normalizeMediaStorageProviderKey,
} from '../src/lib/media-storage/registry';

loadEnvConfig(process.cwd());

function stringArgument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim() || '';
}

function numberArgument(name: string, fallback: number) {
  const parsed = Number(stringArgument(name) || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --${name} value`);
  return Math.floor(parsed);
}

async function main() {
  const execute = process.argv.includes('--execute');
  const from = normalizeMediaStorageProviderKey(stringArgument('from'));
  const to = normalizeMediaStorageProviderKey(stringArgument('to'));
  const limit = numberArgument('limit', 100);
  if (!stringArgument('from') || !stringArgument('to')) {
    throw new Error('Both --from=<provider> and --to=<provider> are required');
  }
  if (from === to) throw new Error('--from and --to must be different providers');

  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  const sourceProvider = await getMediaStorageProvider(from);
  const targetProvider = await getMediaStorageProvider(to);

  const providerFilter = from === 'local'
    ? { $or: [{ storageProvider: 'local' }, { storageProvider: { $exists: false } }] }
    : { storageProvider: from };
  const assets = await MediaAsset.find({
    ...providerFilter,
    deletedAt: { $exists: false },
    purgedAt: { $exists: false },
  }).sort({ createdAt: 1 }).limit(limit);

  console.info(JSON.stringify({ execute, from, to, matched: assets.length }, null, 2));
  if (!execute) {
    console.info('[media-migration] Dry run only. Re-run with --execute to migrate objects.');
    return;
  }

  let migrated = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const result = await migrateMediaObject({
        sourceProvider,
        targetProvider,
        source: { objectKey: asset.storageKey, bucket: asset.storageBucket },
        contentType: asset.mimeType,
        expectedSize: asset.size,
        expectedChecksumSha256: asset.checksumSha256,
        commit: async (stored) => {
          const providerCondition = from === 'local'
            ? { $or: [{ storageProvider: 'local' }, { storageProvider: { $exists: false } }] }
            : { storageProvider: from };
          const update = await MediaAsset.updateOne(
            { _id: asset._id, storageKey: asset.storageKey, ...providerCondition },
            {
              $set: {
                storageProvider: targetProvider.key,
                storageKey: asset.storageKey,
                checksumSha256: stored.checksumSha256,
                ...(stored.bucket ? { storageBucket: stored.bucket } : {}),
              },
              ...(!stored.bucket ? { $unset: { storageBucket: 1 } } : {}),
            }
          );
          if (update.modifiedCount !== 1) throw new Error('Media asset changed during migration');
        },
      });
      migrated += 1;
      if (result.sourceDeleteError) {
        console.warn(`[media-migration] Migrated ${asset._id}, but source cleanup failed: ${result.sourceDeleteError}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[media-migration] Failed ${asset._id}:`, error);
    }
  }

  console.info(JSON.stringify({ migrated, failed }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[media-migration] failed', error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined);
});
