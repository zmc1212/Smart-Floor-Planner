#!/usr/bin/env node
/**
 * design-references recycling tool.
 *
 * `design-references/` is a git-ignored working area for design proposals and
 * QA captures. Files referenced from repository docs (the Mini Program design
 * restoration ledger, icon-source license notes, module docs, brand guidelines,
 * source-code comments) are the durable set and are protected automatically:
 * the protection list is rebuilt on every run by scanning repository text
 * files, so it never needs manual maintenance.
 *
 * Everything else becomes a recycle candidate once it is older than --min-age
 * days (default 30). Recycled files move to `design-references/.recycle/<batch>/`
 * preserving their relative layout, and can be restored or purged later.
 *
 * Usage:
 *   node scripts/cleanup-design-references.mjs                 dry-run report
 *   node scripts/cleanup-design-references.mjs --json          machine-readable dry run
 *   node scripts/cleanup-design-references.mjs --apply         move candidates into .recycle/<batch>
 *   node scripts/cleanup-design-references.mjs --restore <batch>
 *   node scripts/cleanup-design-references.mjs --purge [--purge-older-than 30]
 *
 * Options:
 *   --min-age <days>          candidate age threshold (default 30)
 *   --purge-older-than <days> recycle batch age threshold for --purge (default 30)
 *   --apply, --json, --restore <batch>, --purge
 *
 * Runtime AI design output must never be written into design-references/; it
 * belongs to the admin media storage (uploads/ai-assets) with its own purge
 * pipeline (admin/scripts/media-purge.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DR = path.join(ROOT, 'design-references');
const RECYCLE = path.join(DR, '.recycle');
const PREFIX = 'design-references/';

const TEXT_EXTENSIONS = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.less', '.txt', '.html',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'design-references', '.zcode', 'tmp', 'scratch',
  'output', '.tmp', '.codex-tmp', 'videos', '.impeccable', '.history', 'uploads',
  'dist', 'build', 'coverage', '.playwright-cli', '.superpowers',
  '.codex-remote-attachments', '.multica', '.agent_context',
]);

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
const APPLY = args.includes('--apply');
const JSON_MODE = args.includes('--json');
const PURGE = args.includes('--purge');
const RESTORE_BATCH = argValue('--restore');
const MIN_AGE_DAYS = Number(argValue('--min-age') ?? 30);
const PURGE_OLDER_THAN_DAYS = Number(argValue('--purge-older-than') ?? 30);

function walkFiles(dir, visitor, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('node_modules')) continue;
      walkFiles(fullPath, visitor, depth + 1);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

/** Rebuild the protected-path set from repository text files. */
function buildProtectedPaths() {
  const protectedPaths = new Set();
  const referencePattern = /design-references\/[^\s)"'`<>]+/g;
  walkFiles(ROOT, (filePath) => {
    if (!TEXT_EXTENSIONS.has(path.extname(filePath))) return;
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    for (const match of content.matchAll(referencePattern)) {
      const normalized = match[0]
        .replace(/\\/g, '/')
        .replace(/[/.,;:)\]>*}'"]+$/, '');
      if (normalized.length > PREFIX.length) protectedPaths.add(normalized);
    }
  });
  return protectedPaths;
}

function isProtected(relPath, protectedPaths) {
  if (protectedPaths.has(relPath)) return true;
  for (const protectedPath of protectedPaths) {
    if (relPath.startsWith(`${protectedPath}/`)) return true;
  }
  return false;
}

function listCandidates(protectedPaths, minAgeMs) {
  const candidates = [];
  const keptRecent = [];
  let protectedCount = 0;
  let protectedBytes = 0;
  const now = Date.now();
  walkFiles(DR, (filePath) => {
    const relToDr = path.relative(DR, filePath);
    if (relToDr.split(path.sep)[0] === '.recycle') return;
    const relPath = path.relative(ROOT, filePath).split(path.sep).join('/');
    if (relPath.startsWith('.recycle/')) return;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (isProtected(relPath, protectedPaths)) {
      protectedCount += 1;
      protectedBytes += stat.size;
      return;
    }
    const entry = {
      path: relPath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ageDays: Math.floor((now - stat.mtimeMs) / 86_400_000),
    };
    if (now - stat.mtimeMs > minAgeMs) {
      candidates.push(entry);
    } else {
      keptRecent.push(entry);
    }
  });
  candidates.sort((a, b) => b.size - a.size);
  return { candidates, keptRecent, protectedCount, protectedBytes };
}

function moveFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM') throw error;
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
}

function pruneEmptyDirs(dir) {
  if (dir === RECYCLE || !fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
  }
  try {
    const remaining = fs.readdirSync(dir);
    const onlyRecycle = remaining.length === 1 && remaining[0] === '.recycle';
    if (remaining.length === 0 || (onlyRecycle && dir === DR)) {
      if (dir !== DR) fs.rmdirSync(dir);
    }
  } catch {
    // leave the directory in place on races
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function summarize(entries) {
  const byTopDir = new Map();
  for (const entry of entries) {
    const topDir = entry.path.slice(PREFIX.length).split('/')[0];
    const bucket = byTopDir.get(topDir) ?? { count: 0, bytes: 0 };
    bucket.count += 1;
    bucket.bytes += entry.size;
    byTopDir.set(topDir, bucket);
  }
  return [...byTopDir.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
}

function applyBatch(candidates) {
  if (!candidates.length) {
    console.log('No recycle candidates; nothing to move.');
    return;
  }
  const batchName = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const batchDir = path.join(RECYCLE, batchName);
  const manifest = {
    batch: batchName,
    createdAt: new Date().toISOString(),
    minAgeDays: MIN_AGE_DAYS,
    protectedPathsProbe: 'rebuilt on restore from current repository state',
    files: [],
  };
  let movedBytes = 0;
  let failures = 0;
  for (const candidate of candidates) {
    const source = path.join(ROOT, candidate.path);
    const target = path.join(batchDir, candidate.path.slice(PREFIX.length));
    try {
      moveFile(source, target);
      manifest.files.push({ path: candidate.path, size: candidate.size, mtime: candidate.mtime });
      movedBytes += candidate.size;
    } catch (error) {
      failures += 1;
      console.error(`FAILED to move ${candidate.path}: ${error.message}`);
    }
  }
  fs.writeFileSync(path.join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  pruneEmptyDirs(DR);
  console.log(`Batch ${batchName}: moved ${manifest.files.length} files / ${formatBytes(movedBytes)} into .recycle/${batchName}`);
  if (failures) console.error(`${failures} files failed to move; they remain in place.`);
}

function restoreBatch(batchName) {
  const batchDir = path.join(RECYCLE, batchName);
  const manifestPath = path.join(batchDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Unknown batch: ${batchName}`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let restored = 0;
  let skipped = 0;
  for (const file of manifest.files) {
    const source = path.join(batchDir, file.path.slice(PREFIX.length));
    const target = path.join(ROOT, file.path);
    if (!fs.existsSync(source)) {
      skipped += 1;
      continue;
    }
    if (fs.existsSync(target)) {
      skipped += 1;
      continue;
    }
    moveFile(source, target);
    restored += 1;
  }
  if (fs.existsSync(batchDir) && fs.readdirSync(batchDir).length === 0) {
    fs.rmdirSync(batchDir);
  }
  console.log(`Batch ${batchName}: restored ${restored} files, skipped ${skipped} (missing or already present).`);
}

function purgeBatches() {
  if (!fs.existsSync(RECYCLE)) {
    console.log('No recycle area; nothing to purge.');
    return;
  }
  const cutoff = Date.now() - PURGE_OLDER_THAN_DAYS * 86_400_000;
  let purgedBatches = 0;
  let purgedBytes = 0;
  for (const entry of fs.readdirSync(RECYCLE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const batchDir = path.join(RECYCLE, entry.name);
    let createdAt = fs.statSync(batchDir).mtimeMs;
    const manifestPath = path.join(batchDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        createdAt = Date.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).createdAt) || createdAt;
      } catch {
        // fall back to directory mtime
      }
    }
    if (createdAt > cutoff) continue;
    purgedBytes += walkBatchSize(batchDir);
    fs.rmSync(batchDir, { recursive: true, force: true });
    purgedBatches += 1;
  }
  console.log(`Purged ${purgedBatches} batch(es) / ${formatBytes(purgedBytes)} older than ${PURGE_OLDER_THAN_DAYS} days.`);
}

function walkBatchSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) total += walkBatchSize(fullPath);
    else {
      try {
        total += fs.statSync(fullPath).size;
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return total;
}

if (PURGE) {
  purgeBatches();
} else if (RESTORE_BATCH) {
  restoreBatch(RESTORE_BATCH);
} else {
  const protectedPaths = buildProtectedPaths();
  const { candidates, keptRecent, protectedCount, protectedBytes } = listCandidates(protectedPaths, MIN_AGE_DAYS * 86_400_000);
  const candidateBytes = candidates.reduce((sum, entry) => sum + entry.size, 0);

  if (JSON_MODE) {
    console.log(JSON.stringify({
      minAgeDays: MIN_AGE_DAYS,
      protectedCount,
      protectedBytes,
      candidateCount: candidates.length,
      candidateBytes,
      keptRecentCount: keptRecent.length,
      keptRecentBytes: keptRecent.reduce((sum, entry) => sum + entry.size, 0),
      candidates,
    }, null, 2));
  } else {
    console.log(`Protected (referenced by repository docs): ${protectedCount} files / ${formatBytes(protectedBytes)}`);
    console.log(`Recycle candidates (unreferenced, older than ${MIN_AGE_DAYS}d): ${candidates.length} files / ${formatBytes(candidateBytes)}`);
    console.log(`Kept (unreferenced but recent): ${keptRecent.length} files / ${formatBytes(keptRecent.reduce((sum, entry) => sum + entry.size, 0))}`);
    console.log('--- candidates by top-level directory ---');
    for (const [topDir, bucket] of summarize(candidates)) {
      console.log(`  ${formatBytes(bucket.bytes).padStart(9)}  ${String(bucket.count).padStart(4)}  ${topDir}`);
    }
    if (!APPLY) {
      console.log('Dry run. Re-run with --apply to move these files into design-references/.recycle/.');
    }
  }
  if (APPLY) applyBatch(candidates);
}
