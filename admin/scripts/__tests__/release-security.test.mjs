import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

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
  for (const pattern of ['keys', '*.pem', '.env*', 'uploads', '**/*.test.ts', '**/__tests__', 'scripts/**/*acceptance*']) {
    assert.ok(ignore.includes(pattern), pattern);
  }
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /RUN rm -f \.env \.env\.local \.env\.production/);
  assert.doesNotMatch(dockerfile, /COPY .*\.env/);
});

test('local standalone artifact contains no env, key, upload or test files', { skip: !existsSync(path.join(root, '.next/standalone')) }, () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full.replaceAll('\\', '/'));
    }
  };
  walk(path.join(root, '.next/standalone'));
  const forbidden = files.filter((file) =>
    /\/\.env(?:\.|$)/.test(file)
    || /\/keys\//.test(file)
    || /\.pem$/.test(file)
    || /\/uploads\//.test(file)
    || /(?:^|\/)__tests__\//.test(file)
    || /\.test\.(?:ts|mjs|js)$/.test(file)
    || /\/scripts\/.*(?:acceptance|live|fixture)/.test(file));
  assert.deepEqual(forbidden, []);
});
