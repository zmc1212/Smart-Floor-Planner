import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import sharp from 'sharp';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob, completeRun, failRun } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { persistNeedWrites } from '@/lib/assistant/agent/memory-store';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { speechConfigurationHash } from '@/lib/assistant/speech/local';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { PlanCustomerService, readPlan } from '@/lib/construction/site-plans';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { type ActorContext } from '@/lib/assistant/contracts';
import { runNativeDelegationTick } from '../live/delegation-worker';
import { delegationFromRow } from '../live/delegation-store';
import { delegationConsumer, delegationNotice } from '../live/delegation-state';

const live = process.env.B58_LIVE_DEVELOPMENT === '1';
const configuredModel = process.env.B58_CONFIGURED_MODEL === '1';
const tenant = '1454', controlTenant = '1455';
const label = '[B5.8] 合成 ' + randomUUID();
const text = (value: string) => ({ version: 1, blocks: [{ type: 'text', text: value }] });
const image = () => sharp({ create: { width: 96, height: 64, channels: 3, background: '#b8cbd8' } }).png().toBuffer();
const startText = '请持续跟进主卧的水电进展和书房的插座点位';
const runChild = promisify(execFile);
const liveTest = (title: string, fn: () => Promise<void>) => test(title, { skip: !live, timeout: 90000 }, fn);
let ownerPool: Pool;
let speechFixture: string | undefined;

function checkedTarget(value: string, role: string) {
  const url = new URL(value);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, process.env.XIAOK_ISOLATED_POSTGRES_PORT || '55433');
  assert.equal(url.pathname, '/xiaok_b58_test');
  assert.equal(url.username, role);
  assert.equal(url.search + url.hash, '');
  return url.toString();
}

before(async () => {
  if (!live) return;
  assert.notEqual(process.env.NODE_ENV, 'production');
  checkedTarget(resolvePostgresRuntimeConfig().connectionString, 'sfp_app');
  ownerPool = new Pool({ connectionString: checkedTarget(process.env.B58_MIGRATION_DATABASE_URL!, 'sfp_owner'), max: 1 });
  process.env.NATIVE_WORKFLOW_DELEGATION_ENABLED = '1';
  process.env.NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS = [tenant, controlTenant].join(',');
  await withPlatformTransaction(async tx => {
    const identity = await one(tx, sql`select current_database() as db, current_user as role, rolsuper,rolbypassrls
      from pg_roles where rolname=current_user`);
    assert.deepEqual(identity, { db: 'xiaok_b58_test', role: 'sfp_app', rolsuper: false, rolbypassrls: false });
    await tx.execute(sql`insert into app.system_roles(role_key,label,menu_keys) values('designer','合成设计师',ARRAY['construction-projects'])
      on conflict(role_key) do nothing`);
    for (const eid of [tenant, controlTenant]) {
      const name = eid === tenant ? '[B5.8] 微云隔离验收' : '[B5.8] 隔离对照企业';
      await tx.execute(sql`insert into app.enterprises(id,name,code,status) overriding system value
        values(${eid},${name},${'xiaok-b58-' + eid},'active') on conflict(id) do nothing`);
      assert.equal((await one(tx, sql`select name from app.enterprises where id=${eid}`))?.name, name);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,400,12000000,1000000000,30) on conflict(enterprise_id) do nothing`);
    }
  });
});

after(async () => {
  if (!live) return;
  await ownerPool?.end();
  await closePostgresPool();
  if (speechFixture) {
    for (const name of ['model.bin', 'tokenizer.json', 'config.json']) unlinkSync(join(speechFixture, name));
    rmdirSync(speechFixture);
  }
});

async function fixture(name: string, eid = tenant) {
  const prefix = label + '-' + name + '-' + randomUUID().slice(0, 6);
  const ids = await withPlatformTransaction(async tx => {
    const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${prefix})`);
    const lead = (await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${String(user.id)},${prefix},'13800000000','natural') returning id`))!;
    const staff = [];
    for (const [suffix, role] of [['manager','enterprise_admin'],['designer','designer'],['worker','construction_staff'],['outsider','construction_staff']]) {
      const username = 'b58-' + suffix + '-' + randomUUID();
      const actor = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${username},'synthetic-only',${role},'active',false,${suffix + ' B5.8'}) returning id`))!;
      staff.push(String(actor.id));
    }
    return { uid: String(user.id), leadId: String(lead.id), staff };
  });
  const [managerId, designerId, workerId, outsiderId] = ids.staff;
  const management = new ConstructionService({ enterpriseId: eid, adminId: managerId });
  const projectName = '合成水电 ' + name + ' ' + randomUUID().slice(0, 6);
  const project = await management.execute('create', { leadId: ids.leadId, name: projectName, managerId, rooms: ['主卧','书房','厨房'] }, randomUUID());
  const pid = String(project.id);
  for (const [adminId, role] of [[designerId,'designer'], [workerId,'worker']]) {
    const current = (await management.execute('detail', { projectId: pid })).project as Row;
    await management.execute('member', { projectId: pid, expectedVersion: Number(current.version), adminId, role, active: true, workLabel: '' }, randomUUID());
  }
  const manager = new SiteChatService(management.actor), designer = new SiteChatService({ enterpriseId: eid, adminId: designerId });
  const worker = new SiteChatService({ enterpriseId: eid, adminId: workerId }), outsider = new SiteChatService({ enterpriseId: eid, adminId: outsiderId });
  const page = await manager.read(pid);
  const room = Object.fromEntries((page.rooms as Row[]).map(row => [String(row.name), String(row.id)]));
  const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'user', userId: ids.uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: ids.leadId } };
  const owner = new ConversationService(actor);
  const cid = String((await owner.create(randomUUID())).id);
  return { eid, pid, projectName, room, owner, cid, actor, manager, designer, worker, outsider, management, ids };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const ownerSend = (f: Fixture, value: string, cid = f.cid, key = randomUUID()) => f.owner.send(cid, key, text(value), siteWatchInterceptor);
const start = (f: Fixture, remind = false, cid = f.cid, key = randomUUID()) => ownerSend(f, startText + (remind ? '，等我回复超时就在小K里提醒我。' : '。'), cid, key);
const readRow = (f: Fixture, cid = f.cid) => withTenantTransaction(f.eid, async tx => (await one(tx, sql`select * from app.native_workflow_delegations
  where enterprise_id=${f.eid} and conversation_id=${cid} order by created_at desc limit 1`))!);
const current = async (f: Fixture, cid = f.cid) => delegationFromRow(await readRow(f, cid));
const task = async (f: Fixture, key: string, cid = f.cid) => (await current(f, cid)).tasks.find(t => t.key === key)!;
async function tick(now = new Date()) {
  const result = await runNativeDelegationTick(process.env, now);
  assert.equal(result.enabled, true);
  assert.ok(result.enterprises.every(e => !('error' in e) && e.dead === 0), JSON.stringify(result));
  return result;
}
async function quick(f: Fixture, room: string, note: string, mediaIds: string[] = [], key = randomUUID()) {
  return f.worker.send(f.pid, { text: note, mediaIds, capture: { kind: 'quick', workId: 'wiring', roomId: f.room[room], location: null, progress: 'done' } }, key);
}
async function capture(f: Fixture, value: string, room: string, pending: boolean, mediaIds: string[] = [], recording?: string) {
  const sent = await f.worker.send(f.pid, { text: value, mediaIds, capture: { kind: 'free' }, ...(recording ? { recording } : {}) }, randomUUID());
  const lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async messages => {
    if (recording) assert.match(JSON.stringify(messages), /主卧底盒已经装好，书房还没施工/);
    return { text: JSON.stringify({ title: room + '插座底盒进展', roomId: f.room[room],
      completed: pending ? '' : '插座底盒已安装', pending: pending ? '书房插座位置待核对，尚未施工' : '', coordination: '', note: value }),
      toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 42, outputTokens: 21 } };
  }, async () => ({ text: '主卧底盒已经装好，书房还没施工。', durationMs: 500,
    modelHash: '0'.repeat(64), configurationHash: speechConfigurationHash()! }));
  return sent;
}
const siteUpload = async (f: Fixture, user = f.worker) => String((await user.upload(f.pid, randomUUID(), await image())).id);
async function siteSay(f: Fixture, staff: SiteChatService, message: string, mediaIds: string[] = []) {
  const page = await staff.read(f.pid);
  return staff.send(f.pid, { text: message, mediaIds, versions: page.versions }, randomUUID());
}
async function publishRecord(f: Fixture, recordId: string, audience = 'customer') {
  const page = await f.manager.read(f.pid), records = (page.versions as Row).records as Row;
  return f.manager.mutate(f.pid, recordId, 'publish', { expectedVersion: records[recordId], audience }, randomUUID());
}
async function saveAnswer(f: Fixture, value: string, writes: Row) {
  const sent = await ownerSend(f, value), lease = await claimJob();
  assert.equal(lease?.runId, sent.runId);
  await completeRun(lease!, { content: { version: 1, blocks: [{ type: 'text', text: '收到这次补充。' }] }, usage: null }, async tx => {
    const conversation = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.eid} and id=${f.cid}`))!;
    await persistNeedWrites(tx, f.actor, conversation, { runId: String(sent.runId), turn: 1, index: 0, sourceMessageId: String(sent.messageId) }, writes);
  });
  return sent;
}
async function setDrawing(f: Fixture, desc: string) {
  await new AssistantMediaService(f.actor).upload(f.cid, randomUUID(), await image(), 'floorplan', '书房');
  await ownerSend(f, '共享书房点位图：' + desc);
  return withTenantTransaction(f.eid, async tx => String((await one(tx, sql`select id from app.domain_event_outbox
    where enterprise_id=${f.eid} and type='construction.material.shared.v1' and payload->>'conversationId'=${f.cid}
      and payload->>'kind'='drawing' order by id desc limit 1`))!.id));
}
async function reviewSetup(f: Fixture, withDrawing = false) {
  const pending = await capture(f, '书房底盒还没固定，等核对插座位置。', '书房', true);
  const issueId = String((await siteSay(f, f.manager, '跟进记录' + String(pending.recordId))).issueId);
  await siteSay(f, f.designer, '接手事项' + issueId);
  const drawingId = withDrawing ? await setDrawing(f, '书房标注图，书桌位靠窗。') : null;
  if (drawingId) await siteSay(f, f.designer, '核对事项' + issueId + '图纸' + drawingId);
  await siteSay(f, f.designer, '回复事项' + issueId + '：书桌右侧点位建议，需核对并走确认。');
  const plan = await siteSay(f, f.designer, `发布方案事项${issueId}\n标题：书房插座点位\n差异：书桌右侧保留插座\n费用变化：0元\n工期变化：0天`,
    [await siteUpload(f, f.designer)]);
  return { issueId, planId: String(plan.planId), pendingId: String(pending.recordId) };
}
async function approve(f: Fixture, planId: string) {
  const plan = new PlanCustomerService(f.actor, f.cid);
  for (const action of ['preview', 'approve']) await plan.decide(planId, action, { expectedRevision: (await plan.read(planId)).revision }, randomUUID());
}
async function messages(f: Fixture, cid = f.cid) {
  return (await f.owner.messages(cid, undefined, 100)).items.map(message =>
    ({ ...message, text: (message.content as { blocks: { text?: string; fallbackText?: string }[] }).blocks.map(b => b.text || b.fallbackText || '').join('\n') }));
}
function syntheticAudio() {
  const model = speechFixture = mkdtempSync(join(tmpdir(), 'sfp-b58-test-asr-'));
  for (const name of ['model.bin', 'tokenizer.json', 'config.json']) writeFileSync(join(model, name), 'fixture');
  process.env.ASSISTANT_ASR_PROVIDER = 'local-faster-whisper';
  process.env.ASSISTANT_ASR_PYTHON = process.execPath;
  process.env.ASSISTANT_ASR_MODEL_PATH = model;
  process.env.ASSISTANT_ASR_MODEL_SHA256 = '0'.repeat(64);
  const data = Buffer.alloc(44 + 16000);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(16000, 40);
  return data.toString('base64');
}

liveTest('cross-day water/electrical journey: photo+voice, actual owner reply, authorized design and manager result return to the origin', async () => {
  const f = await fixture('六段流程');
  const initial = await start(f);
  await tick();
  const first = await current(f);
  assert.equal(first.originMessageId, initial.messageId);
  assert.deepEqual(first.tasks.map(t => t.next), ['collect_report','ask_owner']);
  assert.match((await messages(f)).find(m => /为了继续核对/.test(m.text))!.text, /书桌放在哪里，插座主要供哪些设备使用/);

  const photo = await siteUpload(f);
  const reported = await capture(f, '主卧底盒已经装好，书房还没施工。', '主卧', false, [photo], syntheticAudio());
  await tick();
  let progress = await task(f, 'progress');
  assert.equal(progress.evidence?.runId, reported.runId);
  assert.deepEqual(progress.evidence?.photoIds, [photo]);
  assert.equal(progress.next, 'review_report');
  assert.equal((await task(f, 'outlet')).next, 'ask_owner');
  await publishRecord(f, String(reported.recordId));
  await tick();
  progress = await task(f, 'progress');
  assert.equal(progress.next, 'done');
  assert.notEqual((await current(f)).state, 'completed');

  // Reload after a new Worker process and a new local day. The user answers the
  // one outstanding question in the original conversation, in their own words.
  await closePostgresPool();
  await saveAnswer(f, '书桌靠窗，主要使用电脑和台灯。', {
    room: '书房', field: 'desk', value: '靠窗', quote: '书桌靠窗',
    additionalNeeds: [{ room: '书房', field: 'devices', value: '电脑和台灯', quote: '主要使用电脑和台灯' }],
  });
  await tick(new Date(Date.now() + 25 * 3600_000));
  assert.equal((await task(f, 'outlet')).next, 'share_need');
  assert.equal((await task(f, 'outlet')).basis?.factIds.length, 2);
  assert.equal((await task(f, 'outlet')).staffNoticeId, undefined);
  await ownerSend(f, '共享书房需求：书桌靠窗，主要使用电脑和台灯。');
  await tick();
  const designerTask = await task(f, 'outlet');
  assert.equal(designerTask.next, 'review_design');
  assert.equal(designerTask.wait?.personId, f.designer.staff.adminId);
  const view = await f.designer.read(f.pid);
  assert.ok((view.items as { response?: Row }[]).some(item => String(item.response?.text).includes('请核对书房插座')));
  await assert.rejects(f.outsider.read(f.pid), /construction_not_found|assistant_resource_not_found/);
  assert.ok(!(await messages(f)).some(m => /事项\d+.*有效图纸/.test(m.text)));

  const { issueId, planId } = await reviewSetup(f);
  await tick();
  const pending = await task(f, 'outlet');
  assert.equal(pending.issueId, issueId);
  assert.ok(pending.opinionEventId);
  assert.equal(pending.plan?.status, 'pending_customer');
  assert.equal((await current(f)).state, 'awaiting_authorization');
  await assert.rejects(siteSay(f, f.designer, `落实事项${issueId}方案${planId}记录${reported.recordId}：照片已提交。`), /approved_plan_required/);
  await approve(f, planId);
  await tick();
  assert.equal((await task(f, 'outlet')).next, 'perform_work');

  const installedPhoto = await siteUpload(f);
  const installation = await capture(f, '书房右侧插座已经安装，拍了完工照片。', '书房', false, [installedPhoto]);
  await tick();
  const installed = await task(f, 'outlet');
  assert.deepEqual(installed.evidence?.photoIds, [installedPhoto]);
  assert.equal(installed.evidence?.recordId, installation.recordId);
  assert.equal(installed.next, 'review_work');
  assert.notEqual((await current(f)).state, 'completed');

  await publishRecord(f, String(installation.recordId), 'internal');
  await siteSay(f, f.designer, `落实事项${issueId}方案${planId}记录${installation.recordId}：现场已按方案安装，照片和原记录齐全。`);
  await tick();
  assert.equal((await task(f, 'outlet')).issueStatus, 'implemented');
  assert.equal((await task(f, 'outlet')).next, 'review_work');
  await siteSay(f, f.manager, `解决事项${issueId}\n结论：已复核本次安装原件\n回传：书房右侧插座已按确认方案安装，现场已复核。\n回传原件：是`);
  await tick();
  await deliverSiteResults();
  const completed = await current(f);
  assert.equal(completed.state, 'completed');
  assert.ok(completed.tasks.find(t => t.key === 'outlet')?.resultEventId);
  assert.equal(completed.conversationId, f.cid);
  const result = (await messages(f)).filter(m => m.text.includes('书房右侧插座已按确认方案安装，现场已复核'));
  assert.equal(result.length, 1);
  assert.equal(result[0].siteRecords[0]?.id, String(installation.recordId));
  const different = String((await f.owner.create(randomUUID())).id);
  assert.ok(!(await messages(f, different)).some(m => m.text.includes('现场已复核')));
  await quick(f, '厨房', '厨房的线材准备好了。');
  await tick();
  assert.deepEqual(await current(f), completed);
  await ownerSend(f, '查看水电跟进');
  assert.ok((await messages(f)).some(m => m.text.includes('本次跟进已完成')));
  console.log('B5.8 verified journey', JSON.stringify({ projectId: f.pid, conversationId: f.cid, delegationId: completed.id, issueId, planId, resultMessageId: result[0].id }));
});

liveTest('shared room event reaches two delegations once, with persisted recovery in a fresh process and tenant isolation', async () => {
  const f = await fixture('共享事件'), g = await fixture('对照企业', controlTenant);
  const another = String((await f.owner.create(randomUUID())).id);
  const commandKey = randomUUID();
  assert.deepEqual(await start(f, false, f.cid, commandKey), await start(f, false, f.cid, commandKey));
  await start(f, false, another);
  await start(g);
  await tick();
  const postKey = randomUUID();
  const photo = await siteUpload(f);
  const captured = await quick(f, '主卧', '主卧水电穿线完成。', [photo], postKey);
  assert.deepEqual(await quick(f, '主卧', '主卧水电穿线完成。', [photo], postKey), captured);
  const event = await withTenantTransaction(f.eid, tx => one(tx, sql`select e.id::text,d.status from app.domain_event_outbox e
    join app.domain_event_deliveries d on d.enterprise_id=e.enterprise_id and d.event_id=e.id
    where e.enterprise_id=${f.eid} and e.type='construction.record.captured.v1' and e.aggregate_id=${String(captured.recordId)}
      and d.consumer_key=${delegationConsumer}`));
  assert.equal(event?.status, 'pending');
  await closePostgresPool();
  const child = await runChild(process.execPath, ['--import','tsx','--input-type=module','--eval',
    'const m=await import("./src/lib/native-workflow/live/delegation-worker.ts"); const db=await import("./src/lib/postgresql.ts"); try { console.log(JSON.stringify(await (m.runNativeDelegationTick ?? m.default.runNativeDelegationTick)())); } finally { await (db.closePostgresPool ?? db.default.closePostgresPool)(); }'],
    { windowsHide: true, timeout: 35000 });
  assert.ok(JSON.parse(child.stdout.trim()).enterprises.some((e: Row) => e.enterpriseId === f.eid && Number(e.applied) >= 2));
  assert.equal((await task(f, 'progress')).evidence?.recordId, captured.recordId);
  assert.equal((await task(f, 'progress', another)).evidence?.recordId, captured.recordId);
  assert.equal((await task(g, 'progress')).evidence, undefined);
  const readLinks = (eid: string) => withTenantTransaction(eid, tx => rows(tx, sql`select delegation_id,task_changes from app.native_workflow_delegation_events
    where enterprise_id=${f.eid} and event_id=${String(event!.id)} order by delegation_id`));
  assert.equal((await readLinks(f.eid)).length, 2);
  assert.equal((await readLinks(g.eid)).length, 0);
  assert.equal((await tick()).enterprises.find(e => e.enterpriseId === f.eid)?.applied, 0);
  assert.equal((await readLinks(f.eid)).length, 2);
  await setDrawing(f, '有效点位图，书房需现场核对。');
  await tick();
  const noticeId = (await task(f, 'outlet')).staffNoticeId;
  assert.ok(noticeId);
  assert.equal((await task(f, 'outlet', another)).staffNoticeId, noticeId);
  for (const staff of [f.designer, f.manager, f.worker]) {
    assert.equal(((await staff.read(f.pid)).items as { response?: Row }[]).filter(item => String(item.response?.text).includes('请核对书房插座')).length, 1);
  }
});

liveTest('existing authorized facts and drawings avoid asking for information already available', async () => {
  const partial = await fixture('仅问缺项');
  await saveAnswer(partial, '书房的书桌靠窗。', { room: '书房', field: 'desk', value: '靠窗', quote: '书房的书桌靠窗' });
  await start(partial);
  await tick();
  assert.deepEqual((await task(partial, 'outlet')).wait?.requested, ['插座主要供哪些设备使用']);
  assert.equal((await messages(partial)).filter(m => /为了继续核对/.test(m.text)).length, 1);

  const withPlan = await fixture('已有图纸');
  const drawing = await setDrawing(withPlan, '书房插座已标在窗边点位图上。');
  await start(withPlan); await tick();
  const work = await task(withPlan, 'outlet');
  assert.equal(work.basis?.drawingGrantId, drawing);
  assert.equal(work.next, 'review_design');
  assert.ok(!(await messages(withPlan)).some(m => /为了继续核对/.test(m.text)));
});

liveTest('scoped capture follows actual task processing and failure without treating another room as failed', async () => {
  const f = await fixture('整理失败');
  await start(f); await tick();
  const original = await siteUpload(f);
  const report = await f.worker.send(f.pid, { text: '主卧底盒已经装好，我拍了一张现场照片。', mediaIds: [original],
    capture: { kind: 'free' } }, randomUUID());
  await tick();
  assert.equal((await task(f, 'progress')).next, 'organize_report');
  assert.equal((await current(f)).state, 'processing');
  const lease = await claimJob();
  assert.equal(lease?.runId, report.runId);
  await failRun(lease!, 'site_organization_failed', true);
  await tick();
  const progress = await task(f, 'progress');
  assert.equal(progress.next, 'retry_report');
  assert.deepEqual(progress.evidence?.photoIds, [original]);
  assert.equal((await current(f)).state, 'blocked');
  assert.equal((await task(f, 'outlet')).next, 'ask_owner');
});

liveTest('pause and cancel fence new events, and resume reads live records without replaying paused events', async () => {
  const f = await fixture('暂停取消');
  await start(f);
  await tick();
  await ownerSend(f, '暂停这次水电跟进。');
  const paused = await quick(f, '主卧', '主卧水电穿线已完成。');
  await tick();
  assert.equal((await current(f)).state, 'paused');
  assert.equal((await task(f, 'progress')).evidence, undefined);
  const whilePaused = await quick(f, '主卧', '主卧复测时补充了施工照片。', [await siteUpload(f)]);
  await ownerSend(f, '继续水电跟进。');
  await tick();
  assert.equal((await task(f, 'progress')).evidence?.recordId, whilePaused.recordId);
  assert.notEqual(paused.recordId, whilePaused.recordId);
  await ownerSend(f, '取消水电跟进。');
  const cancelled = await current(f);
  await quick(f, '主卧', '主卧水电新增记录。');
  await ownerSend(f, '继续水电跟进。');
  await tick();
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(await current(f), cancelled);
});

liveTest('revoked project access hides derived receipts and requires explicit resume after restoration', async () => {
  const f = await fixture('撤权恢复');
  await start(f); await tick();
  const setAccess = async (customerAccess: boolean) => {
    const project = (await f.management.execute('detail', { projectId: f.pid })).project as Row;
    await f.management.execute('update', { projectId: f.pid, expectedVersion: Number(project.version),
      name: project.name, status: 'active', customerAccess }, randomUUID());
  };
  await setAccess(false); await tick();
  assert.equal((await current(f)).state, 'blocked');
  assert.equal((await readRow(f)).next_action, 'resume_authorization');
  assert.ok(!(await messages(f)).some(m => m.available && m.text.includes('已开始持续跟进')));
  await setAccess(true); await tick();
  assert.equal((await current(f)).state, 'blocked');
  await ownerSend(f, '继续水电跟进'); await tick();
  assert.equal((await task(f, 'outlet')).next, 'ask_owner');
});

liveTest('timeout preserves a wait and sends one actual in-app reminder only with owner consent', async () => {
  const allow = await fixture('授权提醒'), deny = await fixture('无授权提醒');
  await start(allow, true); await start(deny);
  await tick();
  const deadlines = await Promise.all([task(allow, 'outlet'), task(deny, 'outlet')]);
  const due = new Date(Math.max(...deadlines.map(item => Date.parse(item.wait!.deadlineAt))) + 2000);
  // A repeat suite can share the isolated database with earlier synthetic
  // cases. Drain all due batches before counting this exact reminder.
  for (let batch = 0; batch < 30; batch++) {
    const result = await tick(due);
    if (result.enterprises.every(e => e.delivered === 0 && e.retried === 0)) break;
  }
  await tick(due);
  const reminders = async (f: Fixture) => (await messages(f)).filter(m => m.text.startsWith('提醒一下'));
  assert.equal((await reminders(allow)).length, 1);
  assert.equal((await reminders(deny)).length, 0);
  assert.equal((await current(allow)).state, 'waiting');
  assert.ok((await task(deny, 'outlet')).wait?.timedOutAt);
  assert.ok((await task(allow, 'outlet')).wait?.timedOutAt);
});

liveTest('a drawing revision, scoped demand correction and a dated schedule invalidate only matching execution bases', async () => {
  const f = await fixture('依据变化');
  await start(f); await tick();
  await ownerSend(f, '共享书房需求：书桌靠窗，主要用电脑和台灯。');
  await tick();
  const progress = await task(f, 'progress');
  const { issueId, planId } = await reviewSetup(f, true);
  await tick();
  await approve(f, planId); await tick();
  const old = await task(f, 'outlet');
  assert.equal(old.plan?.status, 'approved');
  const newDrawing = await setDrawing(f, '书房点位图第二版，标注已改。');
  await tick();
  const changed = await task(f, 'outlet');
  assert.equal(changed.next, 'recheck_source');
  assert.equal(changed.basis?.drawingGrantId, newDrawing);
  assert.equal(changed.plan, undefined);
  assert.deepEqual(await task(f, 'progress'), progress);
  assert.equal(await withTenantTransaction(f.eid, tx => readPlan(tx, f.eid, planId)), null);
  const delegationId = (await current(f)).id;
  const trace = await withTenantTransaction(f.eid, tx => rows(tx, sql`select l.task_changes from app.native_workflow_delegation_events l
    join app.domain_event_outbox e on e.enterprise_id=l.enterprise_id and e.id=l.event_id
    where l.enterprise_id=${f.eid} and l.delegation_id=${delegationId} and e.id=${newDrawing}`));
  assert.ok(JSON.stringify(trace).includes(planId));
  assert.ok(JSON.stringify(trace).includes(String(old.basis?.drawingGrantId)));

  await saveAnswer(f, '更正一下，书房的书桌位置改为靠内墙。', { room: '书房', field: 'desk', value: '靠内墙', quote: '书房的书桌位置改为靠内墙' });
  await tick();
  assert.equal((await task(f, 'outlet')).next, 'share_need');
  assert.deepEqual(await task(f, 'progress'), progress);
  await ownerSend(f, '共享书房需求：书桌改为靠内墙，主要用电脑和台灯。');
  await siteSay(f, f.designer, '重新核对事项' + issueId + '：已收到更新的书房资料。');
  await siteSay(f, f.designer, '核对事项' + issueId + '图纸' + newDrawing);
  await siteSay(f, f.designer, '回复事项' + issueId + '：复核新资料，拟调整点位。');
  const nextPlan = await siteSay(f, f.designer, `发布方案事项${issueId}\n标题：书房插座修订\n差异：沿内墙书桌调整\n费用变化：0元\n工期变化：0天`, [await siteUpload(f, f.designer)]);
  const nextPlanId = String(nextPlan.planId);
  await tick(); await approve(f, nextPlanId); await tick();
  const scheduled = await task(f, 'outlet');
  assert.equal(scheduled.next, 'perform_work');
  await withTenantTransaction(f.eid, tx => tx.execute(sql`insert into app.construction_plans(enterprise_id,project_id,room_id,title,starts_at,ends_at,status)
    values(${f.eid},${f.pid},${f.room.书房},'合成时间调整',now(),now()+interval '2 days','confirmed')`));
  await tick();
  assert.equal((await task(f, 'outlet')).next, 'recheck_source');
  assert.notEqual((await task(f, 'outlet')).basis?.scheduleVersion, scheduled.basis?.scheduleVersion);
  assert.equal((await withTenantTransaction(f.eid, tx => readPlan(tx, f.eid, nextPlanId)))?.status, 'approved');
  assert.deepEqual(await task(f, 'progress'), progress);
});

liveTest('a real PostgreSQL delivery failure rolls back changes and resumes once with a durable retry receipt', async () => {
  const f = await fixture('重试');
  await start(f); await tick();
  const d = await current(f);
  const photo = await siteUpload(f);
  const captured = await quick(f, '主卧', '主卧穿线已完成。', [photo]);
  const captureEvent = await withTenantTransaction(f.eid, tx => one(tx, sql`select id::text from app.domain_event_outbox
    where enterprise_id=${f.eid} and type='construction.record.captured.v1' and aggregate_id=${String(captured.recordId)}`));
  const receipt = () => withTenantTransaction(f.eid, tx => one(tx, sql`select status,attempts,last_error from app.domain_event_deliveries
    where enterprise_id=${f.eid} and event_id=${String(captureEvent!.id)} and consumer_key=${delegationConsumer}`));
  await ownerPool.query(`create function app.b58_test_retry() returns trigger language plpgsql as $$
    begin if new.id='${d.id}' then raise exception 'B5.8 synthetic delivery fault' using errcode='40001'; end if; return new; end $$`);
  try {
    await ownerPool.query('create trigger b58_test_retry before update on app.native_workflow_delegations for each row execute function app.b58_test_retry()');
    assert.equal((await tick()).enterprises.find(e => e.enterpriseId === f.eid)?.retried, 1);
    assert.deepEqual(await receipt(), { status: 'retry_wait', attempts: 1, last_error: '40001' });
    assert.deepEqual(await current(f), d);
  } finally {
    await ownerPool.query('drop trigger if exists b58_test_retry on app.native_workflow_delegations');
    await ownerPool.query('drop function app.b58_test_retry()');
  }
  await tick(new Date(Date.now() + 5000));
  assert.deepEqual(await receipt(), { status: 'delivered', attempts: 2, last_error: null });
  assert.equal((await task(f, 'progress')).evidence?.recordId, captured.recordId);
  assert.equal((await withTenantTransaction(f.eid, tx => rows(tx, sql`select event_id from app.native_workflow_delegation_events
    where enterprise_id=${f.eid} and delegation_id=${d.id} and event_id=${String(captureEvent!.id)}`))).length, 1);
  assert.equal((await withTenantTransaction(f.eid, tx => rows(tx, sql`select id from app.domain_event_outbox
    where enterprise_id=${f.eid} and type=${delegationNotice} and aggregate_id like ${d.id + ':progress:%'}`))).length, 0);
});

test('two fixed natural owner replies resume the real configured-model continuation', { skip: !live || !configuredModel, timeout: 150000 }, async () => {
  const answers = ['书桌靠窗，主要使用电脑和台灯。', '书房书桌靠内墙，主要用显示器和台灯。'];
  const observations = [];
  for (const answer of answers) {
    const f = await fixture('实模补充');
    await start(f); await tick();
    const sent = await ownerSend(f, answer);
    const lease = await claimJob();
    assert.equal(lease?.runId, sent.runId);
    await processAssistantRun(lease!);
    await tick();
    const run = await withTenantTransaction(f.eid, tx => one(tx, sql`select r.status,r.error_code,m.content from app.assistant_runs r
      left join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
      where r.enterprise_id=${f.eid} and r.id=${String(sent.runId)}`));
    const attempts = await withTenantTransaction(f.eid, tx => rows(tx, sql`select a.id::text,a.status,a.provider_key,a.remote_model,a.accepted,a.error_code,u.input_tokens,u.output_tokens
      from app.ai_provider_attempts a left join app.assistant_usage_records u
        on u.enterprise_id=a.enterprise_id and u.provider_attempt_id=a.id and u.category='tokens'
      where a.enterprise_id=${f.eid} and a.assistant_run_id=${String(sent.runId)} order by a.id`));
    const outlet = await task(f, 'outlet');
    const replyMessageId = outlet.basis?.replyMessageId;
    let afterShare: string | undefined;
    if (outlet.next === 'share_need' && replyMessageId === sent.messageId) {
      await ownerSend(f, '共享书房需求：' + answer);
      await tick();
      afterShare = (await task(f, 'outlet')).next;
    }
    const observation = { answer, projectId: f.pid, conversationId: f.cid, runId: sent.runId, run, attempts, next: outlet.next,
      factIds: outlet.basis?.factIds, replyMessageId, sourceMessageId: sent.messageId, afterShare };
    console.log('B5.8 configured reply', JSON.stringify(observation));
    observations.push(observation);
  }
  for (const observation of observations) {
    assert.ok(observation.attempts.length, 'configured provider must have an actual attempt');
    assert.equal(observation.run?.status, 'succeeded');
    assert.equal(observation.next, 'share_need');
    assert.ok(observation.factIds?.length);
    assert.equal(observation.replyMessageId, observation.sourceMessageId);
    assert.equal(observation.afterShare, 'review_design');
  }
});
