import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveRestoreTarget, validateRestorePorts } from './assistant-restore-target.mjs';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

// This drill does not load .env. Any supplied application connection must
// resolve to the already isolated pgvector evaluation container and database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Drizzle identity IDs may contain gaps after rollbacks; migration file numbers
// are not database primary keys. Verify the actual repository SQL hashes.
const journal = JSON.parse(await fs.readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
const expectedMigrations = await Promise.all(journal.entries.filter(entry => entry.idx >= 58 && entry.idx <= 70).map(async entry => ({
  tag: entry.tag, hash: createHash('sha256').update(await fs.readFile(path.join(root, 'drizzle', entry.tag + '.sql'))).digest('hex'),
})));
if (expectedMigrations.length !== 13) throw new Error('Missing assistant migration journal entries');
const migrationHashesSql = expectedMigrations.map(m => "'" + m.hash + "'").join(',');
const evidenceDirectory = path.resolve(root, '../tmp/xiaok-vector');
const target = resolveRestoreTarget();
const sourceContainer = target.container;
const sourceDatabase = target.database;
const sourceOwner = target.owner;

function assertSafeIdentifier(label, value) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL identifier`);
  }
}

function assertSafePrefix(value) {
  if (!/^[a-z][a-z0-9_]{5,40}$/.test(value)) {
    throw new Error('Generated restore prefix is invalid');
  }
}

for (const [label, value] of [
  ['XIAOK_RESTORE_SOURCE_CONTAINER', sourceContainer],
  ['XIAOK_RESTORE_SOURCE_DATABASE', sourceDatabase],
  ['XIAOK_RESTORE_SOURCE_OWNER', sourceOwner],
]) {
  if (label === 'XIAOK_RESTORE_SOURCE_CONTAINER') {
    if (value !== target.container) {
      throw new Error(`${label} conflicts with the isolated target`);
    }
  } else {
    assertSafeIdentifier(label, value);
  }
}
if (sourceDatabase !== target.database || sourceOwner !== target.owner) {
  throw new Error('Restore acceptance is fixed to the isolated xiaok_embedding_eval source; production databases are refused');
}

const token = randomUUID().replaceAll('-', '').slice(0, 12);
const prefix = `restore_${token}`;
assertSafePrefix(prefix);
const cloneA = `xiaok_restore_${token}_a`;
const cloneB = `xiaok_restore_${token}_b`;
const sourceDump = `/tmp/${prefix}_source.dump`;
const fixtureDump = `/tmp/${prefix}_fixture.dump`;

function quoteIdentifier(value) {
  assertSafeIdentifier('identifier', value);
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runProcess(command, args, input = '', options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: options.env || process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const commandText = [command, ...args].slice(0, 5).join(' ');
      const detail = stderr.trim().slice(-1800);
      reject(new Error(`${commandText} failed with exit code ${code ?? 1}${detail ? `: ${detail}` : ''}`));
    });
    child.stdin.end(input);
  });
}

function dockerExec(args, input = '') {
  return runProcess('docker', ['--context', target.context, 'exec', '-i', sourceContainer, ...args], input);
}

function psql(database, sql) {
  return dockerExec(
    [
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
      '-F',
      '\t',
      '-P',
      'pager=off',
      '-U',
      sourceOwner,
      '-d',
      database,
    ],
    // Only synthetic clones need platform-scoped fixture setup under 0063.
    (database === cloneA || database === cloneB ? "set app.is_platform_admin='true';\n" : '') + sql
  );
}

async function rows(database, sql) {
  const output = await psql(database, sql);
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
}

async function one(database, sql, label) {
  const result = await rows(database, sql);
  if (result.length !== 1) {
    throw new Error(`${label} expected one row, got ${result.length}`);
  }
  return result[0];
}

async function dropDatabase(database) {
  await dockerExec(['dropdb', '-U', sourceOwner, '--if-exists', database]);
}

async function createDatabase(database) {
  await dockerExec(['createdb', '-U', sourceOwner, database]);
}

async function dumpDatabase(database, destination) {
  await dockerExec(['pg_dump', '-U', sourceOwner, '-d', database, '-Fc', '-f', destination]);
}

async function restoreDatabase(database, dumpPath) {
  await dockerExec([
    'pg_restore',
    '-U',
    sourceOwner,
    '-d',
    database,
    '--exit-on-error',
    dumpPath,
  ]);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) throw new Error(message);
}

async function tableNames(database) {
  const result = await rows(
    database,
    `select table_name
       from information_schema.tables
      where table_schema='app'
        and (table_name like 'assistant_%' or table_name like 'domain_event_%' or table_name='ai_provider_attempts')
      order by table_name`
  );
  return result.map(([name]) => name);
}

async function snapshot(database) {
  const names = await tableNames(database);
  assertTrue(names.length > 0, `${database} contains no assistant tables`);
  const selects = names.map((name) => {
    const identifier = `app.${quoteIdentifier(name)}`;
    return `select ${quoteLiteral(name)} as table_name,
                   count(*)::bigint as row_count,
                   md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as digest
              from ${identifier} t`;
  });
  const values = await rows(
    database,
    `select table_name,row_count,digest from (${selects.join('\nunion all\n')}) snapshot order by table_name`
  );
  return Object.fromEntries(values.map(([name, count, digest]) => [name, { count: Number(count), digest }]));
}

function compareSnapshots(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.flatMap((name) => {
    const a = before[name];
    const b = after[name];
    if (!a || !b || a.count !== b.count || a.digest !== b.digest) {
      return [{ table: name, before: a ?? null, after: b ?? null }];
    }
    return [];
  });
}

async function schemaSummary(database) {
  const row = await one(
    database,
    `select
       (select count(*) from information_schema.tables where table_schema='app')::int,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='app' and c.relrowsecurity and c.relforcerowsecurity)::int,
       (select count(*) from pg_policies where schemaname='app')::int,
       (select count(*) from app.__drizzle_migrations where hash in (${migrationHashesSql}))::int`,
    `${database} schema summary`
  );
  return row.map(Number);
}

async function migrationRows(database) {
  return rows(
    database,
    `select id::int,hash from app.__drizzle_migrations where hash in (${migrationHashesSql}) order by id`
  );
}

async function requiredColumns(database) {
  const expected = {
    assistant_conversations: ['last_seq'],
    assistant_knowledge_documents: ['published_version_id'],
    assistant_knowledge_versions: ['index_status', 'reference_case'],
    assistant_message_citations: ['quote_snapshot', 'chunk_id'],
    assistant_usage_records: ['input_tokens', 'output_tokens'],
    assistant_quota_reservations: ['settled_tokens', 'settled_cost_micros'],
    assistant_cost_reviews: ['cost_micros', 'evidence_reference'],
    assistant_requirement_summaries: ['draft_fields', 'confirmed_fields', 'source_seq', 'lead_id'],
    assistant_media: ['data', 'source_ref', 'deleted_at', 'source_hash'],
    assistant_enterprise_settings: ['agent_config'],
    assistant_run_steps: ['private_checkpoint'],
  };
  const result = [];
  for (const [table, columns] of Object.entries(expected)) {
    const tableRows = await rows(
      database,
      `select column_name from information_schema.columns
        where table_schema='app' and table_name=${quoteLiteral(table)}
          and column_name in (${columns.map(quoteLiteral).join(',')})
        order by column_name`
    );
    const actual = tableRows.map(([column]) => column);
    result.push({ table, expected: columns, actual, passed: columns.every((column) => actual.includes(column)) });
  }
  return result;
}

async function seedFixture(database) {
  const seed = async (sql) => rows(database, sql);
  const tenantA = (await one(
    database,
    `insert into app.enterprises(name,code,status) values(${quoteLiteral(`${prefix}_enterprise_a`)},${quoteLiteral(`${prefix}_code_a`)},'active') returning id`,
    'tenant A'
  ))[0];
  const tenantB = (await one(
    database,
    `insert into app.enterprises(name,code,status) values(${quoteLiteral(`${prefix}_enterprise_b`)},${quoteLiteral(`${prefix}_code_b`)},'active') returning id`,
    'tenant B'
  ))[0];

  const [adminA] = await one(
    database,
    `insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
       values(${quoteLiteral(tenantA)},${quoteLiteral(`${prefix}_admin_a`)},'restore-test-only','enterprise_admin','active',ARRAY['assistant-knowledge','assistant-usage','assistant-usage-reconcile'],false)
       returning id`,
    'admin A'
  );
  const [adminB] = await one(
    database,
    `insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
       values(${quoteLiteral(tenantB)},${quoteLiteral(`${prefix}_admin_b`)},'restore-test-only','enterprise_admin','active',ARRAY['assistant-knowledge','assistant-usage'],false)
       returning id`,
    'admin B'
  );
  const [userA] = await one(
    database,
    `insert into app.users(nickname,context_version) values(${quoteLiteral(`${prefix}_user_a`)},1) returning id`,
    'user A'
  );
  const [userB] = await one(
    database,
    `insert into app.users(nickname,context_version) values(${quoteLiteral(`${prefix}_user_b`)},1) returning id`,
    'user B'
  );
  await seed(`insert into app.wechat_identities(user_id,openid) values
    (${quoteLiteral(userA)},${quoteLiteral(`${prefix}_openid_a`)}),
    (${quoteLiteral(userB)},${quoteLiteral(`${prefix}_openid_b`)})`);
  await seed(`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
    values
      (${quoteLiteral(tenantA)},true,1000,12000000,1000000000,90),
      (${quoteLiteral(tenantB)},true,1000,12000000,1000000000,90)`);

  const [profileA] = await one(
    database,
    `insert into app.assistant_knowledge_index_profiles(enterprise_id,profile_key,configuration,status)
       values(${quoteLiteral(tenantA)},${quoteLiteral(`${prefix}_profile_a`)},'{"dimensions":1024,"revision":"restore-synthetic"}'::jsonb,'active') returning id`,
    'knowledge profile A'
  );
  const [docA] = await one(
    database,
    `insert into app.assistant_knowledge_documents(enterprise_id,title,category,source_type,audience,status,created_by,updated_by)
       values(${quoteLiteral(tenantA)},${quoteLiteral(`${prefix} 防水知识`)},'acceptance','manual_text','customer_public','draft',${quoteLiteral(adminA)},${quoteLiteral(adminA)}) returning id`,
    'knowledge document A'
  );
  const body = `${prefix} synthetic published knowledge: waterproofing requires a 48 hour closed-water test.`;
  const [versionA] = await one(
    database,
    `insert into app.assistant_knowledge_versions(enterprise_id,document_id,version_number,body,faq,content_hash,edit_version,index_status,index_profile_id,indexed_hash,chunk_count,published_at,published_by,created_by)
       values(${quoteLiteral(tenantA)},${quoteLiteral(docA)},1,${quoteLiteral(body)},'[]'::jsonb,${quoteLiteral(`${prefix}_content_hash`)},1,'ready',${quoteLiteral(profileA)},${quoteLiteral(`${prefix}_content_hash`)},1,now(),${quoteLiteral(adminA)},${quoteLiteral(adminA)}) returning id`,
    'knowledge version A'
  );
  await seed(`update app.assistant_knowledge_documents
    set status='active',published_version_id=${quoteLiteral(versionA)},updated_by=${quoteLiteral(adminA)},updated_at=now()
    where id=${quoteLiteral(docA)} and enterprise_id=${quoteLiteral(tenantA)}`);
  const [chunkA] = await one(
    database,
    `insert into app.assistant_knowledge_chunks(enterprise_id,document_version_id,index_profile_id,ordinal,text,text_hash,content_hash,locator,terms,embedding)
       values(${quoteLiteral(tenantA)},${quoteLiteral(versionA)},${quoteLiteral(profileA)},0,${quoteLiteral(body)},${quoteLiteral(`${prefix}_text_hash`)},${quoteLiteral(`${prefix}_content_hash`)},'{"section":"acceptance"}'::jsonb,ARRAY['waterproofing','48h'],('[' || repeat('0,',1023) || '0]')::vector) returning id`,
    'knowledge chunk A'
  );
  await seed(`update app.assistant_enterprise_settings
    set active_index_profile_id=${quoteLiteral(profileA)} where enterprise_id=${quoteLiteral(tenantA)}`);

  const [conversationA] = await one(
    database,
    `insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot)
       values(${quoteLiteral(tenantA)},'customer_consultation','open','ai',${quoteLiteral(`${prefix} customer session`)},'{"entry":"restore-acceptance"}'::jsonb) returning id`,
    'conversation A'
  );
  const [conversationB] = await one(
    database,
    `insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot)
       values(${quoteLiteral(tenantB)},'customer_consultation','open','ai',${quoteLiteral(`${prefix} other tenant session`)},'{"entry":"restore-acceptance"}'::jsonb) returning id`,
    'conversation B'
  );
  const [participantA] = await one(
    database,
    `insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,participant_role,grant_basis)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},'user',${quoteLiteral(userA)},'owner','{"basis":"synthetic"}'::jsonb) returning id`,
    'participant A'
  );
  await seed(`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,participant_role,grant_basis)
    values(${quoteLiteral(tenantB)},${quoteLiteral(conversationB)},'user',${quoteLiteral(userB)},'owner','{"basis":"synthetic"}'::jsonb)`);
  const [bindingA] = await one(
    database,
    `insert into app.assistant_context_bindings(enterprise_id,conversation_id,resource_type,resource_id,relation,source_version)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},'lead',${quoteLiteral(`${prefix}_lead`)},'primary','restore-v1') returning id`,
    'context binding A'
  );
  const content = `{"version":1,"blocks":[{"type":"text","text":${JSON.stringify(`${prefix} question`)}}]}`;
  const [questionMessageA] = await one(
    database,
    `insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,client_message_id,purpose)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},1,'user',${quoteLiteral(userA)},${quoteLiteral(content)}::jsonb,${quoteLiteral(`${prefix}_client_message`)},'question') returning id`,
    'question message A'
  );
  const [runA] = await one(
    database,
    `insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,purpose,status,policy_snapshot,context_revision,knowledge_epoch,answer_kind,completed_at)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},'user_message',${quoteLiteral(questionMessageA)},'reply','succeeded','{"source":"restore"}'::jsonb,1,1,'grounded',now()) returning id`,
    'run A'
  );
  await seed(`update app.assistant_messages set run_id=${quoteLiteral(runA)},updated_at=now()
    where enterprise_id=${quoteLiteral(tenantA)} and id=${quoteLiteral(questionMessageA)}`);
  const [chatJobA] = await one(
    database,
    `insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key,status,attempts)
       values(${quoteLiteral(tenantA)},'chat_turn',${quoteLiteral(runA)},${quoteLiteral(`${prefix}_chat_job`)},'succeeded',1) returning id`,
    'chat job A'
  );
  const answerContent = `{"version":1,"blocks":[{"type":"text","text":${JSON.stringify(`${prefix} grounded answer`)}}]}`;
  const [answerMessageA] = await one(
    database,
    `insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,content,run_id,purpose,answer_kind)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},2,'assistant',${quoteLiteral(answerContent)}::jsonb,${quoteLiteral(runA)},'reply','grounded') returning id`,
    'answer message A'
  );
  await seed(`update app.assistant_runs set output_message_id=${quoteLiteral(answerMessageA)},updated_at=now()
    where enterprise_id=${quoteLiteral(tenantA)} and id=${quoteLiteral(runA)}`);
  const [runStepA] = await one(
    database,
    `insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,input_summary,source_refs,duration_ms,status)
       values(${quoteLiteral(tenantA)},${quoteLiteral(runA)},1,'answer','{"fixture":true}'::jsonb,'[{"source":"knowledge"}]'::jsonb,12,'succeeded') returning id`,
    'run step A'
  );
  const [citationA] = await one(
    database,
    `insert into app.assistant_message_citations(enterprise_id,conversation_id,message_id,run_id,source_kind,resource_type,resource_id,resource_version,document_id,document_version_id,chunk_id,source_hash,quote_snapshot,locator,is_draft)
       values(${quoteLiteral(tenantA)},${quoteLiteral(conversationA)},${quoteLiteral(answerMessageA)},${quoteLiteral(runA)},'knowledge','knowledge_chunk',${quoteLiteral(chunkA)},${quoteLiteral(versionA)},${quoteLiteral(docA)},${quoteLiteral(versionA)},${quoteLiteral(chunkA)},${quoteLiteral(`${prefix}_text_hash`)},${quoteLiteral(body)},'{"section":"acceptance"}'::jsonb,false) returning id`,
    'citation A'
  );
  const [knowledgeJobA] = await one(
    database,
    `insert into app.assistant_jobs(enterprise_id,kind,dedupe_key,status,attempts,knowledge_version_id,index_profile_id,content_hash,knowledge_edit_version,requested_by)
       values(${quoteLiteral(tenantA)},'knowledge_index',${quoteLiteral(`${prefix}_knowledge_job`)},'succeeded',1,${quoteLiteral(versionA)},${quoteLiteral(profileA)},${quoteLiteral(`${prefix}_content_hash`)},1,${quoteLiteral(adminA)}) returning id`,
    'knowledge job A'
  );
  const [knowledgeAttemptA] = await one(
    database,
    `insert into app.assistant_knowledge_attempts(enterprise_id,job_id,lease_token,operation,batch_ordinal,profile_key,model_revision,status,input_tokens,completed_at)
       values(${quoteLiteral(tenantA)},${quoteLiteral(knowledgeJobA)},${quoteLiteral(`${prefix}_lease`)},'embed',0,${quoteLiteral(`${prefix}_profile_a`)},'restore-synthetic','succeeded',42,now()) returning id`,
    'knowledge attempt A'
  );
  await seed(`insert into app.domain_event_outbox(enterprise_id,type,event_version,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${quoteLiteral(tenantA)},'assistant.restore.synthetic',1,'assistant_conversation',${quoteLiteral(conversationA)},1,'{"kind":"restore"}'::jsonb,${quoteLiteral(`${prefix}_correlation`)},'{"fixture":true}'::jsonb)`);
  const [eventId] = await one(
    database,
    `select id from app.domain_event_outbox where enterprise_id=${quoteLiteral(tenantA)} and correlation_id=${quoteLiteral(`${prefix}_correlation`)}`,
    'domain event A'
  );
  const [deliveryA] = await one(
    database,
    `insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
       values(${quoteLiteral(tenantA)},${quoteLiteral(eventId)},'assistant.restore.acceptance','delivered') returning id`,
    'domain delivery A'
  );
  await seed(`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,cost_micros,currency,measurement_kind,input_tokens,output_tokens)
    values(${quoteLiteral(tenantA)},${quoteLiteral(runA)},${quoteLiteral(`${prefix}_observed`)},'tokens',100,23000,'CNY','observed',80,20),
      (${quoteLiteral(tenantA)},${quoteLiteral(runA)},${quoteLiteral(`${prefix}_unknown`)},'provider_cost',null,null,null,'unavailable',null,null)`);
  const [reservationA] = await one(
    database,
    `insert into app.assistant_quota_reservations(enterprise_id,run_id,operation_key,reserved_requests,reserved_tokens,reserved_cost_micros,status,settled_tokens,settled_cost_micros)
       values(${quoteLiteral(tenantA)},${quoteLiteral(runA)},${quoteLiteral(`${prefix}_quota`)},1,100,1000000,'settled',100,23000) returning id`,
    'quota reservation A'
  );
  const [costReviewA] = await one(
    database,
    `insert into app.assistant_cost_reviews(enterprise_id,reservation_id,reviewer_id,tokens,cost_micros,currency,evidence_reference,reason)
       values(${quoteLiteral(tenantA)},${quoteLiteral(reservationA)},${quoteLiteral(adminA)},100,23000,'CNY',${quoteLiteral(`provider-bill:${prefix}`)},'Synthetic provider bill was reconciled after restore') returning id`,
    'cost review A'
  );
  const [idempotencyA] = await one(
    database,
    `insert into app.assistant_idempotency_records(enterprise_id,principal_key,operation,key,request_hash,result,expires_at)
       values(${quoteLiteral(tenantA)},${quoteLiteral(`user:${userA}`)},'conversation.create',${quoteLiteral(`${prefix}_idempotency`)},${quoteLiteral(`${prefix}_request_hash`)},${quoteLiteral(`{"conversationId":"${conversationA}"}`)}::jsonb,now()+interval '1 day') returning id`,
    'idempotency record A'
  );
  await seed(`update app.assistant_conversations set last_seq=2,updated_at=now() where enterprise_id=${quoteLiteral(tenantA)} and id=${quoteLiteral(conversationA)}`);

  return {
    prefix,
    tenantA,
    tenantB,
    adminA,
    adminB,
    userA,
    userB,
    profileA,
    docA,
    versionA,
    chunkA,
    conversationA,
    conversationB,
    participantA,
    bindingA,
    questionMessageA,
    runA,
    chatJobA,
    answerMessageA,
    runStepA,
    citationA,
    knowledgeJobA,
    knowledgeAttemptA,
    eventId,
    deliveryA,
    reservationA,
    costReviewA,
    idempotencyA,
  };
}

async function appScoped(database, enterpriseId, sql) {
  return psql(
    database,
    `begin;
set local role sfp_app;
select set_config('app.current_enterprise_id',${quoteLiteral(enterpriseId)},true);
select set_config('app.is_platform_admin','false',true);
${sql}
rollback;`
  );
}

async function appRows(database, enterpriseId, sql) {
  const output = await appScoped(database, enterpriseId, sql);
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
}

async function resolveServiceSourceUrl() {
  let raw = process.env.XIAOK_RESTORE_APP_URL || process.env.DATABASE_URL || '';
  if (!raw) {
    const privateConnectionPath = path.join(evidenceDirectory, 'connection.private.json');
    try {
      const privateConnection = JSON.parse((await fs.readFile(privateConnectionPath, 'utf8')).replace(/^\uFEFF/, ''));
      raw = privateConnection.DATABASE_URL || '';
    } catch {
      // The caller may provide the isolated app URL explicitly.  Do not read
      // any .env file as a fallback because this drill must never cut over the
      // running application.
    }
  }
  if (!raw) {
    throw new Error('Service access check requires XIAOK_RESTORE_APP_URL or the isolated connection.private.json');
  }
  const sourceUrl = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)
    || sourceUrl.port !== '55432'
    || sourceUrl.pathname !== `/${sourceDatabase}`) {
    throw new Error('Service access check accepts only the loopback:55432/xiaok_embedding_eval connection');
  }
  return sourceUrl;
}

async function runServiceCheck(database, fixture, phase) {
  const sourceUrl = await resolveServiceSourceUrl();
  const serviceUrl = new URL(sourceUrl.toString());
  serviceUrl.pathname = `/${database}`;
  const conversationModule = pathToFileURL(path.join(root, 'src/lib/assistant/core/conversation.ts')).href;
  const postgresModule = pathToFileURL(path.join(root, 'src/lib/postgresql.ts')).href;
  const childCode = `
import { ConversationService } from ${JSON.stringify(conversationModule)};
import { closePostgresPool } from ${JSON.stringify(postgresModule)};
async function main() {
const fixture = JSON.parse(process.env.XIAOK_RESTORE_FIXTURE_JSON);
const phase = process.env.XIAOK_RESTORE_SERVICE_PHASE;
const actor = {
  enterpriseId: fixture.tenantA,
  principal: { kind: 'user', userId: fixture.userA },
  contextVersion: 1,
  capabilities: ['assistant.chat.self']
};
const service = new ConversationService(actor);
const expectDenied = async (name, work) => {
  try {
    await work();
  } catch (error) {
    if (error?.code === 'assistant_resource_not_found') return;
    throw new Error(name + ' failed with unexpected code ' + String(error?.code || error));
  }
  throw new Error(name + ' unexpectedly remained accessible');
};
try {
  if (phase === 'active') {
    const detail = await service.detail(fixture.conversationA);
    const messages = await service.messages(fixture.conversationA);
    const citation = await service.citation(fixture.citationA);
    if (detail.id !== fixture.conversationA) throw new Error('restored conversation detail mismatch');
    if (!messages.items.some((item) => item.id === fixture.answerMessageA && item.available === true)) throw new Error('restored answer was not service-readable');
    if (citation.available !== true || citation.id !== fixture.citationA) throw new Error('restored citation was not service-readable');
    console.log(JSON.stringify({ phase, detail: true, readableAnswer: true, citationAvailable: true }));
  } else if (phase === 'withdrawn') {
    const citation = await service.citation(fixture.citationA);
    const messages = await service.messages(fixture.conversationA);
    const answer = messages.items.find((item) => item.id === fixture.answerMessageA);
    if (citation.available !== false || citation.reason !== 'source_unavailable') throw new Error('withdrawn citation did not become source_unavailable');
    if (!answer || answer.available !== false || !JSON.stringify(answer.content).includes('source_unavailable')) throw new Error('withdrawn answer was not redacted by service projection');
    console.log(JSON.stringify({ phase, citationAvailable: false, answerRedacted: true }));
  } else if (phase === 'revoked') {
    await expectDenied('conversation detail', () => service.detail(fixture.conversationA));
    await expectDenied('conversation messages', () => service.messages(fixture.conversationA));
    await expectDenied('citation', () => service.citation(fixture.citationA));
    console.log(JSON.stringify({ phase, detailDenied: true, messagesDenied: true, citationDenied: true }));
  } else {
    throw new Error('Unknown service verification phase: ' + phase);
  }
} finally {
  await closePostgresPool();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;
  const result = await runProcess(
    process.execPath,
    [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--eval', childCode],
    '',
    {
      env: {
        ...process.env,
        DATABASE_URL: serviceUrl.toString(),
        XIAOK_RESTORE_FIXTURE_JSON: JSON.stringify(fixture),
        XIAOK_RESTORE_SERVICE_PHASE: phase,
      },
    }
  );
  const lines = result.split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

async function verifyRestoredAccess(database, fixture) {
  const role = await one(
    database,
    `select rolsuper::text,rolbypassrls::text from pg_roles where rolname='sfp_app'`,
    'restored app role'
  );
  assertEqual(role[0], 'false', 'sfp_app must not be superuser after restore');
  assertEqual(role[1], 'false', 'sfp_app must not bypass RLS after restore');

  const active = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
     where c.id=${quoteLiteral(fixture.conversationA)} and p.user_id=${quoteLiteral(fixture.userA)} and p.status='active';`
  );
  assertEqual(active.at(-1)?.[0], '1', 'active customer conversation must be readable after restore');
  const citation = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_message_citations c
      join app.assistant_knowledge_documents d on d.enterprise_id=c.enterprise_id and d.id=c.document_id
      join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.document_id=c.document_id and v.id=c.document_version_id
     where c.id=${quoteLiteral(fixture.citationA)} and d.status='active' and v.published_at is not null;`
  );
  assertEqual(citation.at(-1)?.[0], '1', 'published citation must be available after restore');
  const hiddenOtherTenant = await appRows(
    database,
    fixture.tenantB,
    `select count(*)::int from app.assistant_conversations where id=${quoteLiteral(fixture.conversationA)};`
  );
  assertEqual(hiddenOtherTenant.at(-1)?.[0], '0', 'other tenant must not see the restored conversation');
  const platformRows = await psql(
    database,
    `begin;
set local role sfp_app;
select set_config('app.current_enterprise_id','',true);
select set_config('app.is_platform_admin','true',true);
select count(*)::int from app.assistant_conversations where id in (${quoteLiteral(fixture.conversationA)},${quoteLiteral(fixture.conversationB)});
rollback;`
  );
  assertEqual(platformRows.split(/\r?\n/).at(-1), '2', 'platform scoped read must see both synthetic tenants');
  const service = await runServiceCheck(database, fixture, 'active');
  return { activeConversationRows: 1, availableCitationRows: 1, crossTenantConversationRows: 0, platformConversationRows: 2, service };
}

async function verifyRevocationAndWithdrawal(database, fixture) {
  await psql(
    database,
    `begin;
select set_config('app.current_enterprise_id',${quoteLiteral(fixture.tenantA)},true);
select set_config('app.is_platform_admin','false',true);
update app.assistant_knowledge_documents set status='retired',version=version+1,updated_at=now(),updated_by=${quoteLiteral(fixture.adminA)}
 where enterprise_id=${quoteLiteral(fixture.tenantA)} and id=${quoteLiteral(fixture.docA)};
update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1,version=version+1,updated_at=now()
 where enterprise_id=${quoteLiteral(fixture.tenantA)};
commit;`
  );
  const activeAfterWithdraw = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
     where c.id=${quoteLiteral(fixture.conversationA)} and p.user_id=${quoteLiteral(fixture.userA)} and p.status='active';`
  );
  assertEqual(activeAfterWithdraw.at(-1)?.[0], '1', 'withdrawal must retain participant access for source projection');
  const withdrawn = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int as stored,
            count(*) filter (where d.status='active' and v.published_at is not null)::int as available
       from app.assistant_message_citations c
       join app.assistant_knowledge_documents d on d.enterprise_id=c.enterprise_id and d.id=c.document_id
       join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.document_id=c.document_id and v.id=c.document_version_id
      where c.id=${quoteLiteral(fixture.citationA)};`
  );
  const [stored, available] = withdrawn.at(-1) ?? [];
  assertEqual(stored, '1', 'withdrawn citation audit row must remain stored');
  assertEqual(available, '0', 'withdrawn citation must be unavailable to later reads');
  const serviceAfterWithdraw = await runServiceCheck(database, fixture, 'withdrawn');
  await psql(
    database,
    `begin;
select set_config('app.current_enterprise_id',${quoteLiteral(fixture.tenantA)},true);
select set_config('app.is_platform_admin','false',true);
update app.assistant_participants set status='revoked',revoked_at=now(),updated_at=now()
 where enterprise_id=${quoteLiteral(fixture.tenantA)} and id=${quoteLiteral(fixture.participantA)};
commit;`
  );
  const revoked = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
     where c.id=${quoteLiteral(fixture.conversationA)} and p.user_id=${quoteLiteral(fixture.userA)} and p.status='active';`
  );
  assertEqual(revoked.at(-1)?.[0], '0', 'revoked participant must lose conversation service access');
  const crossTenant = await appRows(
    database,
    fixture.tenantB,
    `select count(*)::int from app.assistant_message_citations where id=${quoteLiteral(fixture.citationA)};`
  );
  assertEqual(crossTenant.at(-1)?.[0], '0', 'withdrawn citation must remain tenant isolated');
  const revokedService = await runServiceCheck(database, fixture, 'revoked');
  return { activeConversationRowsAfterRevoke: 0, storedCitationRowsAfterWithdraw: 1, availableCitationRowsAfterWithdraw: 0, crossTenantCitationRows: 0, serviceAfterWithdraw, revokedService };
}

async function verifyUsageAndCost(database, fixture) {
  const result = await appRows(
    database,
    fixture.tenantA,
    `select
       count(*) filter (where operation_key=${quoteLiteral(`${prefix}_observed`)} and measurement_kind='observed' and quantity=100 and cost_micros=23000 and input_tokens=80 and output_tokens=20)::int,
       count(*) filter (where operation_key=${quoteLiteral(`${prefix}_unknown`)} and measurement_kind='unavailable' and quantity is null and cost_micros is null)::int
       from app.assistant_usage_records;`
  );
  const [observed, unknown] = result.at(-1) ?? [];
  assertEqual(observed, '1', 'observed usage tokens/cost must survive restore');
  assertEqual(unknown, '1', 'unknown usage must remain unknown after restore');
  const settled = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_quota_reservations
      where id=${quoteLiteral(fixture.reservationA)} and status='settled' and settled_tokens=100 and settled_cost_micros=23000;`
  );
  assertEqual(settled.at(-1)?.[0], '1', 'settled quota usage must survive restore');
  const review = await appRows(
    database,
    fixture.tenantA,
    `select count(*)::int from app.assistant_cost_reviews
      where id=${quoteLiteral(fixture.costReviewA)} and reservation_id=${quoteLiteral(fixture.reservationA)}
        and tokens=100 and cost_micros=23000 and currency='CNY';`
  );
  assertEqual(review.at(-1)?.[0], '1', 'cost review must reconcile the restored reservation');
  return { observedUsageRows: 1, unknownUsageRows: 1, settledReservationRows: 1, costReviewRows: 1 };
}

async function main() {
  const startedAt = Date.now();
  const evidence = {
    schemaVersion: 1,
    source: { context: target.context, container: sourceContainer, database: sourceDatabase, owner: sourceOwner },
    isolation: { sourceFixed: true, originalDatabaseUntouched: true, originalVolumeUntouched: true },
    databases: { restoreStage: cloneA, finalVerificationStage: cloneB },
    checks: {},
  };
  let completed = false;
  let release;
  let sourceVerified = false;
  const created = new Set();
  try {
    const endpoint = await runProcess('docker', ['context', 'inspect', target.context, '--format', '{{.Endpoints.docker.Host}}']);
    assertEqual(endpoint, target.endpoint, 'Docker context must match the documented isolated target');
    const ports = await runProcess('docker', ['--context', target.context, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', sourceContainer]);
    validateRestorePorts(JSON.parse(ports), target);
    const appUrl = await resolveServiceSourceUrl();
    release = await lockAssistantAcceptance(appUrl.toString());
    await dockerExec(['pg_isready', '-U', sourceOwner, '-d', sourceDatabase]);
    sourceVerified = true;

    await dockerExec(['pg_dump', '-U', sourceOwner, '-d', sourceDatabase, '-Fc', '-f', sourceDump]);
    await createDatabase(cloneA);
    created.add(cloneA);
    await restoreDatabase(cloneA, sourceDump);
    const sourceSchema = await schemaSummary(cloneA);
assertEqual(sourceSchema[3], expectedMigrations.length, 'restored source snapshot must contain migrations 0058-0070');
    evidence.checks.sourceSnapshotSchema = { appTables: sourceSchema[0], forcedRlsTables: sourceSchema[1], policies: sourceSchema[2], migrationRows: sourceSchema[3] };

    const fixture = await seedFixture(cloneA);
    evidence.fixture = { prefix: fixture.prefix, tenantRows: 2, sessionRows: 2, knowledgeRows: 1, citationRows: 1, usageRows: 2, costReviewRows: 1 };
    const beforeRestore = await snapshot(cloneA);
    await dumpDatabase(cloneA, fixtureDump);
    await createDatabase(cloneB);
    created.add(cloneB);
    await restoreDatabase(cloneB, fixtureDump);
    const afterRestore = await snapshot(cloneB);
    const snapshotDifferences = compareSnapshots(beforeRestore, afterRestore);
    assertEqual(snapshotDifferences.length, 0, `complete assistant backup/restore snapshot mismatch: ${JSON.stringify(snapshotDifferences.slice(0, 5))}`);
    evidence.checks.completeSnapshot = { tables: Object.keys(beforeRestore).length, differences: 0 };

    const finalSchema = await schemaSummary(cloneB);
    assertEqual(finalSchema[3], expectedMigrations.length, 'final restored database must retain migrations 0058-0070');
    assertEqual(finalSchema[0], sourceSchema[0], 'final restored app table count must match source snapshot');
    assertEqual(finalSchema[1], sourceSchema[1], 'final restored forced-RLS count must match source snapshot');
    assertEqual(finalSchema[2], sourceSchema[2], 'final restored policy count must match source snapshot');
    const columns = await requiredColumns(cloneB);
    assertTrue(columns.every((item) => item.passed), `required 0058-0070 columns missing after restore: ${JSON.stringify(columns.filter((item) => !item.passed))}`);
    evidence.checks.finalSchema = { appTables: finalSchema[0], forcedRlsTables: finalSchema[1], policies: finalSchema[2], migrationRows: finalSchema[3], requiredColumns: columns };
    const stageMigrations = await migrationRows(cloneA);
    const finalMigrations = await migrationRows(cloneB);
    assertEqual(stageMigrations.length, expectedMigrations.length, 'restore stage must contain exactly migrations 0058-0070');
    assertEqual(finalMigrations.length, expectedMigrations.length, 'final restore must contain exactly migrations 0058-0070');
    assertTrue(stageMigrations.every(([, hash]) => expectedMigrations.some(m => m.hash === hash)), 'restore stage migration hashes must match repository SQL');
    assertTrue(finalMigrations.every(([, hash]) => expectedMigrations.some(m => m.hash === hash)), 'final restore migration hashes must match repository SQL');
    assertEqual(JSON.stringify(stageMigrations), JSON.stringify(finalMigrations), 'migration IDs and hashes must survive restore');
    evidence.checks.migrations = finalMigrations.map(([id, hash]) => ({ id: Number(id), hash }));

    evidence.checks.accessBeforeRevoke = await verifyRestoredAccess(cloneB, fixture);
    evidence.checks.usageAndCost = await verifyUsageAndCost(cloneB, fixture);
    evidence.checks.revokeAndWithdraw = await verifyRevocationAndWithdrawal(cloneB, fixture);
    completed = true;
  } finally {
    const cleanupFailures = [];
    for (const database of [...created].reverse()) {
      await dropDatabase(database).catch(() => cleanupFailures.push(database));
    }
    if (sourceVerified) await dockerExec(['rm', '-f', sourceDump, fixtureDump]).catch(() => cleanupFailures.push('temporary_dumps'));
    if (release) await release().catch(() => cleanupFailures.push('acceptance_lock'));
    evidence.cleanup = { passed: cleanupFailures.length === 0, failures: cleanupFailures };
    evidence.success = completed && evidence.cleanup.passed;
    evidence.durationMs = Date.now() - startedAt;
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'assistant-restore-acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ success: evidence.success, cleanup: evidence.cleanup, tables: evidence.checks.completeSnapshot?.tables, durationMs: evidence.durationMs }));
    if (cleanupFailures.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`assistant restore acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
