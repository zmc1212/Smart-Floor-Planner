import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  loadKnownHashes, parseKnownHashes, pendingMigrations, validateLedger,
} from '../postgres-integration-migrations.mjs';

const admin = fileURLToPath(new URL('../../', import.meta.url));
const folder = new URL('../../drizzle/', import.meta.url);
const baseUrl = process.env.XIAOK_I4_PG_URL;
const migratorPassword = process.env.XIAOK_I4_MIGRATOR_PASSWORD;
const appPassword = process.env.XIAOK_I4_APP_PASSWORD;
const suffix = randomBytes(5).toString('hex');
const database = (label) => `xiaok_i4_${label}_${suffix}`;
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', folder))).entries;
const common = journal.filter(({ idx }) => idx < 120);
const stageAndPilotMigrations = ['0128', '0129', '0130', '0131'];
const read = (name) => readFileSync(new URL(name + '.sql', folder), 'utf8');
const hash = (sql) => createHash('sha256').update(sql).digest('hex');
const userStates = {
  pending: 'active', running: 'processing', waiting_for_user: 'waiting',
  waiting_for_worker: 'waiting', waiting_for_designer: 'waiting', waiting_for_external: 'waiting',
  waiting_for_authorization: 'awaiting_authorization', failed: 'failed', paused: 'paused',
  cancelled: 'cancelled', completed: 'completed',
};
const nativeStates = ['active', 'processing', 'waiting', 'blocked', 'awaiting_authorization',
  'paused', 'completed', 'failed', 'cancelled', 'expired'];
const historicalAuthorization = '{"inAppReminder":true,"share":"existing_project_grants"}';
const nativeAuthorization = '{"trackElectrical":true,"remindOwner":true}';
const receipt = '{"status":"unknown","externalId":"i4-synthetic-unconfirmed"}';
const nativeTasks = '[{"key":"outlet","roomId":"91","next":"review_design","operationKey":"i4-native-op","receipt":{"status":"unknown"}}]';
let cluster;

function urlFor(name, role, password) {
  const url = new URL(baseUrl);
  url.pathname = name;
  url.username = role;
  url.password = password;
  return url.href;
}

async function inDatabase(name, role, password, fn) {
  const client = new pg.Client({ connectionString: urlFor(name, role, password), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const asMigrator = (name, fn) => inDatabase(name, 'sfp_migrator', migratorPassword, fn);
const asApp = (name, fn) => inDatabase(name, 'sfp_app', appPassword, fn);
const asAdmin = (name, fn) => inDatabase(name, 'postgres', new URL(baseUrl).password, fn);

before(async () => {
  if (!baseUrl) return;
  const url = new URL(baseUrl);
  assert.deepEqual([url.protocol, url.hostname, url.username, url.pathname, url.search, url.hash],
    ['postgresql:', '127.0.0.1', 'postgres', '/postgres', '', '']);
  assert.ok(Number(url.port) >= 49152 && migratorPassword && appPassword);
  cluster = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 5000 });
  await cluster.connect();
  const { rows: [identity] } = await cluster.query(`
    select current_database() db, current_setting('server_version_num')::int server,
      shobj_description(oid,'pg_database') as purpose from pg_database where datname=current_database()`);
  assert.equal(identity.purpose, 'xiaok-integration-isolated-test');
  assert.equal(Math.floor(identity.server / 10000), 17);
});

after(async () => { await cluster?.end(); });

async function provision(label, { vector = true } = {}) {
  const name = database(label);
  await cluster.query(`create database ${name}`);
  await asAdmin(name, (db) => db.query(`
    revoke all on database ${name} from public;
    grant create, connect on database ${name} to sfp_migrator;
    grant connect on database ${name} to sfp_app;
    revoke create on schema public from public;
    create schema app authorization sfp_migrator;
    alter default privileges for role sfp_migrator in schema app grant select,insert,update,delete on tables to sfp_app;
    alter default privileges for role sfp_migrator in schema app grant usage,select,update on sequences to sfp_app;
    alter default privileges for role sfp_migrator in schema app grant select on tables to sfp_auditor;
    ${vector ? 'create extension vector;' : ''}`));
  return name;
}

async function applyOriginal(db, entries, legacy = '') {
  await db.query('begin');
  try {
    for (const { when, tag } of entries) {
      const sql = read(legacy && (when >= 1795075200000 || tag === '0060_assistant_knowledge') ? `${legacy}/${tag}` : tag);
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim()) await db.query(statement);
      }
      await db.query('insert into app.__drizzle_migrations(hash,created_at) values ($1,$2)', [hash(sql), when]);
    }
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function prepare(label, legacy, vector) {
  const name = await provision(label, { vector });
  await asMigrator(name, async (db) => {
    await db.query('create table app.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint)');
    await applyOriginal(db, common, legacy === 'bailian' ? 'legacy/bailian' : '');
    if (legacy) {
      const prefix = 'legacy/' + legacy + '/';
      const entries = JSON.parse(readFileSync(new URL(prefix + '_journal.json', folder))).entries.filter(({ idx }) => idx >= 120);
      await applyOriginal(db, entries, 'legacy/' + legacy);
    }
  });
  return name;
}

function migrate(name) {
  const result = spawnSync(process.execPath, ['scripts/postgres-migrate.mjs'], {
    cwd: admin,
    env: { ...process.env, DATABASE_MIGRATION_URL: urlFor(name, 'sfp_migrator', migratorPassword) },
    encoding: 'utf8', timeout: 180_000, windowsHide: true,
  });
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}

const ledger = (name) => asMigrator(name, async (db) =>
  (await db.query('select id,hash,created_at from app.__drizzle_migrations order by id')).rows);

async function tenant(db, eid) {
  await db.query("select set_config('app.current_enterprise_id',$1,false), set_config('app.is_platform_admin','false',false)", [String(eid)]);
}

async function foundations(db) {
  assert.deepEqual((await db.query(`select current_user role,rolsuper,rolbypassrls
    from pg_roles where rolname=current_user`)).rows[0], { role: 'sfp_app', rolsuper: false, rolbypassrls: false });
  await db.query("select set_config('app.is_platform_admin','true',false)");
  await db.query(`insert into app.enterprises(id,name,code,status) overriding system value values
    (1454,'I4 合成微云','xiaok-i4-1454','active'), (1455,'I4 合成对照','xiaok-i4-1455','active')`);
  const { rows: [user] } = await db.query("insert into app.users(nickname) values ('I4 合成业主') returning id");
  const { rows: [lead] } = await db.query(`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values (1454,$1,'I4 合成线索','13800000000','natural') returning id`, [user.id]);
  await tenant(db, 1454);
  const { rows: [project] } = await db.query(`insert into app.construction_projects(enterprise_id,lead_id,name)
    values (1454,$1,'I4 合成施工项目') returning id`, [lead.id]);
  const { rows: [conversation] } = await db.query(`insert into app.assistant_conversations(enterprise_id,purpose)
    values (1454,'customer_consultation') returning id`);
  return { uid: user.id, pid: project.id, cid: conversation.id };
}

async function message(db, ref, seq) {
  return (await db.query(`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content)
    values(1454,$1,$2,'user',$3,'{"version":1,"blocks":[{"type":"text","text":"请跟进卫生间和书房的施工"}]}') returning id`,
  [ref.cid, seq, ref.uid])).rows[0].id;
}

async function nativeRow(db, ref, mid, id, state, existing = true) {
  return db.query(`insert into app.native_workflow_delegations
    (enterprise_id,id,project_id,requester_id,conversation_id,origin_message_id,origin_hash,goal,authorization_scope,state,tasks,
      next_action,paused_at,cancelled_at,expires_at,next_wake_at)
    values(1454,$1,$2,$3,$4,$5,'i4-original-source','I4 原水电目标',$6,$7,$8,'review_design',
      case when $7='paused' then now() end, case when $7='cancelled' then now() end,now()+interval '30 days',now()+interval '1 day')`,
  [id, ref.pid, ref.uid, ref.cid, mid, nativeAuthorization, state, existing ? nativeTasks : '[]']);
}

async function reviewRow(db, ref, mid, id, status, index, unified = false) {
  return db.query(`insert into app.native_workflow_delegations
    (enterprise_id,id,project_id,owner_id,conversation_id,origin_message_id,origin_hash,title,objective,scope,
      completion_criteria,current_status,assigned_to,waiting_for,next_action,due_at,next_wake_at,authorization_scope,
      evidence,version,operation_key,reminder_stage,completed_at ${unified ? ',requester_id,goal,state,expires_at,tasks' : ''})
    values(1454,$1,$2,$3,$4,$5,'i4-original-source','I4 原事项标题','保留原指令',
      jsonb_build_object('kind','rectification_review','roomId','91','subject',$8::text),
      '项目负责人复核',$6,23,'reviewer','保留原下一步','2026-12-15T00:00:00Z','2026-12-01T00:00:00Z',$7,$9,3,
      $8,1,case when $6='completed' then now() end
      ${unified ? ",$3,'I4 原事项标题',app.native_delegation_review_state($6),'2026-12-15T00:00:00Z','[]'" : ''})`,
  [id, ref.pid, ref.uid, ref.cid, mid, status, historicalAuthorization, 'i4-review-' + index, receipt]);
}

async function outbox(db, ref, type, target, index) {
  return (await db.query(`insert into app.domain_event_outbox
    (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(1454,$1,'native_workflow_delegation',$2,$3,'{"kind":"system"}',$2,
      jsonb_build_object('projectId',$4::text,'delegationId',$2::text)) returning id`, [type, target, index, ref.pid])).rows[0].id;
}

async function seed(name, legacy, duplicate = false) {
  return asApp(name, async (db) => {
    const ref = await foundations(db);
    const states = legacy === 'native' ? nativeStates : Object.keys(userStates);
    let sharedMid;
    for (const [index, status] of states.entries()) {
      const id = randomUUID();
      const mid = duplicate && index === 1 ? sharedMid : await message(db, ref, index + 1);
      if (index === 0) sharedMid = mid;
      if (legacy === 'native') await nativeRow(db, ref, mid, id, status);
      else await reviewRow(db, ref, mid, id, status, index);
      const event = await outbox(db, ref, 'native.delegation.refresh.v1', id, 1);
      await db.query(`update app.native_workflow_delegations set activation_event_id=$1
        ${legacy === 'native' ? ',latest_event_id=$1' : ''} where enterprise_id=1454 and id=$2`, [event, id]);
      await db.query(`update app.domain_event_deliveries set status='retry_wait',attempts=2,
        last_error='provider_outcome_unknown',lease_token='i4-synthetic-old-lease',lease_expires_at=now()-interval '1 day'
        where enterprise_id=1454 and event_id=$1`, [event]);
      if (legacy === 'native') {
        await db.query(`insert into app.native_workflow_delegation_events(enterprise_id,delegation_id,event_id,outcome,task_changes)
          values(1454,$1,$2,'applied',$3)`, [id, event, nativeTasks]);
      } else {
        await db.query(`insert into app.native_workflow_delegation_events
          (enterprise_id,delegation_id,event_id,from_status,to_status,delegation_version,outcome,receipt)
          values(1454,$1,$2,'running',$3,3,'failed',$4)`, [id, event, status, receipt]);
      }
    }
    if (legacy === 'native') {
      await db.query(`insert into app.native_workflow_durable_tasks
        (enterprise_id,id,kind,business_key,status,state,next_attempt_at,deadline_at,updated_at,
         lease_owner,lease_token,lease_acquired_at,lease_heartbeat_at,lease_until)
        values(1454,'task-i4-legacy','tool.call','i4-unknown','waiting',
          '{"enterpriseId":"1454","taskId":"task-i4-legacy","kind":"tool.call","businessKey":"i4-unknown","status":"waiting",
            "data":{"dispatch":{"id":"original"},"receipt":null},"manual":{"code":"unknown_execution"}}',
          now(),now()+interval '1 day',now(),'old-worker','i4-old-token',now()-interval '2 days',now()-interval '2 days',now()-interval '1 day')`);
    }
    return ref;
  });
}

async function snapshot(name, tables) {
  return asApp(name, async (db) => {
    await tenant(db, 1454);
    const result = {};
    for (const [table, order] of Object.entries(tables)) {
      result[table] = (await db.query(`select to_jsonb(t) row from app.${table} t order by ${order}`)).rows.map(({ row }) => row);
    }
    return result;
  });
}

const delegationTables = {
  native_workflow_delegations: 'id', native_workflow_delegation_events: 'delegation_id,event_id',
  domain_event_outbox: 'id', domain_event_deliveries: 'id',
};

async function verifyUpgrade(name, legacy, before, rowsBefore, expectedTags) {
  const after = await snapshot(name, legacy === 'native'
    ? { ...delegationTables, native_workflow_durable_tasks: 'id' } : delegationTables);
  for (const [table, previous] of Object.entries(rowsBefore)) {
    assert.equal(after[table].length, previous.length, table);
    assert.deepEqual(after[table].map((row, i) => Object.fromEntries(Object.keys(previous[i]).map(key => [key, row[key]]))), previous, table);
  }
  const rows = after.native_workflow_delegations;
  if (legacy === 'bailian') {
    for (const row of rows) {
      assert.equal(row.requester_id, row.owner_id);
      assert.equal(row.goal, row.title);
      assert.equal(row.state, userStates[row.current_status]);
      assert.equal(row.expires_at, row.due_at);
      assert.deepEqual(row.tasks, []);
      assert.equal(row.paused_at, row.state === 'paused' ? row.updated_at : null);
      assert.equal(row.cancelled_at, row.state === 'cancelled' ? row.updated_at : null);
    }
  } else {
    assert.ok(rows.every(row => row.owner_id === null && row.scope === null && row.current_status === null));
  }
  const applied = await ledger(name);
  assert.deepEqual(applied.slice(0, before.length), before);
  assert.deepEqual(applied.slice(before.length).map(entry =>
    journal.find(item => String(item.when) === entry.created_at)?.tag.slice(0, 4)), expectedTags);
  for (const entry of applied.slice(before.length)) {
    const migration = journal.find(item => String(item.when) === entry.created_at);
    assert.ok(migration);
    assert.equal(entry.hash, hash(read(migration.tag)));
  }
  const rerun = migrate(name);
  assert.equal(rerun.code, 0, rerun.output);
  assert.deepEqual(await ledger(name), applied);
  assert.deepEqual(await snapshot(name, Object.fromEntries(Object.keys(after).map(key => [key,
    key === 'native_workflow_delegation_events' ? 'delegation_id,event_id' : 'id']))), after);
}

async function verifySchemaAndWrites(name, ref) {
  await asApp(name, async (db) => {
    await tenant(db, 1454);
    ref ??= await foundations(db);
    const { rows: relations } = await db.query(`select relname,relrowsecurity,relforcerowsecurity,
      has_table_privilege('sfp_app',oid,'SELECT') can_read, has_table_privilege('sfp_app',oid,'INSERT') can_insert,
      has_table_privilege('sfp_app',oid,'UPDATE') can_update, has_table_privilege('sfp_app',oid,'DELETE') can_delete
      from pg_class where relnamespace='app'::regnamespace and relkind='r'
      and relname ~ '^(native_workflow_|assistant_(long_term_memories|managed_knowledge_))'`);
    assert.equal(relations.length, 11);
    assert.ok(relations.every(({ relname, ...flags }) => relname && Object.values(flags).every(Boolean)));
    const { rows: triggers } = await db.query(`select tgname from pg_trigger where tgname in
      ('native_delegation_event_delivery','native_delegation_project_change','native_delegation_schedule_change',
       'assistant_knowledge_document_scope_immutable') and tgenabled='O'`);
    assert.equal(triggers.length, 4);
    const { rows: indexes } = await db.query(`select indexrelid::regclass::text name from pg_index
      where indisvalid and indisready and indexrelid::regclass::text in ('app.native_delegation_wake',
        'app.native_delegation_project_open','app.native_delegation_conversation','app.native_delegation_by_event',
        'app.native_delegation_project_scope','app.native_delegation_delivery_open','app.native_workflow_durable_ready',
        'app.native_workflow_durable_manual','app.native_workflow_tool_callback_due','app.native_delegation_electrical_origin')`);
    assert.equal(indexes.length, 10);

    const mid = await message(db, ref, 100);
    const nativeId = randomUUID(), reviewId = randomUUID();
    await nativeRow(db, ref, mid, nativeId, 'active');
    await assert.rejects(nativeRow(db, ref, mid, randomUUID(), 'active'), { code: '23505' });
    const reviewMid = await message(db, ref, 101);
    await reviewRow(db, ref, reviewMid, reviewId, 'pending', 'new', true);
    await assert.rejects(reviewRow(db, ref, reviewMid, randomUUID(), 'pending', 'new', true), { code: '23505' });
    await reviewRow(db, ref, reviewMid, randomUUID(), 'waiting_for_worker', 'new-other', true);
    const event = await outbox(db, ref, 'native.delegation.refresh.v1', nativeId, 1);
    const { rows: [delivery] } = await db.query(`update app.domain_event_deliveries set status='delivered',attempts=attempts+1
      where enterprise_id=1454 and event_id=$1 and consumer_key='native.delegation.v1' returning status,attempts`, [event]);
    assert.deepEqual(delivery, { status: 'delivered', attempts: 1 });
    await db.query(`insert into app.native_workflow_delegation_events(enterprise_id,delegation_id,event_id,outcome,task_changes)
      values(1454,$1,$2,'applied','[]')`, [nativeId, event]);
    await assert.rejects(db.query(`insert into app.native_workflow_delegation_events(enterprise_id,delegation_id,event_id,outcome,task_changes)
      values(1454,$1,$2,'applied','[]')`, [nativeId, event]), { code: '23505' });
    await db.query('update app.construction_projects set version=version+1 where enterprise_id=1454 and id=$1', [ref.pid]);
    const { rowCount: projectDelivery } = await db.query(`select d.id from app.domain_event_deliveries d
      join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
      where e.type='construction.project.changed.v1' and d.consumer_key='native.delegation.v1'`);
    assert.equal(projectDelivery, 1);
    await db.query(`insert into app.construction_plans(enterprise_id,project_id,title,starts_at,ends_at,status)
      values(1454,$1,'I4 合成计划',now(),now()+interval '1 day','confirmed')`, [ref.pid]);
    assert.equal((await db.query(`select d.id from app.domain_event_deliveries d
      join app.domain_event_outbox e on e.enterprise_id=d.enterprise_id and e.id=d.event_id
      where e.type='construction.schedule.changed.v1' and d.consumer_key='native.delegation.v1'`)).rowCount, 1);

    await tenant(db, 1455);
    for (const table of Object.keys(delegationTables)) assert.equal((await db.query(`select * from app.${table}`)).rowCount, 0, table);
    assert.equal((await db.query('select * from app.native_workflow_durable_tasks')).rowCount, 0);
    assert.equal((await db.query("update app.native_workflow_delegations set goal='cross-tenant' where id=$1", [nativeId])).rowCount, 0);
    await assert.rejects(nativeRow(db, ref, mid, randomUUID(), 'active'), { code: '42501' });
  });
}

function live(label, fn) {
  test(label, { skip: !baseUrl, timeout: 240_000 }, fn);
}

live('fresh PG17 applies the active journal and can be rerun with real app role access', async (t) => {
  const name = await provision('fresh');
  t.diagnostic(name);
  const run = migrate(name);
  assert.equal(run.code, 0, run.output);
  assert.equal((await ledger(name)).length, journal.length);
  await verifySchemaAndWrites(name);
  const rows = await ledger(name);
  assert.equal(migrate(name).code, 0);
  assert.deepEqual(await ledger(name), rows);
});

for (const legacy of ['native', 'bailian']) {
  live(`original ${legacy} journal preserves all delegation states, business keys and event/delivery data`, async (t) => {
    const name = await prepare(legacy, legacy, true);
    t.diagnostic(name);
    const ref = await seed(name, legacy);
    const before = await ledger(name);
    const snapshotBefore = await snapshot(name, legacy === 'native'
      ? { ...delegationTables, native_workflow_durable_tasks: 'id' } : delegationTables);
    const run = migrate(name);
    assert.equal(run.code, 0, run.output);
    const reconciliation = legacy === 'native' ? ['0124', '0125', '0126', '0127'] : ['0124', '0125', '0127'];
    await verifyUpgrade(name, legacy, before, snapshotBefore, [...reconciliation, ...stageAndPilotMigrations]);
    await verifySchemaAndWrites(name, ref);
  });
}

live('valid Bailian records from the same user message retain both original identities', async (t) => {
  const name = await prepare('siblings', 'bailian', false);
  t.diagnostic(name);
  const ref = await seed(name, 'bailian', true);
  const before = await ledger(name), snapshotBefore = await snapshot(name, delegationTables);
  const run = migrate(name);
  assert.equal(run.code, 0, run.output);
  await verifyUpgrade(name, 'bailian', before, snapshotBefore, ['0124', '0125', '0127', ...stageAndPilotMigrations]);
  await asApp(name, async (db) => {
    const { rows: [column] } = await db.query(`select atttypid::regtype::text type,attnotnull
      from pg_attribute where attrelid='app.assistant_knowledge_chunks'::regclass and attname='embedding'`);
    assert.deepEqual(column, { type: 'text', attnotnull: false });
  });
  await verifySchemaAndWrites(name, ref);
});

live('an integrated delegation database applies the pending reconciliation, stage and pilot migrations', async (t) => {
  const name = await prepare('integrated', 'bailian', true);
  t.diagnostic(name);
  const ref = await seed(name, 'bailian');
  await asMigrator(name, db => applyOriginal(db, journal.filter(({ idx }) => idx >= 120 && idx <= 122)));
  const before = await ledger(name), snapshotBefore = await snapshot(name, delegationTables);
  const run = migrate(name);
  assert.equal(run.code, 0, run.output);
  await verifyUpgrade(name, 'bailian', before, snapshotBefore, ['0127', ...stageAndPilotMigrations]);
  await verifySchemaAndWrites(name, ref);
});

live('the 0129 baseline applies the pilot scope and notification alignment migrations', async (t) => {
  const name = await prepare('pilot_scope');
  t.diagnostic(name);
  await asMigrator(name, db => applyOriginal(db, journal.filter(({ idx }) => idx >= 120 && idx <= 125)));
  await asApp(name, foundations);
  const before = await ledger(name);
  const facts = { enterprises: 'id', construction_projects: 'id', construction_stage_reminders: 'reminder_id',
    construction_report_settings: 'enterprise_id' };
  const snapshotBefore = await snapshot(name, facts);
  const run = migrate(name);
  assert.equal(run.code, 0, run.output);
  const applied = await ledger(name);
  assert.deepEqual(applied.slice(0, -2), before);
  assert.equal(applied.length, before.length + 2);
  assert.equal(applied.at(-2).hash, hash(read('0130_xiaok_pilot_project_scopes')));
  assert.equal(applied.at(-1).hash, hash(read('0131_platform_notification_config_not_null')));
  assert.deepEqual(await snapshot(name, facts), snapshotBefore);
  await asApp(name, async db => {
    const result = await db.query(`select relrowsecurity,relforcerowsecurity from pg_class
      where oid='app.xiaok_pilot_project_scopes'::regclass`);
    assert.deepEqual(result.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
    assert.equal((await db.query('select * from app.xiaok_pilot_project_scopes')).rowCount, 0);
  });
});

live('an actually applied unknown migration cannot hide earlier pending migrations', async (t) => {
  const name = await prepare('unknown');
  t.diagnostic(name);
  await asMigrator(name, async (db) => {
    const sql = 'create table app.i4_unrecognized_test_migration (id integer primary key)';
    await db.query('begin');
    await db.query(sql);
    await db.query('insert into app.__drizzle_migrations(hash,created_at) values($1,$2)', [hash(sql), 1795593600001]);
    await db.query('commit');
  });
  const before = await ledger(name);
  const run = migrate(name);
  assert.notEqual(run.code, 0, run.output);
  assert.match(run.output, /[Uu]nrecognized.*migration/);
  assert.deepEqual(await ledger(name), before);
  await asMigrator(name, async (db) => {
    assert.equal((await db.query("select to_regclass('app.native_workflow_delegations') relation")).rows[0].relation, null);
  });
});

// ---------------------------------------------------------------------------
// Approved historical-hash allowlist. Everything below is pure: no connection.
// ---------------------------------------------------------------------------

const allowlist = loadKnownHashes(fileURLToPath(folder));
const baseline = new Map(journal.map(({ tag }) => [tag, hash(read(tag))]));
const activeJournal = journal.map(({ when, tag }) => ({ when, tag, hashes: new Set([baseline.get(tag)]) }));
const migrations = journal.map(({ when, tag }) => ({ folderMillis: when, tag }));
// The 1454 ledger holds the 119 rows up to 0119; 0120 and 0124-0130 are pending.
const appliedJournal = journal.filter(({ idx }) => idx <= 118);
const historical = new Map(allowlist.map(entry => [entry.tag, entry]));

function ledgerRows({ historicalOnly = false } = {}) {
  return appliedJournal.map(({ when, tag }, index) => ({
    id: index + 1,
    created_at: when,
    hash: historicalOnly && historical.has(tag) ? historical.get(tag).hash : baseline.get(tag),
  }));
}

test('the committed allowlist holds exactly the two approved entries', () => {
  assert.deepEqual(
    allowlist.map(({ ledgerId, when, tag, hash: digest, approvedBy, approvedAt }) =>
      ({ ledgerId, when, tag, hash: digest, approvedBy, approvedAt })),
    [
      {
        ledgerId: 28, when: 1786540800000, tag: '0021_platform_notification_config',
        hash: '9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c',
        approvedBy: '项目负责人（用户明确批准）', approvedAt: '2026-11-15',
      },
      {
        ledgerId: 58, when: 1788184800000, tag: '0051_staff_referrer_network',
        hash: 'a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e',
        approvedBy: '项目负责人（用户明确批准）', approvedAt: '2026-11-15',
      },
    ]
  );
});

test('A. current journal hashes keep validating with and without the allowlist', () => {
  assert.equal(validateLedger(ledgerRows(), activeJournal, {}).seen.size, appliedJournal.length);
  assert.equal(validateLedger(ledgerRows(), activeJournal, {}, allowlist).seen.size, appliedJournal.length);
});

test('B. the approved 0021 historical hash is recognized', () => {
  const entry = historical.get('0021_platform_notification_config');
  const rows = ledgerRows({ historicalOnly: true });
  assert.ok(rows.some(row => row.created_at === entry.when && row.hash === entry.hash));
  assert.ok(validateLedger(rows, activeJournal, {}, allowlist).seen.has(entry.when));
});

test('C. the approved 0051 historical hash is recognized', () => {
  const entry = historical.get('0051_staff_referrer_network');
  const rows = ledgerRows({ historicalOnly: true });
  assert.ok(rows.some(row => row.created_at === entry.when && row.hash === entry.hash));
  assert.ok(validateLedger(rows, activeJournal, {}, allowlist).seen.has(entry.when));
});

test('D. a one-character change to the 0021 hash is rejected', () => {
  const rows = ledgerRows({ historicalOnly: true }).map(row => row.created_at === 1786540800000
    ? { ...row, hash: '8' + row.hash.slice(1) } : row);
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Unrecognized migration/);
  assert.throws(() => validateLedger(rows, activeJournal, {}, []), /Unrecognized migration/);
});

test('E. a one-character change to the 0051 hash is rejected', () => {
  const rows = ledgerRows({ historicalOnly: true }).map(row => row.created_at === 1788184800000
    ? { ...row, hash: 'b' + row.hash.slice(1) } : row);
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Unrecognized migration/);
});

test('F. a changed 0021 timestamp is rejected', () => {
  const rows = ledgerRows({ historicalOnly: true }).map(row => row.created_at === 1786540800000
    ? { ...row, created_at: 1786540800001 } : row);
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Unrecognized migration/);
});

test('G. a changed 0051 timestamp is rejected', () => {
  const rows = ledgerRows({ historicalOnly: true }).map(row => row.created_at === 1788184800000
    ? { ...row, created_at: 1788184800001 } : row);
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Unrecognized migration/);
});

test('H. a journal tag mismatch is rejected even with the right hash and timestamp', () => {
  const active = activeJournal.map(entry => entry.when === 1786540800000
    ? { ...entry, tag: '0021_platform_notification_config_renamed' } : entry);
  assert.throws(() => validateLedger(ledgerRows({ historicalOnly: true }), active, {}, allowlist),
    /Unrecognized migration/);
});

test('I. an unknown migration is still rejected', () => {
  const rows = [...ledgerRows({ historicalOnly: true }), { id: 200, created_at: 1795000000000, hash: 'f'.repeat(64) }];
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Unrecognized migration/);
});

test('J. an allowlist entry without an approver or approval date fails to load', () => {
  const entry = { ...allowlist[0] };
  const wrap = candidate => ({ version: 1, entries: [candidate] });
  assert.throws(() => parseKnownHashes(wrap({ ...entry, approvedBy: '' })), /approvedBy is required/);
  assert.throws(() => parseKnownHashes(wrap({ ...entry, approvedBy: undefined })), /approvedBy is required/);
  assert.throws(() => parseKnownHashes(wrap({ ...entry, approvedAt: '' })), /approvedAt must be an ISO date/);
  assert.throws(() => parseKnownHashes(wrap({ ...entry, approvedAt: '2026-11-15T00:00:00Z' })),
    /approvedAt must be an ISO date/);
});

test('K. a duplicated allowlist identity fails to load', () => {
  const entry = { ...allowlist[0] };
  assert.throws(() => parseKnownHashes({ version: 1, entries: [entry, { ...entry }] }), /duplicate/);
  assert.throws(() => parseKnownHashes({ version: 1, entries: [entry, { ...entry, when: entry.when + 1 }] }), /duplicate/);
  assert.throws(() => parseKnownHashes({ version: 1, entries: [entry, { ...entry, ledgerId: 999 }] }), /duplicate/);
});

test('L. an illegal SHA-256 value fails to load', () => {
  const entry = { ...allowlist[0] };
  const bad = ['abc', 'z'.repeat(64), 'A'.repeat(64), '9df6e11e*', entry.hash.slice(0, 63), entry.hash + '0'];
  for (const candidate of bad) {
    assert.throws(() => parseKnownHashes({ version: 1, entries: [{ ...entry, hash: candidate }] }),
      /hash must be a full lowercase SHA-256/, candidate);
  }
});

test('M. the duplicate timestamp check stays effective', () => {
  const rows = ledgerRows({ historicalOnly: true });
  rows.push({ ...rows.at(-1), id: 999 });
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /Duplicate migration timestamp/);
});

test('N. the migration prefix continuity check stays effective', () => {
  const rows = ledgerRows({ historicalOnly: true })
    .filter(row => row.created_at !== appliedJournal[5].when);
  assert.throws(() => validateLedger(rows, activeJournal, {}, allowlist), /gap before an applied entry/);
});

test('O. the mixed XiaoK fork history check stays effective', () => {
  const forks = {
    native: [{ when: 1000, tag: 'legacy_native', hashes: new Set(['a'.repeat(64)]) }],
    bailian: [{ when: 2000, tag: 'legacy_bailian', hashes: new Set(['b'.repeat(64)]) }],
  };
  const rows = [
    { id: 1, created_at: 1000, hash: 'a'.repeat(64) },
    { id: 2, created_at: 2000, hash: 'b'.repeat(64) },
  ];
  assert.throws(() => validateLedger(rows, [], forks, allowlist), /Mixed XiaoK fork migration history/);
});

test('P. allowlisted historical rows are applied, never pending', () => {
  const { seen } = validateLedger(ledgerRows({ historicalOnly: true }), activeJournal, {}, allowlist);
  const pending = pendingMigrations(migrations, seen, false);
  assert.ok(!pending.some(({ tag }) => tag === '0021_platform_notification_config'));
  assert.ok(!pending.some(({ tag }) => tag === '0051_staff_referrer_network'));
});

test('Q. every other migration keeps its journal order and pending set', () => {
  const { seen } = validateLedger(ledgerRows({ historicalOnly: true }), activeJournal, {}, allowlist);
  const pending = pendingMigrations(migrations, seen, false);
  assert.deepEqual(pending.map(({ tag }) => tag),
    journal.filter(({ idx }) => idx >= 119).map(({ tag }) => tag));
  assert.deepEqual([...seen].sort((a, b) => a - b),
    [...validateLedger(ledgerRows(), activeJournal, {}, []).seen].sort((a, b) => a - b));
});
