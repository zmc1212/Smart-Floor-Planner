import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GIB = 1024 ** 3;
const DEFAULT_DEV_MAX_GB = 8;
const DEFAULT_WEBPACK_MAX_GB = 6;

function resolveLimit(envName, fallback, override) {
  const value = override ?? Number(process.env[envName] || fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const targets = (root, { includeWebpack, devMaxGb, webpackMaxGb } = {}) => [
  {
    label: 'Turbopack dev cache',
    path: join(root, '.next', 'dev', 'cache', 'turbopack'),
    maxGb: resolveLimit('NEXT_DEV_CACHE_MAX_GB', DEFAULT_DEV_MAX_GB, devMaxGb),
    included: true,
  },
  {
    label: 'webpack cache',
    path: join(root, '.next', 'cache', 'webpack'),
    maxGb: resolveLimit('NEXT_WEBPACK_MAX_GB', DEFAULT_WEBPACK_MAX_GB, webpackMaxGb),
    included: includeWebpack === true,
  },
];

async function pathInfo(target) {
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isDirectory()) return { bytes: info.size, files: 1 };
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = join(target, entry.name);
    if (entry.isDirectory()) {
      const nested = await pathInfo(child);
      if (nested) {
        bytes += nested.bytes;
        files += nested.files;
      }
    } else if (entry.isFile()) {
      const childInfo = await stat(child);
      bytes += childInfo.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function formatGb(bytes) {
  return `${(bytes / GIB).toFixed(1)}GB`;
}

function isInside(parent, child) {
  const normalizedParent = resolve(parent) + sep;
  return resolve(child).startsWith(normalizedParent);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    force: false,
    includeWebpack: false,
    strict: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--include-webpack') options.includeWebpack = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/prune-next-cache.mjs [options]

Checks regenerable Next.js caches before local development. The dev and build
scripts run this automatically through their pre-hooks.

Options:
  --dry-run           Report cache size and pruning decision without deleting.
  --force             Delete selected caches regardless of size.
  --include-webpack   Also check the webpack dev/build cache.
  --strict            Exit non-zero when a cache cannot be inspected or removed.
  --help              Show this help.

Thresholds:
  NEXT_DEV_CACHE_MAX_GB       Turbopack dev cache limit (default: ${DEFAULT_DEV_MAX_GB}GB)
  NEXT_WEBPACK_CACHE_MAX_GB   webpack cache limit (default: ${DEFAULT_WEBPACK_MAX_GB}GB)
`);
}

export async function pruneNextCaches({
  root = adminRoot,
  dryRun = false,
  force = false,
  includeWebpack = false,
  strict = false,
  devMaxGb,
  webpackMaxGb,
  log = console.log,
  warn = console.warn,
} = {}) {
  const nextRoot = join(root, '.next');
  const results = [];
  for (const target of targets(root, { includeWebpack, devMaxGb, webpackMaxGb })) {
    if (!target.included) continue;
    if (!isInside(nextRoot, target.path)) {
      throw new Error(`Refusing to prune outside .next: ${target.path}`);
    }
    const info = await pathInfo(target.path);
    if (!info) {
      results.push({ ...target, action: 'absent', bytes: 0, files: 0 });
      if (dryRun) log(`[next-cache] ${target.label}: absent`);
      continue;
    }
    const limit = target.maxGb * GIB;
    const shouldPrune = force || info.bytes > limit;
    if (!shouldPrune) {
      results.push({ ...target, action: 'kept', bytes: info.bytes, files: info.files });
      if (dryRun) {
        log(`[next-cache] ${target.label}: ${formatGb(info.bytes)} (${info.files} files), limit ${formatGb(limit)}, kept`);
      }
      continue;
    }
    if (dryRun) {
      results.push({ ...target, action: 'would-prune', bytes: info.bytes, files: info.files });
      log(`[next-cache] ${target.label}: ${formatGb(info.bytes)} (${info.files} files) exceeds ${formatGb(limit)}; would remove`);
      continue;
    }
    try {
      await rm(target.path, { recursive: true, force: true, maxRetries: 2 });
      results.push({ ...target, action: 'pruned', bytes: info.bytes, files: info.files });
      log(`[next-cache] ${target.label}: removed ${formatGb(info.bytes)} (${info.files} files), next start rebuilds it`);
    } catch (error) {
      results.push({ ...target, action: 'failed', bytes: info.bytes, files: info.files, error });
      const message = `[next-cache] ${target.label}: cleanup failed: ${error.message}`;
      if (strict) throw new Error(message, { cause: error });
      warn(message);
    }
  }
  return results;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  try {
    await pruneNextCaches(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
