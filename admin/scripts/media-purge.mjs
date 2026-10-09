#!/usr/bin/env node
/**
 * Media asset recycling for the local storage provider.
 *
 * `media_assets` rows carry soft-delete columns (`deleted_at` / `purged_at` /
 * `purge_error`), set when a deleted generation's output assets are marked by
 * `softDeleteGenerationMediaAssetsInTransaction`. This tool closes the loop:
 *
 *   report          (default) counts pending-purge rows, classifies every file
 *                   under the local storage root against the media_assets
 *                   table, and sizes the reclaimable bytes.
 *   --apply         deletes the storage objects of pending-purge local rows
 *                   older than --grace-days, then stamps `purged_at`.
 *   --apply-orphans moves files that have no media_assets row at all into
 *                   `<storage root>/.purge-recycle/<batch>/` (with a manifest)
 *                   instead of deleting them. Review before removing manually.
 *
 * Only the `local` provider is handled. Rows on remote providers are reported
 * so they can be reclaimed through the provider console.
 *
 * Usage (from admin/):
 *   node scripts/media-purge.mjs
 *   node scripts/media-purge.mjs --json
 *   node scripts/media-purge.mjs --apply [--grace-days 7]
 *   node scripts/media-purge.mjs --apply-orphans
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';

const { loadEnvConfig } = nextEnv;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const APPLY_ORPHANS = args.includes('--apply-orphans');
const JSON_MODE = args.includes('--json');
const graceDays = Number(args[args.indexOf('--grace-days') + 1] ?? 7) || 7;

const ADMIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECYCLE_DIR = '.purge-recycle';
const HEALTHCHECK_PREFIX = '_healthchecks/';

function resolveStorageRoot() {
  const configured = process.env.AI_ASSET_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(ADMIN_ROOT, 'uploads', 'ai-assets');
}

/** Rejects absolute paths and traversal so a storage key cannot escape the root. */
function resolveObjectPath(storageRoot, storageKey) {
  const normalized = String(storageKey).split('\\').join('/');
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe storage key: ${storageKey}`);
  }
  return path.join(storageRoot, ...normalized.split('/'));
}

async function walkFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath));
    else if (entry.isFile()) {
      const stat = await fsp.stat(fullPath).catch(() => null);
      if (stat) files.push({ relative: path.relative(dir, fullPath).split(path.sep).join('/'), size: stat.size, fullPath });
    }
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

async function purgePendingRows(client, storageRoot, graceCutoff) {
  const pending = await client.query(
    `select id, enterprise_id, storage_provider, storage_key, storage_bucket, size_bytes, deleted_at
       from media_assets
      where deleted_at is not null and purged_at is null
        and deleted_at <= $1
      order by id`,
    [graceCutoff],
  );
  const localRows = pending.rows.filter((row) => row.storage_provider === 'local');
  const remoteRows = pending.rows.filter((row) => row.storage_provider !== 'local');
  let purgedCount = 0;
  let purgedBytes = 0;
  let missingCount = 0;
  let failedCount = 0;

  for (const row of localRows) {
    try {
      const objectPath = resolveObjectPath(storageRoot, row.storage_key);
      await fsp.unlink(objectPath).catch((error) => {
        if (error.code === 'ENOENT') {
          missingCount += 1;
          return;
        }
        throw error;
      });
      await client.query('update media_assets set purged_at = now(), purge_error = null, updated_at = now() where id = $1', [row.id]);
      purgedCount += 1;
      purgedBytes += Number(row.size_bytes || 0);
    } catch (error) {
      failedCount += 1;
      await client.query('update media_assets set purge_error = $2, updated_at = now() where id = $1', [row.id, String(error.message || error).slice(0, 500)]);
    }
  }
  return { pendingTotal: pending.rows.length, localCount: localRows.length, remoteCount: remoteRows.length, purgedCount, purgedBytes, missingCount, failedCount, remoteRows };
}

async function classifyStorage(client, storageRoot) {
  const rows = await client.query(
    `select storage_key, storage_provider, deleted_at is not null as deleted, purged_at is not null as purged
       from media_assets
      where storage_provider = 'local'`,
  );
  const keyStates = new Map();
  for (const row of rows.rows) keyStates.set(String(row.storage_key).split('\\').join('/'), { deleted: row.deleted, purged: row.purged });

  const inventory = { active: { count: 0, bytes: 0 }, softDeleted: { count: 0, bytes: 0 }, purgedRow: { count: 0, bytes: 0 }, orphan: { count: 0, bytes: 0 }, healthcheck: { count: 0, bytes: 0 } };
  const orphanFiles = [];
  for (const file of await walkFiles(storageRoot)) {
    if (file.relative === `${RECYCLE_DIR}/manifest.json` || file.relative.startsWith(`${RECYCLE_DIR}/`)) continue;
    if (file.relative.startsWith(HEALTHCHECK_PREFIX)) {
      inventory.healthcheck.count += 1;
      inventory.healthcheck.bytes += file.size;
      continue;
    }
    const state = keyStates.get(file.relative);
    if (!state) {
      inventory.orphan.count += 1;
      inventory.orphan.bytes += file.size;
      orphanFiles.push(file);
    } else if (state.purged) {
      inventory.purgedRow.count += 1;
      inventory.purgedRow.bytes += file.size;
    } else if (state.deleted) {
      inventory.softDeleted.count += 1;
      inventory.softDeleted.bytes += file.size;
    } else {
      inventory.active.count += 1;
      inventory.active.bytes += file.size;
    }
  }
  return { inventory, orphanFiles };
}

async function recycleOrphans(storageRoot, orphanFiles) {
  if (!orphanFiles.length) return { batch: null, moved: 0, bytes: 0 };
  const batch = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const batchDir = path.join(storageRoot, RECYCLE_DIR, batch);
  const manifest = { batch, createdAt: new Date().toISOString(), files: [] };
  let moved = 0;
  let bytes = 0;
  for (const file of orphanFiles) {
    const target = path.join(batchDir, file.relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.rename(file.fullPath, target);
    } catch (error) {
      if (error.code !== 'EXDEV' && error.code !== 'EPERM') throw error;
      await fsp.copyFile(file.fullPath, target);
      await fsp.unlink(file.fullPath);
    }
    manifest.files.push({ key: file.relative, size: file.size });
    moved += 1;
    bytes += file.size;
  }
  await fsp.writeFile(path.join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { batch, moved, bytes };
}

async function main() {
  loadEnvConfig(ADMIN_ROOT);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required for the media purge tool');
  const storageRoot = resolveStorageRoot();

  const pool = new pg.Pool({
    application_name: 'smart-floor-planner-media-purge',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
    statement_timeout: 60_000,
  });
  try {
    const report = { graceDays, storageRoot };
    const client = await pool.connect();
    try {
      await client.query(`
        select set_config('app.current_enterprise_id', '', true),
               set_config('app.is_platform_admin', 'true', true)
      `);
      await client.query('begin');

      const pendingAll = await client.query(
        `select count(*)::text as count, coalesce(sum(size_bytes), 0)::text as bytes
           from media_assets
          where deleted_at is not null and purged_at is null`,
      );
      const pendingEligible = await client.query(
        `select count(*)::text as count, coalesce(sum(size_bytes), 0)::text as bytes
           from media_assets
          where deleted_at is not null and purged_at is null and deleted_at <= $1`,
        [new Date(Date.now() - graceDays * 86_400_000)],
      );
      report.pendingPurge = {
        total: { count: Number(pendingAll.rows[0].count), bytes: Number(pendingAll.rows[0].bytes) },
        eligibleNow: { count: Number(pendingEligible.rows[0].count), bytes: Number(pendingEligible.rows[0].bytes) },
      };

      const { inventory, orphanFiles } = await classifyStorage(client, storageRoot);
      report.storageInventory = inventory;
      report.orphanFiles = orphanFiles.map((file) => ({ key: file.relative, size: file.size }));

      if (APPLY) {
        report.purgeResult = await purgePendingRows(client, storageRoot, new Date(Date.now() - graceDays * 86_400_000));
      }
      if (APPLY_ORPHANS) {
        report.orphanRecycleResult = await recycleOrphans(storageRoot, orphanFiles);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Storage root: ${report.storageRoot}`);
    console.log(`Pending purge: ${report.pendingPurge.total.count} rows / ${formatBytes(report.pendingPurge.total.bytes)} (eligible after ${graceDays}d grace: ${report.pendingPurge.eligibleNow.count} rows / ${formatBytes(report.pendingPurge.eligibleNow.bytes)})`);
    console.log('--- local storage inventory ---');
    for (const [bucket, label] of [['active', 'active (referenced by a live row)'], ['softDeleted', 'soft-deleted (awaiting purge grace)'], ['purgedRow', 'row purged but file still on disk'], ['orphan', 'orphan (no media_assets row)'], ['healthcheck', 'healthcheck probes']]) {
      const bucketValue = report.storageInventory[bucket];
      console.log(`  ${label.padEnd(42)} ${String(bucketValue.count).padStart(5)} files / ${formatBytes(bucketValue.bytes)}`);
    }
    if (report.orphanFiles.length && report.orphanFiles.length <= 20) {
      for (const file of report.orphanFiles) console.log(`    orphan: ${file.key} (${formatBytes(file.size)})`);
    } else if (report.orphanFiles.length) {
      console.log(`    first orphans: ${report.orphanFiles.slice(0, 5).map((file) => `${file.key} (${formatBytes(file.size)})`).join(', ')}`);
    }
    if (report.purgeResult) {
      const result = report.purgeResult;
      console.log(`Purge: deleted ${result.purgedCount} objects / ${formatBytes(result.purgedBytes)}, already gone ${result.missingCount}, failed ${result.failedCount}, remote-provider rows skipped ${result.remoteCount}`);
    }
    if (report.orphanRecycleResult) {
      const result = report.orphanRecycleResult;
      console.log(result.batch ? `Orphans recycled: moved ${result.moved} files / ${formatBytes(result.bytes)} into .purge-recycle/${result.batch}` : 'No orphans to recycle.');
    }
    if (!APPLY && !APPLY_ORPHANS) console.log('Report only. Use --apply to purge eligible soft-deleted objects, --apply-orphans to recycle orphan files.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[media-purge]', error);
  process.exitCode = 1;
});
