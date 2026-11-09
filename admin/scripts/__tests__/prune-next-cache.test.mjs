import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneNextCaches } from '../prune-next-cache.mjs';

const silent = { log: () => {}, warn: () => {} };

async function createRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'next-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function seedCache(root, relativePath, bytes = 128) {
  const dir = join(root, '.next', ...relativePath.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'segment.sst'), Buffer.alloc(bytes));
  return dir;
}

test('keeps a dev cache below its limit', async t => {
  const root = await createRoot(t);
  const cache = await seedCache(root, 'dev/cache/turbopack');

  const [result] = await pruneNextCaches({ root, devMaxGb: 0.001, ...silent });

  assert.equal(result.action, 'kept');
  assert.equal(result.bytes, 128);
  assert.ok(existsSync(cache));
});

test('prunes an oversized dev cache and leaves webpack alone by default', async t => {
  const root = await createRoot(t);
  const devCache = await seedCache(root, 'dev/cache/turbopack');
  const webpackCache = await seedCache(root, 'cache/webpack');

  const results = await pruneNextCaches({ root, devMaxGb: 0, ...silent });

  assert.equal(results.length, 1);
  assert.equal(results[0].action, 'pruned');
  assert.equal(existsSync(devCache), false);
  assert.ok(existsSync(webpackCache));
});

test('dry run reports an oversized cache without deleting it', async t => {
  const root = await createRoot(t);
  const cache = await seedCache(root, 'dev/cache/turbopack');

  const [result] = await pruneNextCaches({ root, dryRun: true, devMaxGb: 0, ...silent });

  assert.equal(result.action, 'would-prune');
  assert.ok(existsSync(cache));
});

test('includeWebpack applies the webpack threshold', async t => {
  const root = await createRoot(t);
  const webpackCache = await seedCache(root, 'cache/webpack');

  const results = await pruneNextCaches({
    root,
    includeWebpack: true,
    webpackMaxGb: 0,
    ...silent,
  });

  const webpack = results.find(result => result.label === 'webpack cache');
  assert.equal(webpack.action, 'pruned');
  assert.equal(existsSync(webpackCache), false);
});

test('force prunes a cache below its limit', async t => {
  const root = await createRoot(t);
  const cache = await seedCache(root, 'dev/cache/turbopack');

  const [result] = await pruneNextCaches({ root, force: true, ...silent });

  assert.equal(result.action, 'pruned');
  assert.equal(existsSync(cache), false);
});

test('treats a missing cache as a no-op', async t => {
  const root = await createRoot(t);

  const [result] = await pruneNextCaches({ root, ...silent });

  assert.equal(result.action, 'absent');
  assert.equal(result.bytes, 0);
});
