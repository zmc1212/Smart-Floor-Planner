import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  MANAGED_KEYS,
  applySecretPlan,
  planApplication,
} from '../apply-secret-plan.mjs';
import { parseEnvText } from '../bootstrap-secrets.mjs';

const VALID = 'j'.repeat(64);

async function withTempDir(label, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `sfp-apply-${label}-`));
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function trackedExec(command, args) {
  return args.includes('--error-unmatch') ? '' : '';
}

test('only bootstrap-owned keys are accepted', () => {
  assert.equal(MANAGED_KEYS.has('JWT_SECRET'), true);
  assert.equal(MANAGED_KEYS.has('JWT_SECRET_PREVIOUS'), true);
  assert.equal(MANAGED_KEYS.has('DATABASE_URL'), false);
});

test('valid target secrets are never overwritten and invalid ones are filled', () => {
  const target = new Map(Object.entries({
    JWT_SECRET: VALID,
    INTERNAL_SECRET: 'replace_with_at_least_32_random_characters',
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'm'.repeat(64),
  }));
  const plan = new Map(Object.entries({
    JWT_SECRET: 'n'.repeat(64),
    INTERNAL_SECRET: 'i'.repeat(64),
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET: 'q'.repeat(64),
    MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS: 'old-media',
    JWT_SECRET_PREVIOUS: 'old-jwt',
  }));
  const result = planApplication(target, plan);
  const byName = Object.fromEntries(result.entries.map((entry) => [entry.name, entry.status]));
  assert.equal(byName.JWT_SECRET, 'kept_existing');
  assert.equal(byName.INTERNAL_SECRET, 'replaced_invalid');
  assert.equal(byName.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET, 'kept_existing');
  assert.equal(byName.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS, 'filled_previous');
  assert.equal(byName.JWT_SECRET_PREVIOUS, 'filled_previous');
  assert.deepEqual(result.writes.map((entry) => entry.name).sort(), [
    'INTERNAL_SECRET',
    'JWT_SECRET_PREVIOUS',
    'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS',
  ]);
});

test('check mode does not write and apply is idempotent', async () => {
  await withTempDir('apply', async (directory) => {
    const targetPath = path.join(directory, 'runtime.env');
    const planPath = path.join(directory, 'plan.env');
    const target = [
      'JWT_SECRET="' + VALID + '"',
      'INTERNAL_SECRET="replace_with_at_least_32_random_characters"',
      'DATABASE_URL="postgresql://user:pass@host/db"',
      '',
    ].join('\n');
    await fs.writeFile(targetPath, target);
    await fs.writeFile(planPath, [
      'JWT_SECRET="' + 'n'.repeat(64) + '"',
      'INTERNAL_SECRET="' + 'i'.repeat(64) + '"',
      'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET="' + 'm'.repeat(64) + '"',
      'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS="old-media"',
      '',
    ].join('\n'));

    const checked = await applySecretPlan({
      planPath, targetPath, check: true, platform: 'linux',
    });
    assert.equal(checked.error, undefined);
    assert.equal(checked.applied, false);
    assert.equal(await fs.readFile(targetPath, 'utf8'), target);

    const applied = await applySecretPlan({
      planPath, targetPath, check: false, platform: 'linux',
    });
    assert.equal(applied.error, undefined);
    assert.equal(applied.applied, true);
    const merged = await fs.readFile(targetPath, 'utf8');
    assert.match(merged, /JWT_SECRET="j{64}"/);
    assert.match(merged, /INTERNAL_SECRET="i{64}"/);
    assert.match(merged, /MEDIA_STORAGE_KEY_ENCRYPTION_SECRET="m{64}"/);
    assert.match(merged, /MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS="old-media"/);
    assert.match(merged, /DATABASE_URL="postgresql:\/\/user:pass@host\/db"/);
    assert.equal(JSON.stringify(applied).includes('i'.repeat(64)), false);

    const again = await applySecretPlan({
      planPath, targetPath, check: false, platform: 'linux',
    });
    assert.equal(again.changed, false);
    assert.equal(again.applied, false);
    assert.equal(await fs.readFile(targetPath, 'utf8'), merged);
  });
});

test('unsupported plan keys fail closed without writing', async () => {
  await withTempDir('unsupported', async (directory) => {
    const targetPath = path.join(directory, 'runtime.env');
    const planPath = path.join(directory, 'plan.env');
    const target = 'JWT_SECRET="' + VALID + '"\n';
    await fs.writeFile(targetPath, target);
    await fs.writeFile(planPath, 'DATABASE_URL="postgresql://evil@host/db"\n');
    const result = await applySecretPlan({
      planPath, targetPath, check: false, platform: 'linux',
    });
    assert.equal(result.error, 'unsupported_plan_key');
    assert.equal(result.applied, false);
    assert.equal(await fs.readFile(targetPath, 'utf8'), target);
  });
});

test('tracked targets are rejected', async () => {
  const targetPath = path.resolve(import.meta.dirname, '../../.postgres-backups/i7524-apply-test.env');
  await fs.writeFile(targetPath, 'JWT_SECRET="' + VALID + '"\n', { mode: 0o600 });
  const planPath = path.join(os.tmpdir(), 'sfp-apply-tracked-plan.env');
  await fs.writeFile(planPath, 'INTERNAL_SECRET="' + 'i'.repeat(64) + '"\n');
  try {
    const result = await applySecretPlan({
      planPath, targetPath, check: false, platform: 'linux', exec: trackedExec,
    });
    assert.equal(result.error, 'target_tracked');
    assert.equal(result.applied, false);
  } finally {
    await fs.rm(targetPath, { force: true });
    await fs.rm(planPath, { force: true });
  }
});

test('missing plan or target reports a clear error', async () => {
  const missing = await applySecretPlan({
    planPath: path.join(os.tmpdir(), 'no-such-plan.env'),
    targetPath: path.join(os.tmpdir(), 'no-such-target.env'),
    platform: 'linux',
  });
  assert.equal(missing.error, 'plan_not_found');
  const target = parseEnvText('A=1\n');
  assert.equal(target.get('A'), '1');
});
