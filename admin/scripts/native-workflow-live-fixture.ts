/** Development-only B4 native-workflow live fixture.
 *
 * Seeds one clearly labelled construction stage-reminder scenario into the
 * isolated B database (port 55433) so `constructionAccess`,
 * `recordStageReminder` and `syncConstructionReminders` can run unchanged.
 *
 * Connection (explicit, no fallback):
 *   B4_LIVE_FIXTURE_DATABASE_URL, which must be exactly
 *   sfp_owner@127.0.0.1:55433/smart_floor_planner
 * There is no default URL and no DATABASE_URL fallback.
 *
 * Usage: npx tsx scripts/native-workflow-live-fixture.ts --development
 */
import fs from 'node:fs';
import path from 'node:path';
import { hash } from 'bcryptjs';
import pg from 'pg';
import type { PoolClient } from 'pg';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';

const DEFAULT_ENTERPRISE_ID = 1454n;
const PREFIX = '[B4]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function resolveFixtureTarget() {
  try {
    return resolveB4DatabaseTarget({ purpose: 'fixture' });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const target = resolveFixtureTarget();

const enterpriseOption = option('--enterprise-id');
if (enterpriseOption !== undefined && !/^[1-9]\d*$/.test(enterpriseOption)) fail('--enterprise-id must be a positive integer.');
const enterpriseId = enterpriseOption === undefined ? DEFAULT_ENTERPRISE_ID : BigInt(enterpriseOption);
if (enterpriseOption === undefined && enterpriseId !== DEFAULT_ENTERPRISE_ID) fail('Refusing any enterprise other than 1454 without --enterprise-id.');

const connectionString = target.url;
console.log(`Fixture database: ${describeB4DatabaseTarget(target)}`);

const idBase = enterpriseId * 1_000_000n;
const adminId = idBase + 1n;
const customerUserId = idBase + 2n;
const leadId = idBase + 3n;
const projectId = idBase + 4n;
const conversationId = idBase + 5n;
const participantId = idBase + 6n;
const managerAdminId = idBase + 7n;
const workerAdminId = idBase + 8n;
const observerAdminId = idBase + 9n;

const staffAdmins: Array<{ id: bigint; username: string; displayName: string; memberRole: 'manager' | 'worker' | 'observer' }> = [
  { id: managerAdminId, username: `b4-live-manager-${enterpriseId}`, displayName: `${PREFIX} 项目经理`, memberRole: 'manager' },
  { id: workerAdminId, username: `b4-live-worker-${enterpriseId}`, displayName: `${PREFIX} 施工工人`, memberRole: 'worker' },
  { id: observerAdminId, username: `b4-live-observer-${enterpriseId}`, displayName: `${PREFIX} 观察员`, memberRole: 'observer' },
];

const defaultStages = [
  ['preparation', '前期'], ['design', '设计'], ['demolition', '拆改'], ['utilities', '水电'],
  ['masonry_carpentry', '泥木'], ['painting', '油漆'], ['installation', '安装'], ['furnishing', '软装'],
  ['completion', '完工'], ['move_in', '入住'],
].map(([key, name]) => ({ key, name, visitReminder: false, visitReason: '', watchPoints: '' }));
const stages = [...defaultStages, {
  key: 'plumbing',
  name: '水路',
  visitReminder: true,
  visitReason: '水路管线已铺设完成，建议到场核对走向、点位与打压结果。',
  watchPoints: '给水管走向与点位、排水坡度、冷热水间距、打压记录、线管保护。',
}];

const entrySnapshot = { kind: 'lead', id: String(leadId), label: `${PREFIX} 水路阶段提醒测试会话` };
const grantBasis = { kind: 'self', contextVersion: 1 };
const outFile = path.resolve(__dirname, '../tmp/b4-live/fixture.json');

type FixtureRow = Record<string, unknown>;

interface FixtureRowCheck {
  table: string;
  id: bigint;
  marker: string;
  sql: string;
  params: unknown[];
  matches: (row: FixtureRow) => boolean;
  actual: (row: FixtureRow) => string;
}

function snapshotOf(value: unknown): FixtureRow | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? parsed as FixtureRow : null;
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' ? value as FixtureRow : null;
}

function fixtureRowChecks(): FixtureRowCheck[] {
  const adminChecks = (id: bigint): FixtureRowCheck => ({
    table: 'app.admin_users',
    id,
    marker: `enterprise_id=${enterpriseId} and username like 'b4-live-%'`,
    sql: 'select enterprise_id, username from app.admin_users where id=$1::bigint',
    params: [String(id)],
    matches: (row) => String(row.enterprise_id) === String(enterpriseId)
      && String(row.username ?? '').startsWith('b4-live-'),
    actual: (row) => `enterprise_id=${String(row.enterprise_id)} username=${JSON.stringify(row.username)}`,
  });

  return [
    {
      table: 'app.enterprises',
      id: enterpriseId,
      marker: `code='B4-LIVE-${enterpriseId}' and name like '${PREFIX}%'`,
      sql: 'select code, name from app.enterprises where id=$1::bigint',
      params: [String(enterpriseId)],
      matches: (row) => row.code === `B4-LIVE-${enterpriseId}`
        && String(row.name ?? '').startsWith(PREFIX),
      actual: (row) => `code=${JSON.stringify(row.code)} name=${JSON.stringify(row.name)}`,
    },
    adminChecks(adminId),
    {
      table: 'app.users',
      id: customerUserId,
      marker: `enterprise_id=${enterpriseId} and username like 'b4-live-customer-%'`,
      sql: 'select enterprise_id, username from app.users where id=$1::bigint',
      params: [String(customerUserId)],
      matches: (row) => String(row.enterprise_id) === String(enterpriseId)
        && String(row.username ?? '').startsWith('b4-live-customer-'),
      actual: (row) => `enterprise_id=${String(row.enterprise_id)} username=${JSON.stringify(row.username)}`,
    },
    {
      table: 'app.leads',
      id: leadId,
      marker: `enterprise_id=${enterpriseId} and source='b4-live' and name like '${PREFIX}%'`,
      sql: 'select enterprise_id, source, name from app.leads where id=$1::bigint',
      params: [String(leadId)],
      matches: (row) => String(row.enterprise_id) === String(enterpriseId)
        && row.source === 'b4-live'
        && String(row.name ?? '').startsWith(PREFIX),
      actual: (row) => `enterprise_id=${String(row.enterprise_id)} source=${JSON.stringify(row.source)} name=${JSON.stringify(row.name)}`,
    },
    {
      table: 'app.construction_projects',
      id: projectId,
      marker: `enterprise_id=${enterpriseId} and lead_id=${leadId} and name like '${PREFIX}%'`,
      sql: 'select enterprise_id, lead_id, name from app.construction_projects where id=$1::bigint',
      params: [String(projectId)],
      matches: (row) => String(row.enterprise_id) === String(enterpriseId)
        && String(row.lead_id) === String(leadId)
        && String(row.name ?? '').startsWith(PREFIX),
      actual: (row) => `enterprise_id=${String(row.enterprise_id)} lead_id=${String(row.lead_id)} name=${JSON.stringify(row.name)}`,
    },
    {
      table: 'app.assistant_conversations',
      id: conversationId,
      marker: `enterprise_id=${enterpriseId} and title like '${PREFIX}%' and entry_snapshot kind=lead id=${leadId}`,
      sql: 'select enterprise_id, title, entry_snapshot from app.assistant_conversations where id=$1::bigint',
      params: [String(conversationId)],
      matches: (row) => {
        const snapshot = snapshotOf(row.entry_snapshot);
        return String(row.enterprise_id) === String(enterpriseId)
          && String(row.title ?? '').startsWith(PREFIX)
          && snapshot?.kind === 'lead'
          && String(snapshot?.id) === String(leadId);
      },
      actual: (row) => {
        const snapshot = snapshotOf(row.entry_snapshot);
        return `enterprise_id=${String(row.enterprise_id)} title=${JSON.stringify(row.title)} entry_snapshot.kind=${JSON.stringify(snapshot?.kind)} entry_snapshot.id=${JSON.stringify(snapshot?.id)}`;
      },
    },
    {
      table: 'app.assistant_participants',
      id: participantId,
      marker: `conversation_id=${conversationId} and user_id=${customerUserId}`,
      sql: 'select conversation_id, user_id from app.assistant_participants where id=$1::bigint',
      params: [String(participantId)],
      matches: (row) => String(row.conversation_id) === String(conversationId)
        && String(row.user_id) === String(customerUserId),
      actual: (row) => `conversation_id=${String(row.conversation_id)} user_id=${String(row.user_id)}`,
    },
    ...staffAdmins.map((staff) => adminChecks(staff.id)),
  ];
}

// Read-only: any existing fixed-ID row must already belong to this fixture.
// Missing rows are fine because this run will create them.
async function preflightFixtureOwnership(client: PoolClient): Promise<void> {
  for (const check of fixtureRowChecks()) {
    const result = await client.query(check.sql, check.params);
    for (const row of result.rows as FixtureRow[]) {
      if (!check.matches(row)) {
        throw new Error(
          `Fixture ownership conflict: table=${check.table} id=${String(check.id)} `
          + `reason=expected ${check.marker}; found ${check.actual(row)}. No rows were written.`,
        );
      }
    }
  }
}

async function main() {
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();

try {
  // Prove the connection pg opened is the verified target before any read that
  // could lead to a write. The URL was already rejected if it carried any
  // query parameter or fragment, and it is passed to pg unchanged.
  const identity = await client.query<{ database: string; username: string }>(
    'select current_database() as database, current_user as username',
  );
  const connected = identity.rows[0];
  if (!connected) throw new Error('PostgreSQL did not return the connection identity.');
  assertB4ConnectionIdentity(target, connected);

  await preflightFixtureOwnership(client);

  await client.query('begin');

  await client.query(
    `insert into app.enterprises(id,name,code,status,registration_mode,contact_person,branding,automation_config,ai_config,ai_policy)
     overriding system value
     values($1::bigint,$2,$3,'active','manual','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)
     on conflict(id) do update set name=excluded.name,status='active',updated_at=now()`,
    [String(enterpriseId), `${PREFIX} 微云原生编排测试`, `B4-LIVE-${enterpriseId}`],
  );

  const passwordHash = await hash('b4-live-only', 10);
  await client.query(
    `insert into app.admin_users(id,enterprise_id,username,password_hash,display_name,role,status,must_change_password)
     overriding system value
     values($1::bigint,$2::bigint,$3,$4,$5,'enterprise_admin','active',false)
     on conflict(id) do update set enterprise_id=excluded.enterprise_id,username=excluded.username,
       password_hash=excluded.password_hash,display_name=excluded.display_name,
       role=excluded.role,status='active',must_change_password=false,updated_at=now()`,
    [String(adminId), String(enterpriseId), `b4-live-admin-${enterpriseId}`, passwordHash, `${PREFIX} 企业管理员`],
  );

  await client.query(
    `insert into app.users(id,enterprise_id,username,nickname,role,phone,context_version)
     overriding system value
     values($1::bigint,$2::bigint,$3,$4,'user','13800001454',1)
     on conflict(id) do update set enterprise_id=excluded.enterprise_id,username=excluded.username,
       nickname=excluded.nickname,role='user',phone=excluded.phone,context_version=1,updated_at=now()`,
    [String(customerUserId), String(enterpriseId), `b4-live-customer-${enterpriseId}`, `${PREFIX} 客户业主`],
  );

  await client.query(
    `insert into app.leads(id,enterprise_id,name,phone,community_name,city,source,status,customer_user_id,archived_at)
     overriding system value
     values($1::bigint,$2::bigint,$3,'13800001454','[B4] 测试小区','杭州','b4-live','new',$4::bigint,null)
     on conflict(id) do update set enterprise_id=excluded.enterprise_id,name=excluded.name,phone=excluded.phone,
       community_name=excluded.community_name,city=excluded.city,status='new',
       customer_user_id=excluded.customer_user_id,archived_at=null,archived_by=null,
       archive_reason=null,archive_note=null,updated_at=now()`,
    [String(leadId), String(enterpriseId), `${PREFIX} 水路阶段测试客户`, String(customerUserId)],
  );

  // Progress revisions double as outbox aggregate versions. Pick the next free
  // version (never lower than the current project revision) so
  // recordStageReminder can always insert after previous test runs.
  const revision = await client.query(
    `select coalesce(max(aggregate_version),-1)+1 as next_version from app.domain_event_outbox
     where enterprise_id=$1::bigint and type='construction.stage.updated.v1'
       and aggregate_type='construction_project' and aggregate_id=$2`,
    [String(enterpriseId), String(projectId)],
  );
  const existingProject = await client.query(
    `select progress_revision from app.construction_projects where enterprise_id=$1::bigint and id=$2::bigint`,
    [String(enterpriseId), String(projectId)],
  );
  const progressRevision = Math.max(
    Number(existingProject.rows[0]?.progress_revision ?? -1),
    Number(revision.rows[0]?.next_version ?? 0),
  );

  await client.query(
    `insert into app.construction_projects(id,enterprise_id,lead_id,name,status,customer_access,version,
       current_stage_key,progress_note,progress_revision,stage_contacts)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,$4,'active',true,1,'plumbing','',$5::integer,'{}'::jsonb)
     on conflict(id) do update set enterprise_id=excluded.enterprise_id,lead_id=excluded.lead_id,name=excluded.name,
       status='active',customer_access=true,current_stage_key='plumbing',progress_note='',
       progress_revision=excluded.progress_revision,stage_contacts='{}'::jsonb,updated_at=now()`,
    [String(projectId), String(enterpriseId), String(leadId), `${PREFIX} 水路阶段测试项目`, progressRevision],
  );

  for (const staff of staffAdmins) {
    await client.query(
      `insert into app.admin_users(id,enterprise_id,username,password_hash,display_name,role,status,must_change_password)
       overriding system value
       values($1::bigint,$2::bigint,$3,$4,$5,'construction_staff','active',false)
       on conflict(id) do update set enterprise_id=excluded.enterprise_id,username=excluded.username,
         password_hash=excluded.password_hash,display_name=excluded.display_name,
         role=excluded.role,status='active',must_change_password=false,updated_at=now()`,
      [String(staff.id), String(enterpriseId), staff.username, passwordHash, staff.displayName],
    );
    await client.query(
      `insert into app.construction_members(enterprise_id,project_id,admin_id,role,active,work_label)
       values($1::bigint,$2::bigint,$3::bigint,$4,true,$5)
       on conflict(enterprise_id,project_id,admin_id) do update set role=excluded.role,active=true,
         work_label=excluded.work_label`,
      [String(enterpriseId), String(projectId), String(staff.id), staff.memberRole, `${PREFIX} 权限验证`],
    );
  }

  await client.query(
    `insert into app.construction_stage_settings(enterprise_id,stages,version)
     values($1::bigint,$2::jsonb,1)
     on conflict(enterprise_id) do update set stages=excluded.stages,version=1,updated_at=now()`,
    [String(enterpriseId), JSON.stringify(stages)],
  );

  await client.query(
    `insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,max_message_chars,retention_days)
     values($1::bigint,true,1000,10000000,100000000,4000,30)
     on conflict(enterprise_id) do update set enabled=true,updated_at=now()`,
    [String(enterpriseId)],
  );

  await client.query(
    `insert into app.assistant_conversations(id,enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
     overriding system value
     values($1::bigint,$2::bigint,'customer_consultation','open','ai',$3,$4::jsonb,1,1,0)
     on conflict(id) do update set purpose=excluded.purpose,status='open',mode='ai',title=excluded.title,
       entry_snapshot=excluded.entry_snapshot,updated_at=now()`,
    [String(conversationId), String(enterpriseId), `${PREFIX} 水路阶段提醒测试会话`, JSON.stringify(entrySnapshot)],
  );

  await client.query(
    `insert into app.assistant_participants(id,enterprise_id,conversation_id,principal_kind,user_id,admin_id,participant_role,grant_basis,status)
     overriding system value
     values($1::bigint,$2::bigint,$3::bigint,'user',$4::bigint,null,'owner',$5::jsonb,'active')
     on conflict(id) do update set status='active',revoked_at=null,grant_basis=excluded.grant_basis,updated_at=now()`,
    [String(participantId), String(enterpriseId), String(conversationId), String(customerUserId), JSON.stringify(grantBasis)],
  );

  const sequences: Array<[string, bigint]> = [
    ['app.enterprises', enterpriseId],
    ['app.admin_users', adminId],
    ['app.admin_users', managerAdminId],
    ['app.admin_users', workerAdminId],
    ['app.admin_users', observerAdminId],
    ['app.users', customerUserId],
    ['app.leads', leadId],
    ['app.construction_projects', projectId],
    ['app.assistant_conversations', conversationId],
    ['app.assistant_participants', participantId],
  ];
  for (const [table, value] of sequences) {
    await client.query(
      `select setval(pg_get_serial_sequence($1,'id')::regclass,
         greatest((select coalesce(max(id),0) from ${table}), $2::bigint))`,
      [table, String(value)],
    );
  }

  await client.query('commit');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  client.release();
  await pool.end();
  throw error;
}

try {
  await client.query(`select set_config('app.current_enterprise_id',$1,false)`, [String(enterpriseId)]);
  await client.query(`select set_config('app.is_platform_admin','false',false)`);

  const access = await client.query(
    `select app.construction_actor_access($1::bigint,$2::bigint) as role`,
    [String(adminId), String(enterpriseId)],
  );
  const accessRole = access.rows[0]?.role ?? null;

  const conversations = await client.query(
    `select p.id::text as project_id
     from app.assistant_conversations c
     join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.status='active'
     join app.leads l on l.enterprise_id=c.enterprise_id and l.customer_user_id=ap.user_id and l.archived_at is null
     join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
     where c.enterprise_id=$1::bigint and c.id=$2::bigint
       and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
       and p.customer_access and p.status='active'
       and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=l.id::text)
     order by p.id`,
    [String(enterpriseId), String(conversationId)],
  );
  const projectIds = conversations.rows.map((row: { project_id: string }) => String(row.project_id));

  if (accessRole !== 'owner') throw new Error(`construction_actor_access returned ${String(accessRole)} instead of owner`);
  if (!projectIds.includes(String(projectId))) throw new Error('syncConstructionReminders conversation join did not return the fixture project');

  for (const staff of staffAdmins) {
    const member = await client.query(
      `select role, active from app.construction_members
       where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
      [String(enterpriseId), String(projectId), String(staff.id)],
    );
    const row = member.rows[0];
    if (row?.role !== staff.memberRole || row?.active !== true) {
      throw new Error(`construction_members fixture check failed for admin ${String(staff.id)}: expected role ${staff.memberRole} and active=true`);
    }
  }

  const result = {
    enterpriseId: String(enterpriseId),
    adminId: String(adminId),
    managerAdminId: String(managerAdminId),
    workerAdminId: String(workerAdminId),
    observerAdminId: String(observerAdminId),
    customerUserId: String(customerUserId),
    leadId: String(leadId),
    projectId: String(projectId),
    conversationId: String(conversationId),
    stageKey: 'plumbing',
    constructionActorAccess: accessRole,
    conversationProjectIds: projectIds,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  client.release();
  await pool.end();
}
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
