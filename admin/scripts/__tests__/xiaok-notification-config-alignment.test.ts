import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  loadIntegrationMigrationInputs, migratePostgresIntegration, pendingMigrations, validateLedger,
} from '../postgres-integration-migrations.mjs';
import {
  assertIsolatedCluster, connect, connectAdmin, dropDatabase, ensureRoles, fixtureConfig, urlFor,
} from './xiaok-migration-backup-fixture.mjs';
import {
  DEFAULT_SUBSCRIPTION_TEMPLATES,
  normalizePlatformNotificationConfig,
  SUBSCRIPTION_TEMPLATE_KINDS,
  validateDistinctTemplateIds,
} from '@/lib/platform-notification-config';

type JournalEntry = {
  idx: number; version: string; when: number; tag: string; breakpoints: boolean;
};
type MigrationEntry = { when: number; tag: string; hashes: Set<string> };
type KnownHash = { when: number; tag: string; hash: string; ledgerId: number };
type MigrationInputs = {
  active: MigrationEntry[];
  migrations: { folderMillis: number; tag?: string; hash: string }[];
  forks: Record<string, MigrationEntry[]>;
  knownHashes: KnownHash[];
};

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const drizzleDir = path.join(adminRoot, 'drizzle');
const migrationFile = path.join(drizzleDir, '0131_platform_notification_config_not_null.sql');
const journalFile = path.join(drizzleDir, 'meta/_journal.json');
const journal: JournalEntry[] = JSON.parse(readFileSync(journalFile, 'utf8')).entries;
const migrationSql = readFileSync(migrationFile, 'utf8');
const requiredKinds = SUBSCRIPTION_TEMPLATE_KINDS.filter(kind => kind !== 'lead_claim_available');
const nullKeys = [
  'ai-provider-environment:synthetic-a',
  'ai-provider-environment:synthetic-b',
  'ai-provider-environment:synthetic-c',
  'phase2-1001-1790000000001',
  'phase2-1002-1790000000002',
  'phase2-1003-1790000000003',
  'phase2-1004-1790000000004',
  'phase2-1005-1790000000005',
];

const config = fixtureConfig();
const suffix = randomBytes(4).toString('hex');
let sequence = 0;

function syntheticTemplateId(kind: string) {
  return `synth_${kind}_0001`;
}

function syntheticConfig() {
  return {
    version: 2,
    templates: Object.fromEntries(requiredKinds.map(kind => [kind, {
      title: `Synthetic ${kind}`,
      templateId: syntheticTemplateId(kind),
      keywordKeys: { note: 'thing1' },
    }])),
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type Sandbox = { database: string };

before(async () => {
  if (!config) return;
  await assertIsolatedCluster(config);
  await ensureRoles(config);
});

after(async () => {
  if (!config) return;
  // Sandboxes are removed by each test's finally block.
});

function migrationInputs(): MigrationInputs {
  return loadIntegrationMigrationInputs(drizzleDir) as MigrationInputs;
}

function baselineEntries() {
  return migrationInputs().active.filter(entry => entry.when <= 1795852800000);
}

async function applyBaseline(client: pg.Client) {
  const inputs = migrationInputs();
  const approved = new Map<number, KnownHash>(inputs.knownHashes.map(entry => [entry.when, entry]));
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE app.__drizzle_migrations
        (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)
    `);
    for (const entry of baselineEntries()) {
      const file = entry.tag === '0060_assistant_knowledge'
        ? path.join(drizzleDir, 'legacy/bailian', `${entry.tag}.sql`)
        : path.join(drizzleDir, `${entry.tag}.sql`);
      const sql = readFileSync(file, 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim()) await client.query(statement);
      }
      const historical = approved.get(entry.when);
      await client.query(
        'INSERT INTO app.__drizzle_migrations(hash,created_at) VALUES($1,$2)',
        [historical ? historical.hash : sha256(sql), entry.when],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function createDriftedSandbox(label: string): Promise<Sandbox> {
  sequence += 1;
  const database = `xiaok_i749_0131_${label}_${suffix}_${sequence}`;
  const admin = await connectAdmin(config!);
  try {
    await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
  const adminDb = await connectAdmin(config!, database);
  try {
    await adminDb.query(`
      REVOKE ALL ON DATABASE ${database} FROM public;
      GRANT CONNECT,CREATE ON DATABASE ${database} TO sfp_migrator;
      GRANT CONNECT ON DATABASE ${database} TO sfp_app,sfp_auditor,sfp_owner;
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      CREATE SCHEMA app AUTHORIZATION sfp_migrator;
    `);
  } finally {
    await adminDb.end();
  }

  const migrator = await connect(config!, database, 'sfp_migrator', config!.passwords.sfp_migrator);
  try {
    await applyBaseline(migrator);
  } finally {
    await migrator.end();
  }

  const drift = await connectAdmin(config!, database);
  try {
    await drift.query('ALTER TABLE app.platform_configs ALTER COLUMN notification_config DROP NOT NULL');
    await drift.query('ALTER TABLE app.platform_configs ALTER COLUMN notification_config DROP DEFAULT');
    await drift.query('DELETE FROM app.platform_configs');
    await drift.query(
      "INSERT INTO app.platform_configs(key, notification_config) VALUES ('default', $1::jsonb)",
      [JSON.stringify(syntheticConfig())],
    );
    for (const key of nullKeys) {
      await drift.query('INSERT INTO app.platform_configs(key) VALUES ($1)', [key]);
    }
  } finally {
    await drift.end();
  }
  return { database };
}

async function removeSandbox(sandbox: Sandbox) {
  await dropDatabase(config!, sandbox.database).catch(() => undefined);
}

function runMigrator(database: string) {
  const result = spawnSync(process.execPath, ['scripts/postgres-migrate.mjs'], {
    cwd: adminRoot,
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: urlFor(config!, database, 'sfp_migrator', config!.passwords.sfp_migrator),
    },
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

type Snapshot = {
  column: { nullable: string; default: string | null };
  nullRows: number;
  nonNull: { key: string; text: string; digest: string; templates: unknown }[];
  ledger: { id: number; hash: string; created_at: string }[];
};

async function snapshot(database: string): Promise<Snapshot> {
  const client = await connectAdmin(config!, database);
  try {
    const { rows: [column] } = await client.query(`
      SELECT is_nullable AS nullable, column_default AS "default"
      FROM information_schema.columns
      WHERE table_schema='app' AND table_name='platform_configs' AND column_name='notification_config'
    `);
    const { rows: [counts] } = await client.query(`
      SELECT count(*) FILTER (WHERE notification_config IS NULL)::int AS nulls
      FROM app.platform_configs
    `);
    const { rows: nonNull } = await client.query(`
      SELECT key, notification_config::text AS text, notification_config->'templates' AS templates
      FROM app.platform_configs WHERE notification_config IS NOT NULL ORDER BY key
    `);
    const { rows: ledger } = await client.query(
      'SELECT id,hash,created_at FROM app.__drizzle_migrations ORDER BY id',
    );
    return {
      column,
      nullRows: counts.nulls,
      nonNull: nonNull.map(row => ({ ...row, digest: sha256(row.text) })),
      ledger,
    };
  } finally {
    await client.end();
  }
}

test('K/J. empty and old eight-template configs normalize without changing IDs', () => {
  for (const input of [undefined, null, {}]) {
    const normalized = normalizePlatformNotificationConfig(input);
    assert.equal(normalized.version, 2);
    assert.equal(normalized.subscriptionMessagesEnabled, false);
    assert.equal(Object.keys(normalized.templates).length, 9);
    for (const kind of requiredKinds) {
      assert.equal(normalized.templates[kind].templateId, DEFAULT_SUBSCRIPTION_TEMPLATES[kind].templateId, kind);
      assert.match(normalized.templates[kind].templateId, /^[A-Za-z0-9_-]{10,128}$/);
    }
    assert.equal(normalized.templates.lead_claim_available.templateId, '');
    assert.equal(normalized.miniprogramTemplateId, DEFAULT_SUBSCRIPTION_TEMPLATES.workflow_todo.templateId);
    assert.doesNotThrow(() => validateDistinctTemplateIds(normalized.templates));
  }

  const stored = syntheticConfig();
  const normalized = normalizePlatformNotificationConfig(stored as never);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.subscriptionMessagesEnabled, false);
  for (const kind of requiredKinds) {
    assert.equal(normalized.templates[kind].templateId, syntheticTemplateId(kind), kind);
  }
  assert.equal(normalized.templates.lead_claim_available.templateId, '');
  assert.equal(normalized.miniprogramTemplateId, syntheticTemplateId('workflow_todo'));
  assert.doesNotThrow(() => validateDistinctTemplateIds(normalized.templates));
});

test('0131 SQL and journal are append-only and contain no seed or ledger statements', () => {
  for (const forbidden of ['BEGIN', 'COMMIT', 'jsonb_build_object', 'INSERT INTO app.platform_configs',
    '__drizzle_migrations', '0021']) {
    assert.equal(migrationSql.toUpperCase().includes(forbidden.toUpperCase()), false, forbidden);
  }
  assert.match(migrationSql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migrationSql, /SET LOCAL statement_timeout = '60s'/);
  assert.match(migrationSql, /LOCK TABLE app\.platform_configs IN ACCESS EXCLUSIVE MODE/);
  assert.match(migrationSql, /WHERE notification_config IS NULL/);
  assert.match(migrationSql, /SET DEFAULT '\{\}'::jsonb/);
  assert.match(migrationSql, /SET NOT NULL/);

  assert.equal(journal.length, 128);
  assert.deepEqual(journal.slice(0, 127).map(entry => entry.idx), Array.from({ length: 127 }, (_, i) => i));
  assert.deepEqual(journal[126], {
    idx: 126, version: '7', when: 1795852800000,
    tag: '0130_xiaok_pilot_project_scopes', breakpoints: true,
  });
  assert.deepEqual(journal[127], {
    idx: 127, version: '7', when: 1796457600000,
    tag: '0131_platform_notification_config_not_null', breakpoints: true,
  });
  const timestamps = journal.map(entry => entry.when);
  assert.equal(new Set(timestamps).size, timestamps.length);
  assert.ok(timestamps.every((value, index) => index === 0 || value > timestamps[index - 1]));
  assert.equal(path.basename(migrationFile, '.sql'), journal[127].tag);
});

const live = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !config, timeout: 180_000 }, fn);

live('A-N. the official migrator applies 0131 and preserves every non-null config and ledger row', async () => {
  const sandbox = await createDriftedSandbox('main');
  try {
    const before = await snapshot(sandbox.database);
    assert.equal(before.nullRows, 8);
    assert.equal(before.column.nullable, 'YES');
    assert.equal(before.column.default, null);
    assert.equal(before.nonNull.length, 1);
    assert.equal(before.ledger.length, 127);
    const defaultBefore = before.nonNull.find(row => row.key === 'default');
    const historicalBefore = before.ledger.filter(row =>
      [1786540800000, 1788184800000].includes(Number(row.created_at)));

    const first = runMigrator(sandbox.database);
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /"success":true/);

    const after = await snapshot(sandbox.database);
    assert.equal(after.nullRows, 0);
    assert.equal(after.column.nullable, 'NO');
    assert.match(after.column.default ?? '', /'\{\}'::jsonb/);
    assert.equal(after.nonNull.length, 9);
    const defaultAfter = after.nonNull.find(row => row.key === 'default');
    assert.equal(defaultAfter?.text, defaultBefore?.text);
    assert.equal(defaultAfter?.digest, defaultBefore?.digest);
    assert.deepEqual(defaultAfter?.templates, defaultBefore?.templates);
    assert.equal((defaultAfter?.templates as Record<string, unknown> | undefined)
      && Object.keys(defaultAfter!.templates as Record<string, unknown>).length, 8);
    assert.deepEqual(after.nonNull.filter(row => row.key !== 'default' && nullKeys.includes(row.key))
      .map(row => [row.key, row.text]), nullKeys.map(key => [key, '{}']));

    const originalKeys = new Set(before.nonNull.map(row => row.key));
    const originalAfter = after.nonNull.filter(row => originalKeys.has(row.key));
    assert.equal(originalAfter.length, before.nonNull.length);
    for (const row of before.nonNull) {
      const candidate = originalAfter.find(item => item.key === row.key);
      assert.equal(candidate?.text, row.text, row.key);
      assert.equal(candidate?.digest, row.digest, row.key);
      assert.deepEqual(candidate?.templates, row.templates, row.key);
    }

    assert.equal(after.ledger.length, 128);
    assert.deepEqual(after.ledger.slice(0, before.ledger.length), before.ledger);
    const historicalAfter = after.ledger.filter(row =>
      [1786540800000, 1788184800000].includes(Number(row.created_at)));
    assert.deepEqual(historicalAfter, historicalBefore);
    const newRow = after.ledger.find(row => Number(row.created_at) === 1796457600000);
    assert.equal(newRow?.hash, sha256(migrationSql));
    assert.equal(after.ledger.at(-1)?.created_at, '1796457600000');

    const inputs = migrationInputs();
    const { seen, supersedesOriginal } = validateLedger(
      after.ledger, inputs.active, inputs.forks, inputs.knownHashes,
    );
    const pending: { tag?: string }[] = pendingMigrations(inputs.migrations, seen, supersedesOriginal);
    assert.deepEqual(pending.map(entry => entry.tag), []);

    const inserted = await (async () => {
      const client = await connectAdmin(config!, sandbox.database);
      try {
        const { rows: [row] } = await client.query(`
          INSERT INTO app.platform_configs(key) VALUES ('new-default-key')
          RETURNING notification_config
        `);
        return row.notification_config;
      } finally {
        await client.end();
      }
    })();
    assert.deepEqual(inserted, {});
    await assert.rejects(async () => {
      const client = await connectAdmin(config!, sandbox.database);
      try {
        await client.query(`INSERT INTO app.platform_configs(key, notification_config)
          VALUES ('explicit-null', NULL)`);
      } finally {
        await client.end();
      }
    }, { code: '23502' });

    const repeat = runMigrator(sandbox.database);
    assert.equal(repeat.code, 0, repeat.output);
    const repeated = await snapshot(sandbox.database);
    assert.deepEqual(repeated.ledger, after.ledger);
    assert.deepEqual(repeated.nonNull.filter(row => row.key !== 'new-default-key'),
      after.nonNull.filter(row => row.key !== 'new-default-key'));
  } finally {
    await removeSandbox(sandbox);
  }
});

live('I. a lock timeout fails the official migrator and rolls back 0131 completely', async () => {
  const sandbox = await createDriftedSandbox('rollback');
  const locker = await connectAdmin(config!, sandbox.database);
  try {
    const before = await snapshot(sandbox.database);
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE app.platform_configs IN ACCESS SHARE MODE');
    const run = runMigrator(sandbox.database);
    assert.notEqual(run.code, 0, run.output);
    assert.match(run.output, /lock timeout|canceling statement/i);
    const after = await snapshot(sandbox.database);
    assert.equal(after.nullRows, 8);
    assert.equal(after.column.nullable, 'YES');
    assert.equal(after.column.default, null);
    assert.deepEqual(after.ledger, before.ledger);
    assert.equal(after.nonNull.length, 1);
  } finally {
    await locker.query('ROLLBACK').catch(() => undefined);
    await locker.end().catch(() => undefined);
    await removeSandbox(sandbox);
  }
});

live('J. a concurrent NULL insert waits for 0131 and then fails with 23502', async () => {
  const sandbox = await createDriftedSandbox('concurrent');
  const migrator = await connect(config!, sandbox.database, 'sfp_migrator', config!.passwords.sfp_migrator);
  let lockAcquiredResolve!: () => void;
  let releaseLockResolve!: () => void;
  const lockAcquired = new Promise<void>(resolve => { lockAcquiredResolve = resolve; });
  const releaseLock = new Promise<void>(resolve => { releaseLockResolve = resolve; });
  const proxy = new Proxy(migrator, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (text: string, values?: unknown[]) => {
          const result = await target.query(text, values);
          if (typeof text === 'string' && text.includes('LOCK TABLE app.platform_configs')) {
            lockAcquiredResolve();
            await releaseLock;
          }
          return result;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const writer = new pg.Client({
    connectionString: urlFor(config!, sandbox.database, config!.superuser, config!.superuserPassword),
    connectionTimeoutMillis: 8000,
    options: '-c statement_timeout=15000',
  });
  await writer.connect();
  try {
    const migration = migratePostgresIntegration(proxy as pg.Client, drizzleDir);
    await Promise.race([
      lockAcquired,
      delay(20_000).then(() => { throw new Error('migration did not acquire the 0131 lock'); }),
    ]);
    let settled = false;
    const pending = writer.query(`INSERT INTO app.platform_configs(key, notification_config)
      VALUES ('race-null', NULL)`)
      .then(() => ({ ok: true, code: '' }))
      .catch(error => ({ ok: false, code: error.code as string }))
      .finally(() => { settled = true; });
    await delay(500);
    assert.equal(settled, false, 'the concurrent insert must wait for the migration lock');
    releaseLockResolve();
    await migration;
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, '23502');
    const { rows: [valid] } = await writer.query(`
      INSERT INTO app.platform_configs(key, notification_config)
      VALUES ('race-valid', '{}'::jsonb) RETURNING notification_config
    `);
    assert.deepEqual(valid.notification_config, {});
    const after = await snapshot(sandbox.database);
    assert.equal(after.nullRows, 0);
    assert.equal(after.ledger.length, 128);
  } finally {
    releaseLockResolve?.();
    await writer.end().catch(() => undefined);
    await migrator.end().catch(() => undefined);
    await removeSandbox(sandbox);
  }
});

live('the journal keeps 0021/0051 historical hashes and the official migrator sees 0131', async () => {
  const inputs = migrationInputs();
  assert.equal(inputs.active.length, 128);
  assert.equal(inputs.active.at(-1)?.tag, '0131_platform_notification_config_not_null');
  assert.deepEqual(inputs.knownHashes.map(entry => entry.tag),
    ['0021_platform_notification_config', '0051_staff_referrer_network']);
  const journal0131 = journal.find(entry => entry.tag === '0131_platform_notification_config_not_null');
  assert.equal(journal0131?.when, 1796457600000);
  assert.equal(journal0131?.idx, 127);
});
