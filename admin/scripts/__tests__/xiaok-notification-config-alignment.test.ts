import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  DEFAULT_SUBSCRIPTION_TEMPLATES,
  normalizePlatformNotificationConfig,
  SUBSCRIPTION_TEMPLATE_KINDS,
  validateDistinctTemplateIds,
} from '@/lib/platform-notification-config';

const baseUrl = process.env.XIAOK_I749_PG_URL;
const clusterMarker = 'xiaok-i749-isolated-test';
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

// Design-only SQL. It is not a Drizzle migration file and is never applied to
// the development database in this round.
export const PROPOSED_0131_STATEMENTS = [
  "SET LOCAL lock_timeout = '5s'",
  'LOCK TABLE app.platform_configs IN ACCESS EXCLUSIVE MODE',
  "UPDATE app.platform_configs SET notification_config='{}'::jsonb WHERE notification_config IS NULL",
  "ALTER TABLE app.platform_configs ALTER COLUMN notification_config SET DEFAULT '{}'::jsonb",
  'ALTER TABLE app.platform_configs ALTER COLUMN notification_config SET NOT NULL',
];

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

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function urlFor(database: string) {
  if (!baseUrl) throw new Error('XIAOK_I749_PG_URL is required');
  const url = new URL(baseUrl);
  url.pathname = database;
  return url.href;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let cluster: pg.Client | null = null;
let sequence = 0;
const suffix = randomBytes(4).toString('hex');

before(async () => {
  if (!baseUrl) return;
  const url = new URL(baseUrl);
  assert.deepEqual([url.protocol, url.hostname, url.pathname], ['postgresql:', '127.0.0.1', '/postgres']);
  assert.ok(Number(url.port) >= 49152 && ![5432, 55432].includes(Number(url.port)));
  cluster = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 8000 });
  await cluster.connect();
  const { rows: [identity] } = await cluster.query(`
    SELECT current_setting('server_version_num')::int AS version,
      shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname='postgres'), 'pg_database')
        AS purpose
  `);
  assert.equal(Math.floor(identity.version / 10000), 17);
  assert.equal(identity.purpose, clusterMarker);
});

after(async () => { await cluster?.end(); });

type Sandbox = { database: string; client: pg.Client };

async function createSandbox(label: string): Promise<Sandbox> {
  sequence += 1;
  const database = `xiaok_i749_notify_${label}_${suffix}_${sequence}`;
  await cluster!.query(`CREATE DATABASE ${database}`);
  const client = new pg.Client({
    connectionString: urlFor(database), connectionTimeoutMillis: 8000,
  });
  await client.connect();
  await client.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.platform_configs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      key text NOT NULL UNIQUE,
      notification_config jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE app.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
    INSERT INTO app.__drizzle_migrations(hash,created_at) VALUES ('synthetic-0021', 1786540800000);
  `);
  await client.query(
    "INSERT INTO app.platform_configs(key, notification_config) VALUES ('default', $1::jsonb)",
    [JSON.stringify(syntheticConfig())],
  );
  for (const key of nullKeys) {
    await client.query(
      'INSERT INTO app.platform_configs(key, notification_config) VALUES ($1, NULL)', [key],
    );
  }
  return { database, client };
}

async function dropSandbox(sandbox: Sandbox) {
  await sandbox.client.end().catch(() => undefined);
  await cluster!.query(`DROP DATABASE IF EXISTS ${sandbox.database} WITH (FORCE)`);
}

async function withSandbox(label: string, run: (sandbox: Sandbox) => Promise<void>) {
  const sandbox = await createSandbox(label);
  try {
    await run(sandbox);
  } finally {
    await dropSandbox(sandbox);
  }
}

type Snapshot = {
  column: { dataType: string; nullable: string; default: string | null };
  nullRows: number;
  nonNull: { key: string; text: string; templates: unknown }[];
  aggregate: string;
  ledger: { id: number; hash: string; created_at: string }[];
};

async function snapshot(client: pg.Client): Promise<Snapshot> {
  const { rows: [column] } = await client.query(`
    SELECT data_type AS "dataType", is_nullable AS nullable, column_default AS "default"
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
    nonNull,
    aggregate: digest(nonNull.map(row => `${row.key}|${digest(row.text)}`).join('\n')),
    ledger,
  };
}

async function applyMigration(client: pg.Client) {
  await client.query('BEGIN');
  try {
    await client.query(PROPOSED_0131_STATEMENTS[0]);
    await client.query(PROPOSED_0131_STATEMENTS[1]);
    const update = await client.query(PROPOSED_0131_STATEMENTS[2]);
    await client.query(PROPOSED_0131_STATEMENTS[3]);
    await client.query(PROPOSED_0131_STATEMENTS[4]);
    await client.query('COMMIT');
    return update.rowCount;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

const live = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !baseUrl, timeout: 120_000 }, fn);

test('K. an empty object and NULL normalize to the full V2 contract', () => {
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
});

test('J. the existing eight-template config keeps every stored template ID', () => {
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

test('the proposed 0131 seeds no templates and does not touch the migration ledger', () => {
  const sql = PROPOSED_0131_STATEMENTS.join('\n');
  assert.match(sql, /WHERE notification_config IS NULL/);
  assert.match(sql, /SET DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /SET NOT NULL/);
  for (const forbidden of ['jsonb_build_object', 'INSERT INTO app.platform_configs', '__drizzle_migrations', '0021']) {
    assert.equal(sql.includes(forbidden), false, forbidden);
  }
});

live('A/B/C/I. the backfill only changes NULL rows and preserves all non-null data', async () => {
  await withSandbox('backfill', async ({ client }) => {
    const before = await snapshot(client);
    assert.equal(before.nullRows, 8);
    assert.equal(before.column.nullable, 'YES');
    assert.equal(before.column.default, null);

    const updateCount = await applyMigration(client);
    assert.equal(updateCount, 8);

    const after = await snapshot(client);
    assert.equal(after.nullRows, 0);
    assert.equal(after.column.nullable, 'NO');
    assert.match(after.column.default ?? '', /'\{\}'::jsonb/);
    assert.equal(after.nonNull.length, 9);
    assert.equal(after.ledger.length, before.ledger.length);
    assert.deepEqual(after.ledger, before.ledger);

    const beforeDefault = before.nonNull.find(row => row.key === 'default');
    const afterDefault = after.nonNull.find(row => row.key === 'default');
    assert.equal(afterDefault?.text, beforeDefault?.text);
    assert.deepEqual(afterDefault?.templates, beforeDefault?.templates);
    assert.deepEqual(after.nonNull.filter(row => row.key !== 'default' && nullKeys.includes(row.key))
      .map(row => [row.key, row.text]), nullKeys.map(key => [key, '{}']));

    const originallyNonNull = after.nonNull.filter(row => before.nonNull.some(item => item.key === row.key));
    assert.equal(
      digest(originallyNonNull.map(row => `${row.key}|${digest(row.text)}`).join('\n')),
      before.aggregate,
    );
    assert.equal((afterDefault?.templates as Record<string, unknown> | undefined)
      && Object.keys(afterDefault!.templates as Record<string, unknown>).length, 8);
  });
});

live('D/E. new rows get the empty-object default and explicit NULL is rejected', async () => {
  await withSandbox('defaults', async ({ client }) => {
    await applyMigration(client);
    const { rows: [inserted] } = await client.query(`
      INSERT INTO app.platform_configs(key) VALUES ('new-default-key')
      RETURNING notification_config
    `);
    assert.deepEqual(inserted.notification_config, {});
    await assert.rejects(
      client.query(`INSERT INTO app.platform_configs(key, notification_config)
        VALUES ('explicit-null', NULL)`),
      { code: '23502' },
    );
  });
});

live('F. a concurrent NULL write cannot bypass the new NOT NULL constraint', async () => {
  await withSandbox('concurrent', async ({ database }) => {
    const writerA = new pg.Client({ connectionString: urlFor(database), connectionTimeoutMillis: 8000 });
    const writerB = new pg.Client({
      connectionString: urlFor(database), connectionTimeoutMillis: 8000,
      options: '-c statement_timeout=15000',
    });
    await writerA.connect();
    await writerB.connect();
    try {
      await writerA.query('BEGIN');
      for (const statement of PROPOSED_0131_STATEMENTS) await writerA.query(statement);

      let settled = false;
      const pending = writerB.query(`INSERT INTO app.platform_configs(key, notification_config)
        VALUES ('race-null', NULL)`)
        .then(() => ({ ok: true, code: '' }))
        .catch(error => ({ ok: false, code: error.code as string }))
        .finally(() => { settled = true; });
      await delay(500);
      assert.equal(settled, false, 'the concurrent insert must wait for the migration lock');

      await writerA.query('COMMIT');
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.code, '23502');
      const { rows: [valid] } = await writerB.query(`
        INSERT INTO app.platform_configs(key, notification_config)
        VALUES ('race-valid', '{}'::jsonb) RETURNING notification_config
      `);
      assert.deepEqual(valid.notification_config, {});
    } finally {
      await writerA.end().catch(() => undefined);
      await writerB.end().catch(() => undefined);
    }
  });
});

live('G. a failure inside the migration transaction rolls back every change', async () => {
  await withSandbox('rollback', async ({ client }) => {
    const before = await snapshot(client);
    await client.query('BEGIN');
    for (const statement of PROPOSED_0131_STATEMENTS) await client.query(statement);
    const inside = await snapshot(client);
    assert.equal(inside.nullRows, 0);
    await client.query('ROLLBACK');
    const after = await snapshot(client);
    assert.equal(after.nullRows, 8);
    assert.equal(after.column.nullable, 'YES');
    assert.equal(after.column.default, null);
    assert.equal(after.aggregate, before.aggregate);
    assert.deepEqual(after.ledger, before.ledger);
  });
});

live('H. a repeated execution is a no-op and keeps the non-null digest stable', async () => {
  await withSandbox('repeat', async ({ client }) => {
    assert.equal(await applyMigration(client), 8);
    const first = await snapshot(client);
    assert.equal(await applyMigration(client), 0);
    const second = await snapshot(client);
    assert.equal(second.nullRows, 0);
    assert.equal(second.column.nullable, 'NO');
    assert.equal(second.aggregate, first.aggregate);
    assert.deepEqual(second.ledger, first.ledger);
    assert.deepEqual(second.nonNull, first.nonNull);
  });
});
