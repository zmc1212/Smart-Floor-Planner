import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  loadIntegrationMigrationInputs, migratePostgresIntegration,
} from '../postgres-integration-migrations.mjs';

const adminRoot = fileURLToPath(new URL('../../', import.meta.url));
const drizzleDir = path.join(adminRoot, 'drizzle');
const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')).entries;
export const SOURCE_MARKER = 'xiaok-i749-backup-sandbox';
export const CLUSTER_MARKER = 'xiaok-i749-isolated-test';

export function fixtureConfig() {
  const baseUrl = process.env.XIAOK_I749_PG_URL;
  const pgBin = process.env.PG_BIN ?? process.env.XIAOK_I749_PG_BIN ?? '';
  const passwords = {
    sfp_owner: process.env.XIAOK_I749_OWNER_PASSWORD,
    sfp_migrator: process.env.XIAOK_I749_MIGRATOR_PASSWORD,
    sfp_app: process.env.XIAOK_I749_APP_PASSWORD,
    sfp_auditor: process.env.XIAOK_I749_AUDITOR_PASSWORD,
    sfp_backup: process.env.XIAOK_I749_BACKUP_PASSWORD,
  };
  if (!baseUrl || !pgBin) return null;
  if (['sfp_owner', 'sfp_migrator', 'sfp_app', 'sfp_auditor'].some(key => !passwords[key])) return null;
  try {
    const url = new URL(baseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
    if (url.pathname !== '/postgres') return null;
    const port = Number(url.port || 5432);
    if (!Number.isInteger(port) || port < 49152 || [5432, 55432].includes(port)) return null;
    return {
      baseUrl, pgBin, passwords, port,
      superuser: url.username,
      superuserPassword: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

export function urlFor(config, database, role, password) {
  const url = new URL(config.baseUrl);
  url.pathname = database;
  url.username = role;
  url.password = password;
  return url.href;
}

export async function connect(config, database, role, password) {
  const client = new pg.Client({
    connectionString: urlFor(config, database, role, password),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

export const connectAdmin = (config, database = 'postgres') =>
  connect(config, database, config.superuser, config.superuserPassword);

export async function assertIsolatedCluster(config) {
  const client = await connectAdmin(config);
  try {
    const { rows: [identity] } = await client.query(`
      SELECT current_setting('server_version_num')::int AS version,
        shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname='postgres'), 'pg_database')
          AS purpose
    `);
    assert.ok(Math.floor(identity.version / 10000) === 17, 'isolated PG must be version 17');
    assert.equal(identity.purpose, CLUSTER_MARKER);
  } finally {
    await client.end();
  }
}

export async function ensureRoles(config) {
  const client = await connectAdmin(config);
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('xiaok-i749-fixture-roles'))");
    for (const [role, attributes] of [
      ['sfp_migrator', 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],
      ['sfp_app', 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],
      ['sfp_auditor', 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'],
      ['sfp_owner', 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS'],
      ...(config.passwords.sfp_backup
        ? [['sfp_backup', 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS']]
        : []),
    ]) {
      const { rows: [existing] } = await client.query(
        'SELECT 1 FROM pg_roles WHERE rolname=$1', [role],
      );
      if (existing) {
        await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${config.passwords[role]}' ${attributes}`);
      } else {
        await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${config.passwords[role]}' ${attributes}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('xiaok-i749-fixture-roles'))").catch(() => undefined);
    await client.end();
  }
}

function splitStatements(sql) {
  return sql.split('--> statement-breakpoint').filter(statement => statement.trim());
}

function fileHash(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

async function applyHistoricalBaseline(client, inputs) {
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE app.__drizzle_migrations
        (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)
    `);
    const historical = new Map(inputs.knownHashes.map(entry => [entry.when, entry]));
    for (const entry of journal.filter(({ idx }) => idx <= 118)) {
      const legacyBailian = entry.tag === '0060_assistant_knowledge'
        ? path.join(drizzleDir, 'legacy/bailian', `${entry.tag}.sql`)
        : null;
      const sql = readFileSync(legacyBailian ?? path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
      for (const statement of splitStatements(sql)) await client.query(statement);
      const approved = historical.get(entry.when);
      await client.query(
        'INSERT INTO app.__drizzle_migrations(hash,created_at) VALUES($1,$2)',
        [approved ? approved.hash : fileHash(sql), entry.when],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function grantDefaultPrivileges(admin, { backup = false } = {}) {
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
    GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO sfp_app`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
    GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO sfp_app`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
    GRANT SELECT ON TABLES TO sfp_auditor`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
    GRANT SELECT ON TABLES TO sfp_owner`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
    GRANT SELECT ON SEQUENCES TO sfp_owner`);
  await admin.query('GRANT USAGE ON SCHEMA app TO sfp_app, sfp_auditor, sfp_owner');
  if (backup) {
    await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
      GRANT SELECT ON TABLES TO sfp_backup`);
    await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
      GRANT SELECT ON SEQUENCES TO sfp_backup`);
    await admin.query('GRANT USAGE ON SCHEMA app TO sfp_backup');
  }
}

async function seedSyntheticData(app) {
  await app.query("SELECT set_config('app.is_platform_admin','true',false)");
  await app.query(`INSERT INTO app.enterprises(id,name,code,status) OVERRIDING SYSTEM VALUE VALUES
    (1454,'I749 备份源企业','xiaok-i749-1454','active'),
    (1455,'I749 对照企业','xiaok-i749-1455','active')`);
  const { rows: [user1454] } = await app.query("INSERT INTO app.users(nickname) VALUES ('I749 合成业主') RETURNING id");
  const { rows: [user1455] } = await app.query("INSERT INTO app.users(nickname) VALUES ('I749 对照业主') RETURNING id");
  const setTenant = async (enterpriseId) => app.query(
    "SELECT set_config('app.current_enterprise_id',$1,false), set_config('app.is_platform_admin','false',false)",
    [String(enterpriseId)],
  );
  const { rows: [lead1454] } = await app.query(`INSERT INTO app.leads(enterprise_id,customer_user_id,name,phone,source)
    VALUES (1454,$1,'I749 源线索','13800000001','natural') RETURNING id`, [user1454.id]);
  const { rows: [lead1455] } = await app.query(`INSERT INTO app.leads(enterprise_id,customer_user_id,name,phone,source)
    VALUES (1455,$1,'I749 对照线索','13800000002','natural') RETURNING id`, [user1455.id]);
  await setTenant(1454);
  const { rows: [project1454] } = await app.query(`INSERT INTO app.construction_projects(enterprise_id,lead_id,name)
    VALUES (1454,$1,'I749 源施工项目') RETURNING id`, [lead1454.id]);
  const { rows: [conversation1454] } = await app.query(`INSERT INTO app.assistant_conversations(enterprise_id,purpose)
    VALUES (1454,'customer_consultation') RETURNING id`);
  await app.query(`INSERT INTO app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content)
    VALUES (1454,$1,1,'user',$2,'{"version":1,"blocks":[{"type":"text","text":"I749 synthetic message"}]}')`,
  [conversation1454.id, user1454.id]);
  const reminder = (enterpriseId) => {
    const reminderId = 'rem_' + randomBytes(12).toString('hex');
    return app.query(`INSERT INTO app.construction_stage_reminders
      (reminder_id,enterprise_id,project_id,target_role,target_principal_kind,target_principal_id,
       trigger_type,trigger_evidence,scheduled_at,dedupe_key,action_url,title,body)
      VALUES ($1,$2,$3,'owner','user',$4,'stage_entered','{}'::jsonb,now(),$5,'/i749','I749 reminder','Synthetic')
      RETURNING reminder_id`, [reminderId, enterpriseId, project1454.id, user1454.id, `i749-${enterpriseId}`]);
  };
  const { rows: [sourceReminder] } = await reminder(1454);
  await setTenant(1455);
  const { rows: [project1455] } = await app.query(`INSERT INTO app.construction_projects(enterprise_id,lead_id,name)
    VALUES (1455,$1,'I749 对照施工项目') RETURNING id`, [lead1455.id]);
  const { rows: [controlReminder] } = await app.query(`INSERT INTO app.construction_stage_reminders
    (reminder_id,enterprise_id,project_id,target_role,target_principal_kind,target_principal_id,
     trigger_type,trigger_evidence,scheduled_at,dedupe_key,action_url,title,body)
    VALUES ($1,1455,$2,'owner','user',$3,'stage_entered','{}'::jsonb,now(),'i749-1455','/i749','I749 control','Synthetic')
    RETURNING reminder_id`, ['rem_' + randomBytes(12).toString('hex'), project1455.id, user1455.id]);
  return {
    enterpriseIds: [1454, 1455],
    userIds: { 1454: user1454.id, 1455: user1455.id },
    projectIds: { 1454: project1454.id, 1455: project1455.id },
    reminderIds: { 1454: sourceReminder.reminder_id, 1455: controlReminder.reminder_id },
  };
}

export async function provisionSource(config, label) {
  const suffix = randomBytes(5).toString('hex');
  const database = `xiaok_i749_${label}_${suffix}`;
  const backupRole = config.passwords.sfp_backup ? ',sfp_backup' : '';
  const admin = await connectAdmin(config);
  try {
    await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
  const adminInDatabase = await connectAdmin(config, database);
  try {
    await adminInDatabase.query(`
      REVOKE ALL ON DATABASE ${database} FROM public;
      GRANT CONNECT,CREATE ON DATABASE ${database} TO sfp_migrator;
      GRANT CONNECT ON DATABASE ${database} TO sfp_app,sfp_auditor,sfp_owner${backupRole};
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      COMMENT ON DATABASE ${database} IS '${SOURCE_MARKER}';
    `);
    await adminInDatabase.query('CREATE SCHEMA app AUTHORIZATION sfp_migrator');
    await grantDefaultPrivileges(adminInDatabase, { backup: Boolean(config.passwords.sfp_backup) });
  } finally {
    await adminInDatabase.end();
  }

  const inputs = loadIntegrationMigrationInputs(drizzleDir);
  const migrator = await connect(config, database, 'sfp_migrator', config.passwords.sfp_migrator);
  try {
    await applyHistoricalBaseline(migrator, inputs);
    await migratePostgresIntegration(migrator, drizzleDir);
  } finally {
    await migrator.end();
  }

  const grantClient = await connectAdmin(config, database);
  try {
    await grantClient.query(`GRANT USAGE ON SCHEMA app TO sfp_app,sfp_auditor,sfp_owner${backupRole}`);
    await grantClient.query('GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_owner');
    await grantClient.query('GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_owner');
    await grantClient.query('GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_auditor');
    if (config.passwords.sfp_backup) {
      await grantClient.query('GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup');
      await grantClient.query('GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup');
    }
  } finally {
    await grantClient.end();
  }

  const app = await connect(config, database, 'sfp_app', config.passwords.sfp_app);
  try {
    const ref = await seedSyntheticData(app);
    return { database, ref };
  } finally {
    await app.end();
  }
}

export async function dropDatabase(config, database) {
  const admin = await connectAdmin(config);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
