import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { loadEnvConfig } from '@next/env';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';

loadEnvConfig(process.cwd(), true);

const enterpriseId = '1454';
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) ?? 'scenario-01';
assert.match(label, /^[a-z0-9-]{1,72}$/);
const target = new URL(process.env.XIAOK_I614_DATABASE_URL ?? 'http://missing');
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.username, 'sfp_app');
assert.ok(Number(target.port) >= 49152 && !target.search && !target.hash);
assert.match(target.pathname, /^\/xiaok_r6_(?:acceptance|model|hosted)(?:_[a-z0-9]+)?$/);

const output = 'tmp/i6.14/' + label;
mkdirSync(output, { recursive: true });
const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const save = (name: string, value: unknown) => writeFileSync(output + '/' + name + '.json', json(value), { flag: 'wx' });
const png = () => sharp({ create: { width: 480, height: 360, channels: 3, background: '#c9d6d0' } })
  .composite([{ input: Buffer.from('<svg width="480" height="360"><rect width="480" height="360" fill="#c9d6d0"/>'
    + '<rect x="36" y="36" width="408" height="288" fill="none" stroke="#1f6f52" stroke-width="3"/>'
    + '<text x="240" y="150" text-anchor="middle" font-size="30" fill="#1f3552">I6.14</text>'
    + '<text x="240" y="195" text-anchor="middle" font-size="24" fill="#1f3552">SYNTHETIC TEST IMAGE</text>'
    + '<text x="240" y="230" text-anchor="middle" font-size="20" fill="#4a5b52">NOT A REAL SITE PHOTO</text></svg>') }])
  .png().toBuffer();

async function configure() {
  await closePostgresPool();
  process.env.DATABASE_URL = target.href;
  const upstream = await getPlatformLlmRuntimeConfig();
  assert.ok(upstream?.providerKey === 'bailian' && upstream.model === 'deepseek-v4.1-flash-1017' && upstream.apiKey);
  return withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as name,current_user as role,
      (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) as bypass,
      (select count(*)::int from app.enterprises) as enterprises`);
    assert.equal(identity?.name, target.pathname.slice(1));
    assert.equal(identity?.role, 'sfp_app');
    assert.equal(identity?.bypass, false);
    assert.equal(identity?.enterprises, 1);
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('designer','I6.14 合成设计师',array['construction-projects']) on conflict(role_key) do nothing`);
    // The native agent executor and the owner delegation tool read this row.
    // Without it the owner follow-up turn never receives start_delegation.
    await tx.execute(sql`insert into app.assistant_enterprise_settings
      (enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,200,12000000,1000000000,30,${JSON.stringify({ runtime: 'langgraph-v1',
        providerKey: 'bailian', model: 'deepseek-v4.1-flash-1017', tools: true, imageInput: true,
        probeVersion: 'i614-synthetic' })}::jsonb)`);
    return identity;
  });
}

async function fixture() {
  const tag = 'I6.14 隔离防水 ' + label;
  const roles = [['enterprise_admin', '项目经理'], ['designer', '设计师'], ['construction_staff', '施工人员']] as const;
  type Staff = { id: string; userId: string; role: typeof roles[number][0]; name: string };
  const staff = await withPlatformTransaction(async tx => {
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${tag},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'i614-' + randomUUID()})`);
    const lead = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${enterpriseId},${uid},${tag},'13800000000','natural') returning id`))!.id);
    const users: Staff[] = [];
    let index = 0;
    for (const [role, name] of roles) {
      // Staff mini-program access resolves through admin_users.user_id and a
      // non-empty users.phone, so the synthetic staff get a real users row.
      const userId = String((await one(tx, sql`insert into app.users(nickname,phone,context_version)
        values(${tag + ' ' + name},${'139' + String(Date.now()).slice(-6) + String(index++).padStart(2, '0')},1) returning id`))!.id);
      const row = await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,menu_permissions,display_name)
        values(${enterpriseId},${userId},${'i614-' + randomUUID()},'unusable-synthetic',${role},'active',false,
          ${role === 'enterprise_admin' ? sql`array['assistant-knowledge']` : sql`array[]::text[]`},${tag + ' ' + name}) returning id`);
      users.push({ id: String(row!.id), userId, role, name: tag + ' ' + name });
    }
    return { uid, lead, manager: users[0], designer: users[1], worker: users[2] };
  });
  const managerActor = { enterpriseId, adminId: staff.manager.id };
  const construction = new ConstructionService(managerActor);
  const created = await construction.execute('create', { leadId: staff.lead, name: tag + ' 工地', managerId: staff.manager.id,
    rooms: ['卫生间', '厨房'] }, randomUUID());
  const pid = String(created.id);
  const change = async (action: string, values: Row) => {
    const detail = await construction.execute('detail', { projectId: pid });
    return construction.execute(action, { projectId: pid, expectedVersion: Number((detail.project as Row).version), ...values }, randomUUID());
  };
  await change('update', { name: tag + ' 工地', status: 'active', customerAccess: true });
  await change('member', { adminId: staff.designer.id, role: 'designer', active: true, workLabel: '设计核对' });
  await change('member', { adminId: staff.worker.id, role: 'worker', active: true, workLabel: '防水施工' });
  await change('progress', { stageKey: 'utilities', note: '卫生间防水施工中，管根处理需要补充现场资料。', sendReminder: false });
  const detail = await construction.execute('detail', { projectId: pid });
  const rooms = Object.fromEntries(((detail.rooms as Row[]) ?? []).map(room => [String(room.name), String(room.id)]));
  assert.ok(rooms['卫生间'] && rooms['厨房']);
  await construction.execute('saveSchedule', { projectId: pid, expectedVersion: 0, title: 'I6.14 卫生间防水进度', note: '隔离验收合成计划',
    nodes: [{ key: 'waterproof', stageKey: 'utilities', roomId: rooms['卫生间'], plannedStart: '2026-11-10', plannedEnd: '2026-11-20' },
      { key: 'inspection', stageKey: 'utilities', roomId: rooms['卫生间'], plannedStart: '2026-11-21', plannedEnd: '2026-11-24' }] }, randomUUID());
  return { tag, pid, rooms, ...staff, managerActor };
}

async function seedRecord(f: Awaited<ReturnType<typeof fixture>>) {
  const worker = new SiteChatService({ enterpriseId, adminId: f.worker.id });
  const media = await worker.upload(f.pid, randomUUID(), await png());
  const sent = await worker.send(f.pid, { text: '卫生间防水基层已清理，管根待处理，请项目团队核对。',
    mediaIds: [String(media.id)], capture: { kind: 'free' } }, randomUUID());
  assert.ok(sent.recordId, json(sent));
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  const structured: ModelTurnOutput = { text: json({ title: '卫生间防水基层', roomId: f.rooms['卫生间'],
    completed: '', pending: '管根防水待处理，需要补充处理后的现场照片。', coordination: '请项目经理确认管根处理要求。',
    note: 'I6.14 合成施工记录；图片为明确标记的合成测试素材，不是真实工地照片。' }),
  toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 20, outputTokens: 40 } };
  await processSiteRecord(lease!, async () => structured);
  const manager = new SiteChatService({ enterpriseId, adminId: f.manager.id });
  const page = await manager.read(f.pid);
  await manager.mutate(f.pid, String(sent.recordId), 'publish', {
    expectedVersion: ((page.versions as Row).records as Row)[String(sent.recordId)], audience: 'customer' }, randomUUID());
  return { recordId: String(sent.recordId), mediaId: String(media.id), messageId: String(sent.messageId) };
}

async function openAndAssignIssue(f: Awaited<ReturnType<typeof fixture>>, recordId: string) {
  const manager = new SiteChatService({ enterpriseId, adminId: f.manager.id });
  const versions = (await manager.read(f.pid)).versions;
  const opened = await manager.send(f.pid, { text: '跟进记录' + recordId + '：核对卫生间防水管根处理，待补充现场资料。',
    mediaIds: [], versions }, randomUUID());
  assert.ok(opened.issueId, json(opened));
  const issueId = String(opened.issueId);
  const confirm = await manager.send(f.pid, { text: '确认事项' + issueId, mediaIds: [], versions: (await manager.read(f.pid)).versions }, randomUUID());
  assert.equal(String(confirm.issueId), issueId);
  const transfer = await manager.send(f.pid, { text: '转交事项' + issueId + '给' + f.worker.name,
    mediaIds: [], versions: (await manager.read(f.pid)).versions }, randomUUID());
  assert.equal(String(transfer.issueId), issueId);
  return issueId;
}

async function main() {
  await configure();
  const f = await fixture();
  const record = await seedRecord(f);
  const issueId = await openAndAssignIssue(f, record.recordId);
  const actor: ActorContext = { enterpriseId, principal: { kind: 'user', userId: f.uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: f.lead } };
  const chat = new ConversationService(actor);
  const conversationId = String((await chat.create(randomUUID())).id);
  const ownerToken = await signMiniProgramToken({ sub: f.uid, id: f.uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
  const token = async (admin: typeof f.manager, role: typeof f.manager.role) => signMiniProgramToken({ sub: String(admin.userId), id: String(admin.userId), mode: 'staff',
    role, staffRole: role, staffId: String(admin.id), enterpriseId, contextVersion: 1, source: 'phone' });
  const tokens = {
    owner: ownerToken,
    manager: await token(f.manager, 'enterprise_admin'),
    designer: await token(f.designer, 'designer'),
    worker: await token(f.worker, 'construction_staff'),
  };
  const detail = await new ConstructionService({ enterpriseId, adminId: f.manager.id }).execute('detail', { projectId: f.pid });
  const issue = (detail.issues as Row[]).find(item => String(item.issueId) === issueId);
  assert.ok(issue, json(detail.issues));
  const fixtureValue = { enterpriseId, label, tag: f.tag, projectId: f.pid, projectName: f.tag + ' 工地',
    conversationId, ownerUserId: f.uid, leadId: f.lead, rooms: f.rooms, initialRecordId: record.recordId,
    initialMediaId: record.mediaId, issueId, issue: { status: issue.status, ownerId: issue.ownerId, ownerText: issue.ownerText },
    managerId: f.manager.id, designerId: f.designer.id, workerId: f.worker.id,
    managerUserId: f.manager.userId, designerUserId: f.designer.userId, workerUserId: f.worker.userId,
    workerName: f.worker.name, tokens, syntheticImage: output + '/synthetic-bathroom.png', createdAt: new Date().toISOString() };
  writeFileSync(output + '/fixture.private.json', json(fixtureValue));
  writeFileSync(output + '/synthetic-bathroom.png', await png());
  console.log(JSON.stringify({ passed: true, ...fixtureValue, tokens: Object.fromEntries(Object.keys(tokens).map(key => [key, 'signed'])) }, null, 2));
  await closePostgresPool();
}

main().catch(async error => {
  console.error(error);
  await closePostgresPool();
  process.exitCode = 1;
});
