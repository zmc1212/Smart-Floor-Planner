import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  PREVIOUS_SUFFIX,
  SELF_OWNED_SECRETS,
  classifySecretValue,
  evaluateAclEntries,
  findDuplicateGroups,
  isInsideRepository,
  mergeEnvText,
  parseEnvText,
  parseIcaclsOutput,
  planSecrets,
  runBootstrap,
} from '../bootstrap-secrets.mjs';

const VALID = {
  JWT_SECRET: 'j'.repeat(64),
  INTERNAL_SECRET: 'i'.repeat(64),
  AI_PROVIDER_KEY_ENCRYPTION_SECRET: 'a'.repeat(64),
  MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'm'.repeat(64),
  CRON_SECRET: 'c'.repeat(64),
};

function fakeGenerator() {
  let index = 0;
  return () => `${String(index++).padStart(4, '0')}${'A'.repeat(60)}`;
}

async function withTempDir(label, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `sfp-secrets-${label}-`));
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function gitNotTracked(command, args) {
  if (args.includes('--error-unmatch')) {
    const error = new Error('not tracked');
    error.status = 1;
    throw error;
  }
  return '';
}
function gitTracked() {
  return '';
}
function gitNotIgnored() {
  const error = new Error('not ignored');
  error.status = 1;
  throw error;
}

test('empty env generates five independent 64-character secrets', () => {
  const plan = planSecrets(new Map(), { generate: fakeGenerator() });
  assert.equal(plan.writes.length, SELF_OWNED_SECRETS.length);
  assert.equal(plan.previousWrites.length, 0);
  assert.equal(plan.changed, true);
  const values = plan.writes.map((entry) => entry.value);
  assert.equal(new Set(values).size, values.length);
  for (const value of values) assert.equal(value.length, 64);
  for (const entry of plan.entries) {
    assert.equal(entry.status, 'generated');
    assert.equal(entry.length, 64);
  }
  assert.deepEqual(plan.duplicates, []);
});

test('valid secrets are kept and repeated planning is a no-op', () => {
  const env = new Map(Object.entries(VALID));
  const plan = planSecrets(env, { generate: fakeGenerator() });
  assert.equal(plan.changed, false);
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.previousWrites.length, 0);
  for (const entry of plan.entries) assert.equal(entry.status, 'valid');
});

test('placeholder values rotate and keep the previous value readable', () => {
  const env = new Map(Object.entries({
    JWT_SECRET: 'your_jwt_secret_here',
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'replace_with_a_long_random_secret',
    CRON_SECRET: 'c'.repeat(64),
  }));
  const plan = planSecrets(env, { generate: fakeGenerator() });
  const jwt = plan.entries.find((entry) => entry.name === 'JWT_SECRET');
  assert.equal(jwt.status, 'rotated');
  assert.equal(jwt.reason, 'placeholder');
  assert.ok(plan.previousWrites.some((entry) => entry.name === `JWT_SECRET${PREVIOUS_SUFFIX}`
    && entry.value === 'your_jwt_secret_here'));
  assert.ok(plan.previousWrites.some((entry) => entry.name === `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET${PREVIOUS_SUFFIX}`));
  assert.equal(plan.entries.find((entry) => entry.name === 'CRON_SECRET').status, 'valid');
  assert.equal(plan.entries.find((entry) => entry.name === 'AI_PROVIDER_KEY_ENCRYPTION_SECRET').status, 'generated');
});

test('an occupied previous slot blocks rotation instead of losing ciphertext access', () => {
  const env = new Map(Object.entries({
    ...VALID,
    JWT_SECRET: 'short',
    [`JWT_SECRET${PREVIOUS_SUFFIX}`]: 'older-secret',
  }));
  const plan = planSecrets(env, { generate: fakeGenerator() });
  const jwt = plan.entries.find((entry) => entry.name === 'JWT_SECRET');
  assert.equal(jwt.status, 'blocked');
  assert.equal(jwt.reason, 'previous_secret_already_present');
  assert.equal(plan.blocked.includes('JWT_SECRET'), true);
});

test('duplicate secrets are separated without retiring the JWT anchor', () => {
  const shared = 'd'.repeat(64);
  const env = new Map(Object.entries({
    ...VALID,
    JWT_SECRET: shared,
    AI_PROVIDER_KEY_ENCRYPTION_SECRET: shared,
  }));
  const plan = planSecrets(env, { generate: fakeGenerator() });
  const ai = plan.entries.find((entry) => entry.name === 'AI_PROVIDER_KEY_ENCRYPTION_SECRET');
  assert.equal(ai.status, 'rotated');
  assert.equal(ai.reason, 'duplicate_secret');
  assert.equal(plan.entries.find((entry) => entry.name === 'JWT_SECRET').status, 'valid');
  assert.ok(plan.previousWrites.some((entry) => entry.name === `AI_PROVIDER_KEY_ENCRYPTION_SECRET${PREVIOUS_SUFFIX}`));
  assert.deepEqual(plan.duplicates, []);
});

test('duplicate detection ignores missing values', () => {
  assert.deepEqual(findDuplicateGroups(new Map([['JWT_SECRET', 'x'], ['CRON_SECRET', '']])), []);
});

test('third-party credentials are pending and never generated', () => {
  const plan = planSecrets(new Map(), { generate: fakeGenerator() });
  const pending = plan.thirdParty.filter((entry) => entry.status === 'pending').map((entry) => entry.name);
  assert.ok(pending.includes('ASSISTANT_BAILIAN_RAG_API_KEY'));
  assert.ok(pending.includes('WX_APPSECRET'));
  assert.equal(plan.writes.some((entry) => entry.name === 'ASSISTANT_BAILIAN_RAG_API_KEY'), false);
});

test('dotenv parsing strips quotes and merge preserves unrelated lines', () => {
  const text = [
    '# keep this comment',
    'JWT_SECRET="old-value"',
    'DATABASE_URL=postgresql://user:pass@host/db',
    '',
  ].join('\n');
  const env = parseEnvText(text);
  assert.equal(env.get('JWT_SECRET'), 'old-value');
  const merged = mergeEnvText(text, [
    { name: 'JWT_SECRET', value: 'new-value' },
    { name: 'CRON_SECRET', value: 'cron-value' },
  ], { now: new Date('2026-11-16T00:00:00Z') });
  assert.match(merged, /# keep this comment/);
  assert.match(merged, /JWT_SECRET="new-value"/);
  assert.match(merged, /DATABASE_URL=postgresql:\/\/user:pass@host\/db/);
  assert.match(merged, /CRON_SECRET="cron-value"/);
});

test('icacls parsing separates broad write from read-only inheritance', () => {
  const file = 'C:\\secret\\.env.local';
  const output = [
    'C:\\secret\\.env.local BUILTIN\\Administrators:(F)',
    '                  NT AUTHORITY\\SYSTEM:(F)',
    '                  BUILTIN\\Users:(I)(RX)',
    '                  Everyone:(F)',
    'Successfully processed 1 files; Failed processing 0 files',
  ].join('\r\n');
  const entries = parseIcaclsOutput(output, file);
  assert.equal(entries.length, 4);
  const evaluated = evaluateAclEntries(entries);
  assert.equal(evaluated.broadWrite, true);
  assert.equal(evaluated.broadRead, true);
});

test('restricted ACL is accepted', () => {
  const entries = parseIcaclsOutput([
    'NT AUTHORITY\\SYSTEM:(F)',
    'BUILTIN\\Administrators:(F)',
  ].join('\n'), 'C:\\secret\\.env.local');
  assert.equal(evaluateAclEntries(entries).broadWrite, false);
  assert.equal(evaluateAclEntries(entries).broadRead, false);
});

test('bootstrap creates, preserves and is repeatable', async () => {
  await withTempDir('local', async (directory) => {
    const envFile = path.join(directory, '.env.local');
    const first = await runBootstrap({
      envFile, generate: fakeGenerator(), exec: gitNotTracked, platform: 'linux',
    });
    assert.equal(first.error, undefined);
    assert.equal(first.applied, true);
    const created = await fs.readFile(envFile, 'utf8');
    for (const meta of SELF_OWNED_SECRETS) assert.match(created, new RegExp(`^${meta.name}="`, 'm'));
    assert.equal(JSON.stringify(first).includes('"value"'), false);

    const second = await runBootstrap({
      envFile, generate: fakeGenerator(), exec: gitNotTracked, platform: 'linux',
    });
    assert.equal(second.applied, false);
    assert.equal(second.changed, false);
    assert.equal(await fs.readFile(envFile, 'utf8'), created);
  });
});

test('bootstrap refuses tracked or non-ignored env files', async () => {
  await withTempDir('safety', async (directory) => {
    const envFile = path.join(directory, '.env.local');
    await fs.writeFile(envFile, 'JWT_SECRET="short"\n');
    const tracked = await runBootstrap({
      envFile, generate: fakeGenerator(), exec: gitTracked, platform: 'linux',
    });
    assert.equal(tracked.error, 'env_file_tracked');
    const notIgnored = await runBootstrap({
      envFile, generate: fakeGenerator(), exec: gitNotTracked, platform: 'linux',
    });
    assert.equal(notIgnored.error, undefined);
    const ignoredMissing = await runBootstrap({
      envFile: path.join(directory, '.env.test'), generate: fakeGenerator(),
      exec: (command, args) => (args.includes('check-ignore') ? gitNotIgnored() : gitNotTracked(command, args)),
      platform: 'linux',
    });
    assert.equal(ignoredMissing.error, 'env_file_not_ignored');
  });
});

test('check mode reports without writing', async () => {
  await withTempDir('check', async (directory) => {
    const envFile = path.join(directory, '.env.local');
    await fs.writeFile(envFile, 'JWT_SECRET="short"\n');
    const before = await fs.readFile(envFile, 'utf8');
    const result = await runBootstrap({
      envFile, generate: fakeGenerator(), exec: gitNotTracked, platform: 'linux', check: true,
    });
    assert.equal(result.check, true);
    assert.equal(result.applied, false);
    assert.equal(await fs.readFile(envFile, 'utf8'), before);
    assert.ok(result.entries.some((entry) => entry.status === 'rotated'));
  });
});

test('production plan closes every self-owned key and keeps rotation history', () => {
  const env = new Map(Object.entries({
    JWT_SECRET: 'j'.repeat(64),
    INTERNAL_SECRET: 'replace_with_at_least_32_random_characters',
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'replace_with_a_long_random_secret',
    CRON_SECRET: 'c'.repeat(64),
  }));
  const plan = planSecrets(env, { generate: fakeGenerator() });
  const writes = new Map([...env, ...plan.previousWrites.map((entry) => [entry.name, entry.value])]);
  for (const write of plan.writes) writes.set(write.name, write.value);
  for (const meta of SELF_OWNED_SECRETS) {
    assert.equal(classifySecretValue(writes.get(meta.name), meta.minLength).state, 'valid', meta.name);
  }
  assert.equal(plan.writes.some((entry) => entry.name === 'JWT_SECRET'), false);
  assert.equal(plan.writes.some((entry) => entry.name === 'CRON_SECRET'), false);
  for (const entry of plan.entries.filter((item) => item.status === 'rotated' && item.encryption)) {
    assert.ok(
      plan.previousWrites.some((previous) => previous.name === `${entry.name}${PREVIOUS_SUFFIX}`),
      `${entry.name} must keep a previous value`,
    );
  }
});

test('production plan never edits the env file and stays outside the repository', async () => {
  await withTempDir('production', async (directory) => {
    const envFile = path.join(directory, '.env.production');
    const original = [
      'JWT_SECRET="replace_me"',
      'INTERNAL_SECRET="replace_me_too"',
      'CRON_SECRET="' + 'c'.repeat(64) + '"',
      '',
    ].join('\n');
    await fs.writeFile(envFile, original);
    const planOutput = path.join(directory, 'plan.env');
    const result = await runBootstrap({
      envFile, mode: 'production', planOutput, generate: fakeGenerator(),
      exec: gitNotTracked, platform: 'linux',
    });
    assert.equal(result.error, undefined);
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
    const plan = await fs.readFile(planOutput, 'utf8');
    assert.match(plan, /^JWT_SECRET_PREVIOUS="replace_me"$/m);
    assert.match(plan, /^JWT_SECRET="/m);
    assert.match(plan, /^INTERNAL_SECRET="/m);
    assert.doesNotMatch(plan, /^CRON_SECRET=/m);
    assert.equal(JSON.stringify(result).includes('AAAA'), false);

    const second = await runBootstrap({
      envFile, mode: 'production', planOutput, generate: fakeGenerator(),
      exec: gitNotTracked, platform: 'linux',
    });
    assert.equal(second.planReused, true);
    assert.equal(second.error, undefined);
    assert.equal(await fs.readFile(planOutput, 'utf8'), plan);
    assert.equal(await fs.readFile(envFile, 'utf8'), original);
  });
});

test('production plan refuses an output path inside the repository', async () => {
  const inside = path.resolve(process.cwd(), 'should-not-exist.env');
  assert.equal(isInsideRepository(inside), true);
  assert.equal(isInsideRepository(path.join(os.tmpdir(), 'outside.env')), false);
});
