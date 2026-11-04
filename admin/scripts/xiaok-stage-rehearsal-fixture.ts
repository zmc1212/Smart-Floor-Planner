/** Prepares retained, labelled V1-03 rehearsal starting points in the isolated development clone. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

type RecordFixture = { room: string; title: string; completed: string; pending: string; coordination: string };
type StageFixture = {
  name: string; title: string; topic: string; locator: string;
  prerequisite: string; checklist: string; limit: string; records: RecordFixture[];
};
type Stage = 'design' | 'installation' | 'furnishing';
type Account = { username: string; password: string; role: 'enterprise_admin' | 'construction_staff' | 'designer'; name: string };
type Manifest = { sourceHash: string; keys: Record<string, string>; complete?: boolean; result?: unknown };

const admin = path.resolve(process.cwd());
const root = path.resolve(admin, '..');
const enterpriseId = '1454';
const testerId = '645';
const label = '合成手测｜';
const output = path.join(root, 'tmp/xiaok-retained-stage-rehearsal');
const manifestFile = path.join(output, 'manifest.json');
const accountsFile = path.join(output, 'accounts.private.json');
const source = fs.readFileSync(path.join(admin, 'scripts/fixtures/xiaok-v1-03-owner-rehearsal.zh-CN.json'));
const fixture = JSON.parse(source.toString('utf8')) as {
  homes: Array<{ name: string; rooms: string[]; owner: string; worker: string; designer: string }>;
  stages: Record<Stage, StageFixture>;
};
const sourceHash = createHash('sha256').update(source).digest('hex');
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(enterpriseId, work);
function writeJson(file: string, data: unknown) {
  const pending = file + '.pending';
  fs.writeFileSync(pending, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(pending, file);
}
let release: (() => Promise<void>) | undefined;
let enabledForSetup = false;

async function main() {
  loadEnvConfig(admin, true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
  const target = new URL(config.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432'
    && target.pathname === '/xiaok_embedding_eval', 'Use only the approved isolated clone');
  process.env.DATABASE_URL = target.toString();
  assert.equal(new URL(resolvePostgresRuntimeConfig().connectionString).pathname, target.pathname);
  const identity = await withPlatformTransaction(tx => one(tx, sql`select e.name,
    exists(select 1 from app.users u join app.wechat_identities w on w.user_id=u.id where u.id=${testerId}) as tester
    from app.enterprises e where e.id=${enterpriseId} and e.status='active'`));
  assert.ok(identity?.name === '微云' && identity.tester, 'Use the retained, approved development tester');
  assert.equal(fixture.homes.length, 2);
  if (!process.argv.includes('--seed-isolated')) {
    console.log(JSON.stringify({ dryRun: true, enterpriseId, testerId, homes: fixture.homes.map(h => h.name), stages: Object.keys(fixture.stages) }));
    return;
  }

  release = await lockAssistantAcceptance(target.toString());
  const policy = await read(tx => one(tx, sql`select enabled from app.construction_report_settings where enterprise_id=${enterpriseId}`));
  assert.equal(policy?.enabled, false, 'Seed only while the isolated report schedule is stopped');
  fs.mkdirSync(output, { recursive: true });
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN + '\\' + process.env.USERNAME;
    execFileSync('icacls.exe', [output, '/inheritance:r', '/grant:r', account + ':(OI)(CI)(F)', 'SYSTEM:(OI)(CI)(F)', 'Administrators:(OI)(CI)(F)'],
      { windowsHide: true, stdio: 'ignore' });
  } else fs.chmodSync(output, 0o700);
  const manifest: Manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { sourceHash, keys: {} };
  assert.equal(manifest.sourceHash, sourceHash, 'A different authored fixture needs a separately reviewed import');
  if (manifest.complete) {
    console.log(JSON.stringify({ alreadySeeded: true, manifest: manifestFile }));
    return;
  }
  const enabled = await read(tx => one(tx, sql`update app.assistant_enterprise_settings set enabled=true
    where enterprise_id=${enterpriseId} and enabled=false returning enabled`));
  assert.equal(enabled?.enabled, true, 'Seed only while the isolated Assistant is stopped');
  enabledForSetup = true;
  const key = (slot: string) => {
    if (!manifest.keys[slot]) {
      manifest.keys[slot] = randomUUID();
      writeJson(manifestFile, manifest);
    }
    return manifest.keys[slot];
  };
  const accounts: Record<string, Account> = fs.existsSync(accountsFile)
    ? JSON.parse(fs.readFileSync(accountsFile, 'utf8')) : {};
  async function staff(slot: string, role: Account['role'], display: string, phoneSuffix: number) {
    const username = 'xiaok_stage_rehearsal_1454_' + slot;
    const name = label + display;
    const phone = '1990100145' + phoneSuffix;
    if (!accounts[slot]) {
      assert.ok(!await withPlatformTransaction(tx => one(tx, sql`select id from app.admin_users where username=${username}`)),
        'Existing rehearsal account has no retained credentials');
      accounts[slot] = { username, role, name, password: 'XkStage-' + randomBytes(15).toString('base64url') };
      writeJson(accountsFile, accounts);
    }
    const entry = accounts[slot];
    assert.deepEqual([entry.username, entry.role, entry.name], [username, role, name]);
    const hash = await bcrypt.hash(entry.password, 10);
    return withPlatformTransaction(async tx => {
      const present = await one(tx, sql`select id::text,enterprise_id::text,role,display_name,phone from app.admin_users where username=${username}`);
      if (present) {
        assert.deepEqual([present.enterprise_id, present.role, present.display_name, present.phone], [enterpriseId, role, name, phone]);
        if (role === 'enterprise_admin') await tx.execute(sql`update app.admin_users
          set menu_permissions=array_append(menu_permissions,'assistant-knowledge')
          where id=${String(present.id)} and username=${username} and enterprise_id=${enterpriseId}
            and not ('assistant-knowledge'=any(menu_permissions))`);
        return String(present.id);
      }
      assert.ok(!await one(tx, sql`select phone from app.admin_users where phone=${phone} union all
        select phone from app.users where phone=${phone} limit 1`), 'Development phone placeholder already assigned');
      const menus = JSON.stringify([...new Set([...getDefaultMenuKeys(role), ...(role === 'enterprise_admin' ? ['assistant-knowledge'] : [])])]);
      const added = await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,
        display_name,phone,menu_permissions,construction_trades) values(${enterpriseId},${username},${hash},${role},'active',false,${name},${phone},
        ARRAY(select jsonb_array_elements_text(${menus}::jsonb)),
        ${role === 'construction_staff' ? sql`ARRAY['安装','软装']` : sql`ARRAY[]::text[]`}) returning id::text`);
      assert.ok(added?.id);
      return String(added.id);
    });
  }

  const boss = await staff('boss', 'enterprise_admin', '负责人·周工', 4);
  const worker = await staff('worker', 'construction_staff', '工人·陈师傅', 5);
  const designers = [await staff('designer_a', 'designer', '设计师·林木', 6), await staff('designer_b', 'designer', '设计师·简禾', 7)];
  const owner = new ConstructionService({ enterpriseId, adminId: boss });
  const knowledge = new KnowledgeService({ enterpriseId, adminId: boss });
  const projects = [];
  for (const [index, home] of fixture.homes.entries()) {
    const name = label + home.name;
    const stage: Stage = index === 0 ? 'design' : 'installation';
    const leadId = await read(async tx => {
      const old = await one(tx, sql`select id::text from app.leads where enterprise_id=${enterpriseId} and customer_user_id=${testerId} and name=${name}`);
      if (old) return String(old.id);
      return String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
        values(${enterpriseId},${testerId},${name},${'1990100145' + index},'natural') returning id::text`))!.id);
    });
    const project = await owner.execute('create', { leadId, name, managerId: boss, rooms: home.rooms }, key('project.' + index));
    const projectId = String(project.id);
    const detail = async () => (await owner.execute('detail', { projectId })).project as Row;
    for (const [role, adminId] of [['worker', worker], ['designer', designers[index]]] as const) {
      const member = await read(tx => one(tx, sql`select admin_id from app.construction_members where enterprise_id=${enterpriseId}
        and project_id=${projectId} and admin_id=${adminId} and role=${role} and active`));
      if (!member) await owner.execute('member', { projectId, expectedVersion: (await detail()).version, adminId, role, active: true,
        workLabel: fixture.stages[stage].topic }, key('member.' + index + '.' + role));
    }
    if ((await detail()).current_stage_key !== stage) await owner.execute('progress', {
      projectId, expectedVersion: (await detail()).version, stageKey: stage, note: '合成手测起始阶段', sendReminder: false,
    }, key('progress.' + index));
    const item = fixture.stages[stage].records[index];
    const messageId = key('record-source.' + index);
    const author = new SiteChatService({ enterpriseId, adminId: worker });
    const draft = await author.withWriteScope(projectId, async (tx, conversation) => {
      const prior = await one(tx, sql`select r.* from app.construction_site_records r join app.assistant_messages m
        on m.enterprise_id=r.enterprise_id and m.id=r.source_message_id where r.enterprise_id=${enterpriseId}
        and r.project_id=${projectId} and m.client_message_id=${messageId}`);
      if (prior) return prior;
      const room = await one(tx, sql`select id::text from app.construction_rooms where enterprise_id=${enterpriseId}
        and project_id=${projectId} and name=${item.room}`);
      assert.ok(room?.id);
      const message = await appendMessage(tx, author.actor, String(conversation.id), { author: 'admin', clientMessageId: messageId,
        purpose: 'site.source', content: { version: 1, blocks: [{ type: 'text', text: [item.completed, item.pending, item.coordination].join('\n') }] } });
      const data = { title: item.title, completed: item.completed, pending: item.pending, coordination: item.coordination,
        roomId: room.id, note: '四端合成手测现场记录。' };
      const row = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,
        author_id,status,data,room_id,room_name_snapshot) values(${enterpriseId},${projectId},${String(conversation.id)},${String(message.id)},${worker},
        'draft',${JSON.stringify(data)}::jsonb,${String(room.id)},${item.room}) returning *`))!;
      await recordVersion(tx, enterpriseId, row, worker, 'organized');
      return row;
    });
    const recordId = String(draft.id);
    if (draft.status === 'draft') await new SiteChatService(owner.actor).mutate(projectId, recordId, 'publish',
      { expectedVersion: Number(draft.version), audience: 'customer' }, key('record-publish.' + index));
    projects.push({ name, leadId, projectId, stage, recordId });
  }

  const sources = [];
  for (const [stage, data] of Object.entries(fixture.stages)) {
    const result = await knowledge.execute('create', { title: data.title, category: '四端合成手测', sourceType: 'manual_text', audience: 'customer_public',
      body: '适用条件：' + data.prerequisite + '\n核对事项：' + data.checklist,
      professional: { version: 1, kind: 'construction', topics: [data.name, data.topic],
        conditions: [{ field: 'stage', operator: 'in', values: [stage] }], prerequisites: [data.prerequisite], exceptions: [data.limit, '仅用于隔离合成手测。'],
        origin: { title: data.title, version: 'SHA-256 ' + sourceHash, locator: data.locator, authority: 'reference' },
        claim: null, review: { note: '隔离手测起点。手测环境启用时使用既有索引和发布入口。' } },
    }, key('knowledge.' + stage));
    const document = result.document as Row;
    const draft = result.draft as Row;
    assert.ok(document?.id && draft?.id);
    sources.push({ stage, documentId: String(document.id), versionId: String(draft.id) });
  }
  manifest.result = { enterpriseId, testerId, staff: { boss, worker, designers }, projects, sources };
  manifest.complete = true;
  writeJson(manifestFile, manifest);
  console.log(JSON.stringify({ retained: true, projects, knowledgeDrafts: sources, manifest: manifestFile }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (enabledForSetup) {
      const restored = await read(tx => one(tx, sql`update app.assistant_enterprise_settings set enabled=false
        where enterprise_id=${enterpriseId} and enabled=true returning enabled`));
      assert.equal(restored?.enabled, false);
    }
  } finally {
    try { await closePostgresPool(); } finally { await release?.(); }
  }
});
