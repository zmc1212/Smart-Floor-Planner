import crypto from 'crypto';
import path from 'path';
import { createReadStream, promises as fs } from 'fs';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { AiPromptImportRun } from '../src/models/AiPromptImportRun';
import {
  normalizePromptLibrarySnapshot,
  isSuccessfulPromptSourceStatusCode,
  paginateSourceRecords,
  sanitizeImportError,
  sha256Value,
  validatePromptLibrary,
} from '../src/lib/ai/prompt-library';
import {
  createPromptLibraryRevisionIdentity,
  importPromptLibraryRevision,
  rollbackPromptLibraryRevision,
} from '../src/lib/ai/prompt-library-import';
import type {
  PromptLibrarySnapshot,
  SourceRecord,
  StagedPromptAsset,
} from '../src/lib/ai/prompt-library-types';

loadEnvConfig(process.cwd());
sharp.cache(false);

const SOURCE_ORIGIN = 'https://roomi.banjiajia.com';
const SOURCE_API_BASE = `${SOURCE_ORIGIN}/ai-api`;
const STAGING_ROOT = path.resolve(process.cwd(), '.roomi-import');
const REQUEST_TIMEOUT_MS = 30_000;

const COLLECTIONS = {
  categories: { path: '/account-api/getModelPromptCategoryList', pageSize: 200 },
  templates: { path: '/account-api/getModelPromptList', pageSize: 200 },
  parameterTemplates: { path: '/account-api/getModelParamTemplateList', pageSize: 100 },
  models: { path: '/account-api/getModelList', pageSize: 100 },
} as const;

type CollectionName = keyof typeof COLLECTIONS;

function parseArgs(argv: string[]) {
  const execute = argv.includes('--execute');
  const sourceFileArg = argv.find((arg) => arg.startsWith('--source-file='));
  const rollbackArg = argv.find((arg) => arg.startsWith('--rollback='));
  return {
    execute,
    sourceFile: sourceFileArg ? path.resolve(process.cwd(), sourceFileArg.slice('--source-file='.length)) : undefined,
    rollbackRevisionId: rollbackArg?.slice('--rollback='.length),
  };
}

function requestHeaders(targetUrl: string) {
  const authorization = process.env.ROOMI_IMPORT_AUTHORIZATION?.trim();
  const cookie = process.env.ROOMI_IMPORT_COOKIE?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (new URL(targetUrl).origin === SOURCE_ORIGIN) {
    if (authorization) headers.Authorization = authorization;
    if (cookie) headers.Cookie = cookie;
  }
  return headers;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function ensureSuccessfulEnvelope(payload: unknown, endpoint: string) {
  if (!payload || typeof payload !== 'object') throw new Error(`${endpoint}: invalid JSON response`);
  const envelope = payload as Record<string, unknown>;
  const statusCode = Number(envelope.statusCode ?? 200);
  if (!isSuccessfulPromptSourceStatusCode(statusCode)) {
    throw new Error(`${endpoint}: source rejected request (${statusCode}) ${String(envelope.statusMsg || '')}`.trim());
  }
}

async function fetchCollection(name: CollectionName) {
  const config = COLLECTIONS[name];
  const endpoint = `${SOURCE_API_BASE}${config.path}`;
  const pages: unknown[] = [];
  const result = await paginateSourceRecords({
    pageSize: config.pageSize,
    fetchPage: async (pageNo, pageSize) => {
      const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: requestHeaders(endpoint),
        body: JSON.stringify({
          pageNo,
          pageSize,
          ...(name === 'templates' ? { orderByColumn: 'weight', isAsc: 'descending' } : {}),
        }),
      });
      const payload = await response.json();
      ensureSuccessfulEnvelope(payload, config.path);
      pages.push(payload);
      return payload;
    },
  });
  return { ...result, pages };
}

function readSnapshotShape(value: unknown): PromptLibrarySnapshot {
  if (!value || typeof value !== 'object') throw new Error('Source file must contain a JSON object');
  const root = value as Record<string, unknown>;
  const snapshot = (root.snapshot && typeof root.snapshot === 'object' ? root.snapshot : root) as Record<string, unknown>;
  const requireArray = (key: string, aliases: string[] = []) => {
    const found = [key, ...aliases].map((candidate) => snapshot[candidate]).find(Array.isArray);
    if (!found) throw new Error(`Source file is missing array: ${key}`);
    return found as SourceRecord[];
  };
  return {
    categories: requireArray('categories'),
    templates: requireArray('templates'),
    parameterTemplates: requireArray('parameterTemplates', ['paramTemplates']),
    models: requireArray('models'),
  };
}

async function acquireSnapshot(sourceFile?: string) {
  if (sourceFile) {
    const raw = await fs.readFile(sourceFile, 'utf8');
    return { snapshot: readSnapshotShape(JSON.parse(raw)), rawPages: undefined };
  }
  if (!process.env.ROOMI_IMPORT_AUTHORIZATION?.trim()) {
    throw new Error('ROOMI_IMPORT_AUTHORIZATION is required for live import');
  }
  const entries = await Promise.all(
    (Object.keys(COLLECTIONS) as CollectionName[]).map(async (name) => [name, await fetchCollection(name)] as const)
  );
  const fetched = Object.fromEntries(entries) as Record<CollectionName, Awaited<ReturnType<typeof fetchCollection>>>;
  return {
    snapshot: {
      categories: fetched.categories.records,
      templates: fetched.templates.records,
      parameterTemplates: fetched.parameterTemplates.records,
      models: fetched.models.records,
    },
    rawPages: Object.fromEntries(entries.map(([name, value]) => [name, value.pages])),
  };
}

function mimeForSharpFormat(format?: string) {
  if (format === 'jpeg') return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (format === 'png') return { mimeType: 'image/png', extension: 'png' };
  if (format === 'webp') return { mimeType: 'image/webp', extension: 'webp' };
  if (format === 'gif') return { mimeType: 'image/gif', extension: 'gif' };
  if (format === 'avif' || format === 'heif') return { mimeType: 'image/avif', extension: 'avif' };
  throw new Error(`Unsupported image format: ${format || 'unknown'}`);
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function stagePreviewAssets(input: {
  templates: ReturnType<typeof normalizePromptLibrarySnapshot>['templates'];
  stagingDirectory: string;
}) {
  const assetDirectory = path.join(input.stagingDirectory, 'assets');
  const indexPath = path.join(assetDirectory, 'index.json');
  await fs.mkdir(assetDirectory, { recursive: true });
  let cached: StagedPromptAsset[] = [];
  try {
    cached = JSON.parse(await fs.readFile(indexPath, 'utf8')) as StagedPromptAsset[];
  } catch {
    cached = [];
  }
  const cacheByTemplate = new Map(cached.map((item) => [item.templateSourceId, item]));
  const staged: StagedPromptAsset[] = [];

  for (const template of input.templates) {
    if (!template.previewSourceUrl) continue;
    const cachedAsset = cacheByTemplate.get(template.sourceId);
    if (cachedAsset) {
      try {
        const checksum = await sha256File(cachedAsset.filePath);
        if (checksum === cachedAsset.checksumSha256) {
          staged.push(cachedAsset);
          continue;
        }
      } catch {
        // Download again below.
      }
    }

    const url = new URL(template.previewSourceUrl, SOURCE_ORIGIN).toString();
    const response = await fetchWithRetry(url, { method: 'GET', headers: requestHeaders(url) });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error(`template ${template.sourceId}: empty preview image`);
    const metadata = await sharp(buffer).metadata();
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (!(width > 0 && height > 0)) throw new Error(`template ${template.sourceId}: preview dimensions are missing`);
    const actual = mimeForSharpFormat(metadata.format);
    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeId = template.sourceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'template';
    const filePath = path.join(assetDirectory, `${safeId}-${checksumSha256.slice(0, 12)}.${actual.extension}`);
    await fs.writeFile(filePath, buffer);
    const asset: StagedPromptAsset = {
      templateSourceId: template.sourceId,
      sourceUrl: url,
      filePath,
      mimeType: actual.mimeType,
      extension: actual.extension,
      size: buffer.length,
      width,
      height,
      checksumSha256,
    };
    staged.push(asset);
    await fs.writeFile(indexPath, `${JSON.stringify(staged, null, 2)}\n`, 'utf8');
  }
  await fs.writeFile(indexPath, `${JSON.stringify(staged, null, 2)}\n`, 'utf8');
  return staged;
}

async function saveSnapshot(input: {
  stagingDirectory: string;
  snapshot: PromptLibrarySnapshot;
  rawPages?: Record<string, unknown>;
}) {
  await fs.mkdir(input.stagingDirectory, { recursive: true });
  await fs.writeFile(path.join(input.stagingDirectory, 'snapshot.json'), `${JSON.stringify(input.snapshot, null, 2)}\n`, 'utf8');
  if (input.rawPages) {
    const rawDirectory = path.join(input.stagingDirectory, 'raw');
    await fs.mkdir(rawDirectory, { recursive: true });
    await Promise.all(Object.entries(input.rawPages).map(([name, pages]) =>
      fs.writeFile(path.join(rawDirectory, `${name}.json`), `${JSON.stringify(pages, null, 2)}\n`, 'utf8')
    ));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rollbackRevisionId) {
    if (!args.execute) throw new Error('--rollback requires --execute');
    const { default: dbConnect } = await import('../src/lib/mongodb');
    await dbConnect();
    const revision = await rollbackPromptLibraryRevision(args.rollbackRevisionId);
    console.log(JSON.stringify({ success: true, rollback: String(revision._id), revisionKey: revision.revisionKey }, null, 2));
    return;
  }

  const acquired = await acquireSnapshot(args.sourceFile);
  const snapshotHash = sha256Value(acquired.snapshot);
  const stagingDirectory = path.join(STAGING_ROOT, snapshotHash.slice(0, 16));
  await saveSnapshot({ stagingDirectory, snapshot: acquired.snapshot, rawPages: acquired.rawPages });
  const library = normalizePromptLibrarySnapshot(acquired.snapshot);
  const assets = await stagePreviewAssets({ templates: library.templates, stagingDirectory });
  const validation = validatePromptLibrary(library, assets);
  const identity = createPromptLibraryRevisionIdentity(library, assets);
  const manifest = {
    source: 'roomi',
    createdAt: new Date().toISOString(),
    dryRun: !args.execute,
    sourceMode: args.sourceFile ? 'source_file' : 'live',
    sourceFile: args.sourceFile,
    snapshotHash,
    revisionKey: identity.revisionKey,
    manifestHash: identity.manifestHash,
    contentHash: identity.contentHash,
    counts: validation.counts,
    sourceCounts: {
      categories: acquired.snapshot.categories.length,
      templates: acquired.snapshot.templates.length,
      parameterTemplates: acquired.snapshot.parameterTemplates.length,
      models: acquired.snapshot.models.length,
    },
    skippedTemplates: library.skippedTemplates,
    mediaProvider: 'local',
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
  };
  const manifestPath = path.join(stagingDirectory, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (!validation.valid) throw new Error(`Validation failed:\n${validation.errors.join('\n')}`);

  if (!args.execute) {
    console.log(JSON.stringify({ success: true, mode: 'dry-run', manifestPath, ...manifest }, null, 2));
    return;
  }

  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  await AiPromptImportRun.updateMany(
    { status: 'running' },
    {
      $set: { status: 'failed', completedAt: new Date() },
      $push: { errorMessages: 'Import process was interrupted before completion' },
    }
  );
  const run = await AiPromptImportRun.create({
    source: 'roomi',
    mode: args.sourceFile ? 'source_file' : 'live',
    execute: true,
    status: 'running',
    sourceFile: args.sourceFile,
    authorization: {
      authorizationProvided: Boolean(process.env.ROOMI_IMPORT_AUTHORIZATION?.trim()),
      cookieProvided: Boolean(process.env.ROOMI_IMPORT_COOKIE?.trim()),
      persistedSecrets: false,
    },
    statistics: { ...validation.counts, warningCount: validation.warnings.length },
    errorMessages: [],
    startedAt: new Date(),
  });
  try {
    let lastReportedAssetCount = 0;
    const imported = await importPromptLibraryRevision({
      library,
      assets,
      snapshotPath: manifestPath,
      mediaProviderKey: 'local',
      onAssetProgress: (completed, total) => {
        if (completed === total || completed - lastReportedAssetCount >= 25) {
          lastReportedAssetCount = completed;
          console.log(`[Prompt Library Import] media ${completed}/${total}`);
        }
      },
    });
    run.status = 'succeeded';
    run.revisionId = imported.revision._id;
    run.statistics = { ...validation.counts, warningCount: validation.warnings.length, idempotent: imported.idempotent };
    run.completedAt = new Date();
    await run.save();
    console.log(JSON.stringify({
      success: true,
      mode: 'execute',
      revisionId: String(imported.revision._id),
      revisionKey: imported.revision.revisionKey,
      idempotent: imported.idempotent,
      counts: validation.counts,
      manifestPath,
    }, null, 2));
  } catch (error) {
    const message = sanitizeImportError(error, [
      process.env.ROOMI_IMPORT_AUTHORIZATION,
      process.env.ROOMI_IMPORT_COOKIE,
    ]);
    run.status = 'failed';
    run.errorMessages = [message];
    run.completedAt = new Date();
    await run.save();
    throw new Error(message);
  }
}

main().catch(async (error) => {
  const message = sanitizeImportError(error, [
    process.env.ROOMI_IMPORT_AUTHORIZATION,
    process.env.ROOMI_IMPORT_COOKIE,
  ]);
  console.error(`[Prompt Library Import] ${message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
}).then(async () => {
  await mongoose.disconnect().catch(() => undefined);
});
