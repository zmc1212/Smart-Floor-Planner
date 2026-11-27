import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifact = path.resolve(root, process.env.NEXT_DIST_DIR || '.next', 'standalone');

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

test('compose shares one worker health file and keeps database credentials overridable', () => {
  const compose = read('docker-compose.yml');
  assert.equal((compose.match(/ASSISTANT_WORKER_HEALTH_FILE=\/shared\/assistant-worker-health\.json/g) || []).length, 2);
  assert.equal((compose.match(/assistant_health:\/shared/g) || []).length, 2);
  assert.match(compose, /DATABASE_URL=\$\{DATABASE_URL:-/);
  assert.match(compose, /DATABASE_MIGRATION_URL=\$\{DATABASE_MIGRATION_URL:-/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:-/);
});

test('docker ignore and runtime image exclude keys, env files, uploads and test scripts', () => {
  const ignore = read('.dockerignore');
  for (const pattern of ['keys', '*.pem', '.env*', 'uploads', '**/*.test.ts', '**/__tests__', 'scripts/**/*.test.mjs']) {
    assert.ok(ignore.includes(pattern), pattern);
  }
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /RUN rm -f \.env \.env\.local \.env\.production/);
  assert.doesNotMatch(dockerfile, /COPY .*\.env/);
});

test('runtime image copies only staged scripts after removing the traced scripts directory', () => {
  const dockerfile = read('Dockerfile');
  const [builder, runner] = dockerfile.split(/^FROM .+ AS runner\r?$/m);
  const staging = builder.match(/RUN mkdir -p \/app\/runtime-scripts[\s\S]+?\/app\/runtime-scripts\//)?.[0] ?? '';
  assert.match(builder, /^RUN rm -rf \/app\/\.next\/standalone\/scripts\r?$/m);
  assert.match(staging, /\/app\/scripts\/postgres-migrate\.mjs/);
  assert.doesNotMatch(staging, /(?:acceptance|postgres-contract-tests)/);
  assert.match(runner, /^COPY --from=builder \/app\/runtime-scripts \.\/scripts\r?$/m);
  assert.doesNotMatch(runner, /^COPY --from=builder \/app\/scripts(?:\/|\s)/m);
});

test('postbuild removes copied env files from the configured standalone output and app subdirectory', t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'sfp-release-test-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const output = path.join(workspace, 'custom-build', 'standalone');
  const app = path.join(output, 'packages', 'admin');
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(workspace, 'custom-build', 'required-server-files.json'),
    JSON.stringify({ relativeAppDir: 'packages/admin' }));
  const copiedEnv = path.join(output, '.env.production');
  const appEnv = path.join(app, '.env');
  const runtime = path.join(app, 'server.js');
  writeFileSync(copiedEnv, 'SYNTHETIC_BUILD_TEST=1');
  writeFileSync(appEnv, 'SYNTHETIC_BUILD_TEST=1');
  writeFileSync(runtime, '/* synthetic */');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'prune-standalone-env.mjs')], {
    cwd: workspace,
    env: { ...process.env, NEXT_DIST_DIR: 'custom-build' },
  });
  assert.equal(existsSync(copiedEnv), false);
  assert.equal(existsSync(appEnv), false);
  assert.equal(existsSync(runtime), true);
});

test('local standalone artifact contains no env, key, upload or test files', { skip: !existsSync(artifact) }, () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full.replaceAll('\\', '/'));
    }
  };
  walk(artifact);
  const forbidden = files.filter((file) =>
    /\/\.env(?:\.|$)/.test(file)
    || /\/keys\//.test(file)
    || /\.pem$/.test(file)
    || /\/uploads\//.test(file)
    || /(?:^|\/)__tests__\//.test(file)
    || /\.test\.(?:ts|mjs|js)$/.test(file)
    || /\/scripts\/.*(?:acceptance|live|fixture)/.test(file));
  assert.equal(forbidden.length, 0, 'Standalone output includes files excluded from releases');
});
