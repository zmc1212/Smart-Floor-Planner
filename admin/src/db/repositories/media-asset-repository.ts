import { sql } from 'drizzle-orm';
import { mediaAssets } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type MediaAssetStorageStatsRecord = {
  storageProvider: string;
  activeCount: string;
  activeBytes: string;
  pendingPurgeCount: string;
  pendingPurgeBytes: string;
  totalCount: string;
  totalBytes: string;
};

/** Platform-scoped aggregate for the media-storage administration surface. */
export class MediaAssetRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  listStorageStats() {
    return this.transaction
      .select({
        storageProvider: mediaAssets.storageProvider,
        activeCount: sql<string>`count(*) filter (where ${mediaAssets.deletedAt} is null)::text`,
        activeBytes: sql<string>`coalesce(sum(${mediaAssets.size}) filter (where ${mediaAssets.deletedAt} is null), 0)::text`,
        pendingPurgeCount: sql<string>`count(*) filter (where ${mediaAssets.deletedAt} is not null and ${mediaAssets.purgedAt} is null)::text`,
        pendingPurgeBytes: sql<string>`coalesce(sum(${mediaAssets.size}) filter (where ${mediaAssets.deletedAt} is not null and ${mediaAssets.purgedAt} is null), 0)::text`,
        totalCount: sql<string>`count(*)::text`,
        totalBytes: sql<string>`coalesce(sum(${mediaAssets.size}), 0)::text`,
      })
      .from(mediaAssets)
      .groupBy(mediaAssets.storageProvider);
  }
}
