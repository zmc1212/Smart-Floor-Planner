import mongoose from 'mongoose';
import { loadEnvConfig } from '@next/env';
import { MediaAsset } from '../src/models/MediaAsset';
import { getMediaStorageProvider } from '../src/lib/media-storage/registry';

loadEnvConfig(process.cwd());

function numberArgument(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --${name} value`);
  return Math.floor(parsed);
}

async function main() {
  const execute = process.argv.includes('--execute');
  const graceDays = numberArgument(
    'older-than-days',
    Number(process.env.MEDIA_ASSET_PURGE_GRACE_DAYS || 7)
  );
  const limit = numberArgument('limit', 100);
  const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();

  const assets = await MediaAsset.find({
    deletedAt: { $lte: cutoff },
    purgedAt: { $exists: false },
  }).sort({ deletedAt: 1 }).limit(limit || 100);

  console.info(JSON.stringify({ execute, graceDays, cutoff, matched: assets.length }, null, 2));
  if (!execute) {
    console.info('[media-cleanup] Dry run only. Re-run with --execute to delete stored objects.');
    return;
  }

  let purged = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const provider = await getMediaStorageProvider(asset.storageProvider || 'local');
      await provider.deleteObject({ objectKey: asset.storageKey, bucket: asset.storageBucket });
      await MediaAsset.updateOne(
        { _id: asset._id, purgedAt: { $exists: false } },
        { $set: { purgedAt: new Date() }, $unset: { purgeError: 1 } }
      );
      purged += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await MediaAsset.updateOne(
        { _id: asset._id, purgedAt: { $exists: false } },
        { $set: { purgeError: message.slice(0, 1000) } }
      );
      console.error(`[media-cleanup] Failed ${asset._id}: ${message}`);
    }
  }

  console.info(JSON.stringify({ purged, failed }, null, 2));
}

main().catch((error) => {
  console.error('[media-cleanup] failed', error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined);
});
