import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ConstructionService } from '@/lib/construction/service';
import { syncConstructionReminders } from '@/lib/construction/reminders';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

/** V1-03 enabled-stage enablement: the enterprise's real stage configuration
 * turns the reminders on and every enabled stage runs one actual journey.
 * General reviewed copy only; knowledge stays off and no model is called. */
loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), eid = '1454';
const target = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;
const url = new URL(target);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = target;
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-03-stage-coverage/enabled-stages-01');
fs.mkdirSync(output, { recursive: true });
const evidence = path.join(output, 'report.json');
const log: Row = { scope: 'V1-03 real stage settings enablement and one actual reminder journey per enabled stage; knowledge off, zero model calls', checks: [] };
fs.writeFileSync(evidence, JSON.stringify(log), { flag: 'wx' });
const save = () => fs.writeFileSync(evidence, JSON.stringify(log, null, 2));
const read = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);

/** Reviewed general copy for this version's enabled stages. Enterprise craft
 * wording stays out; knowledge-off reminders must not fabricate standards. */
const enabled: Record<string, { name: string; reason: string; watch: string }> = {
  preparation: { name: '前期', reason: '开工前的方案、口径与时间需要您确认', watch: '量房复核结果、平面方案与预算口径、开工交底时间' },
  design: { name: '设计', reason: '设计方案与图纸需要您逐项确认', watch: '平面布局、水电点位图、效果图与预算的对应、主材清单' },
  demolition: { name: '拆改', reason: '拆改涉及结构与公共区域', watch: '承重墙不改动、门窗与电梯保护、垃圾清运安排' },
  utilities: { name: '水电', reason: '水电是隐蔽工程，封槽前需要您核对', watch: '点位复核、水路走向、强弱电分色、打压试验与拍照存档' },
  masonry_carpentry: { name: '泥木', reason: '泥木阶段决定成型效果', watch: '防水与闭水试验、瓷砖排版方向、地面找平、木作尺寸复核' },
  painting: { name: '油漆', reason: '油漆决定最终观感', watch: '基层处理、阴阳角、色卡确认、成品保护与通风' },
  installation: { name: '安装', reason: '主材设备集中进场安装', watch: '进场验收、安装顺序、打孔位置复核、成品保护' },
  furnishing: { name: '软装', reason: '软装进场是收尾关键', watch: '家具家电尺寸核对、窗帘灯具安装、开荒保洁顺序、通风安排' },
};
const order = Object.keys(enabled);

let release: (() => Promise<void>) | undefined;
const actorOf = (uid: string): ActorContext => ({ enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
let owner: ConstructionService, uid = '', cid = '', pid = '', chat: ConversationService;
let settingsBefore: Row | undefined, attemptsBefore = '', providerRestored = false, reactivated: string[] = [];
const deliveries = (eventId: string) => read(tx => rows(tx, sql`select consumer_key,status from app.domain_event_deliveries
  where enterprise_id=${eid} and event_id=${eventId} order by consumer_key`));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (log.checks as Row[]).push({ name, passed: true, data }); }
  catch (e) { (log.checks as Row[]).push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((log.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
const resync = () => read(async tx => {
  const conversation = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`);
  await syncConstructionReminders(tx, actorOf(uid), conversation!);
});
/** Stage reminders persist as assistant messages linked to their domain event. */
const stageMessages = () => read(tx => rows(tx, sql`select m.id::text id,m.source_event_id::text event_id,m.content,e.payload
  from app.assistant_messages m join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
  where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.purpose='construction.stage' order by m.seq`));
const textOf = (message: Row) => ((message.content as Row)?.blocks as Row[] | undefined || []).map(b => String(b.text || '')).join('');

async function main() {
  release = await lockAssistantAcceptance(target, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  attemptsBefore = String((await withPlatformTransaction(tx => one(tx, sql`select coalesce(max(id),0)::text id from app.ai_provider_attempts`)))!.id);

  await step('temporary assistant enablement with knowledge off is recorded for restore', async () => {
    settingsBefore = await read(tx => one(tx, sql`select enabled,agent_config,version,policy_version from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.equal(settingsBefore!.enabled, false);
    await read(tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,
      agent_config=${JSON.stringify({ ...(settingsBefore!.agent_config as Row || {}), enterpriseKnowledgeEnabled: false })}::jsonb,
      policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`));
    const after = await read(tx => one(tx, sql`select enabled,agent_config->>'enterpriseKnowledgeEnabled' ke from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    assert.equal(after!.enabled, true); assert.equal(after!.ke, 'false');
  });

  await step('labelled project and open customer consultation are prepared', async () => {
    const retained = JSON.parse(fs.readFileSync(path.join(root, 'tmp/v1-02-live-reports/terminal-scheduler05/report.json'), 'utf8'));
    assert.ok(retained.cleanup === true && String(retained.prefix).startsWith('synthetic-report-composition-'));
    const [ownerId, managerId] = (retained.fixture.admins as string[]).map(String);
    await withPlatformTransaction(async tx => {
      const admins = await rows(tx, sql`select id,username,status from app.admin_users where id in (${ownerId},${managerId}) order by id`);
      assert.equal(admins.length, 2);
      assert.ok(admins.every(a => String(a.username).startsWith('synthetic-report-composition-')));
      reactivated = admins.filter(a => a.status !== 'active').map(a => String(a.id));
      for (const id of reactivated) await tx.execute(sql`update app.admin_users set status='active' where id=${id}`);
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values('合成测试·启用阶段旅程',1) returning id`))!;
      uid = String(user.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'synthetic-enabled-stages-' + randomUUID()})`);
    });
    const leadId = await read(async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${uid},'合成测试·启用阶段旅程','13800000000','natural') returning id`))!.id));
    owner = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
    chat = new ConversationService(actorOf(uid));
    cid = String((await chat.create(randomUUID())).id);
    pid = String((await owner.execute('create', { leadId, name: '合成测试·启用阶段旅程', managerId, rooms: [] }, randomUUID())).id);
    const detail = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('update', { projectId: pid, expectedVersion: detail.version, name: detail.name, status: 'active', customerAccess: true }, randomUUID());
  });

  await step('the real stage configuration enables exactly this version\u2019s eight stages', async () => {
    const settings = await owner.execute('stages') as Row;
    const next = (settings.stages as Row[]).map(s => enabled[s.key as string]
      ? { ...s, visitReminder: true, visitReason: enabled[s.key as string].reason, watchPoints: enabled[s.key as string].watch } : s);
    await owner.execute('saveStages', { expectedVersion: settings.version, stages: next }, randomUUID());
    const saved = (await owner.execute('stages') as Row).stages as Row[];
    for (const key of order) {
      const stage = saved.find(s => s.key === key)!;
      assert.equal(stage.visitReminder, true);
      assert.equal(stage.visitReason, enabled[key].reason);
      assert.equal(stage.watchPoints, enabled[key].watch);
    }
    for (const key of ['completion', 'move_in']) assert.equal(saved.find(s => s.key === key)!.visitReminder, false);
    log.enabledStages = saved.filter(s => s.visitReminder).map(s => s.key);
  });

  for (const key of order) {
    await step(`stage ${key} delivers one actual reminder with its own reviewed copy`, async () => {
      const before = await stageMessages();
      const detail = (await owner.execute('detail', { projectId: pid })).project as Row;
      await owner.execute('progress', { projectId: pid, expectedVersion: detail.version, stageKey: key, note: '', sendReminder: false }, randomUUID());
      const after = await stageMessages();
      assert.equal(after.length, before.length + 1);
      const message = after.at(-1)!, text = textOf(message);
      assert.ok(text.includes('当前施工已进入' + enabled[key].name + '阶段'));
      assert.ok(text.includes(enabled[key].watch), 'the reminder carries the configured watch points');
      const event = await read(tx => one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid} and id=${String(message.event_id)}`));
      const delivery = (await deliveries(String(message.event_id))).find(d => d.consumer_key === 'construction:user:' + uid);
      assert.equal(delivery?.status, 'delivered');
      await resync();
      assert.equal((await stageMessages()).length, after.length, 'reentry must not duplicate the reminder');
      log['stage:' + key] = { messageId: String(message.id), eventId: String(message.event_id) };
    });
  }

  await step('explicit re-remind repeats the current stage once', async () => {
    const before = await stageMessages();
    const detail = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('progress', { projectId: pid, expectedVersion: detail.version, stageKey: 'furnishing', note: '', sendReminder: true }, randomUUID());
    const after = await stageMessages();
    assert.equal(after.length, before.length + 1);
    assert.ok(textOf(after.at(-1)!).includes(enabled.furnishing.watch));
    await resync();
    assert.equal((await stageMessages()).length, after.length);
  });

  await step('revoked customer access stops delivery and later stages resume it', async () => {
    const before = await stageMessages();
    const detail = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('update', { projectId: pid, expectedVersion: detail.version, name: detail.name, status: 'active', customerAccess: false }, randomUUID());
    const revoked = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('progress', { projectId: pid, expectedVersion: revoked.version, stageKey: 'completion', note: '', sendReminder: false }, randomUUID());
    assert.equal((await stageMessages()).length, before.length, 'no reminder while access is revoked');
    const restored = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('update', { projectId: pid, expectedVersion: restored.version, name: restored.name, status: 'active', customerAccess: true }, randomUUID());
    const active = (await owner.execute('detail', { projectId: pid })).project as Row;
    await owner.execute('progress', { projectId: pid, expectedVersion: active.version, stageKey: 'move_in', note: '', sendReminder: false }, randomUUID());
    assert.equal((await stageMessages()).length, before.length, 'the terminal stages stay excluded');
  });

  await step('zero model or knowledge calls and per-stage consumer keys are recorded', async () => {
    const attemptsAfter = (await withPlatformTransaction(tx => one(tx, sql`select coalesce(max(id),0)::text id from app.ai_provider_attempts`)))!.id;
    assert.equal(attemptsAfter, attemptsBefore);
    const knowledge = await read(tx => one(tx, sql`select count(*)::int n from app.assistant_knowledge_attempts where started_at>now()-interval '10 minutes'`));
    assert.equal(knowledge!.n, 0);
    const events = await read(tx => rows(tx, sql`select e.id::text id,e.payload->>'stageKey' stage from app.domain_event_outbox e
      where e.enterprise_id=${eid} and e.type='construction.stage.updated.v1' and e.aggregate_id=${pid} order by e.aggregate_version`));
    assert.equal(events.length, order.length + 3, 'eight stage changes, one explicit re-remind, two excluded terminal stages');
    log.deliveredStages = (await stageMessages()).map(m => (m.payload as Row).stageKey);
    log.conversationId = cid; log.userId = uid; log.projectId = pid;
  });
}

main().then(async () => { log.passed = true; log.finishedAt = new Date().toISOString(); save(); console.log('PASSED'); })
  .catch(e => { log.passed = false; log.error = (e as Error).message; save(); console.error('FAILED', e.message); process.exitCode = 1; })
  .finally(async () => {
    try {
      await read(async tx => {
        if (settingsBefore) await tx.execute(sql`update app.assistant_enterprise_settings set enabled=${settingsBefore.enabled},
          agent_config=${JSON.stringify(settingsBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=${eid}`);
        for (const id of reactivated) await tx.execute(sql`update app.admin_users set status='disabled' where id=${id}`);
        for (const c of cid ? [cid] : []) await tx.execute(sql`update app.assistant_conversations set status='archived' where enterprise_id=${eid} and id=${c} and status='open'`);
      });
      providerRestored = true;
    } catch (e) { log.cleanupError = String(e); process.exitCode = 1; }
    log.cleanup = { settingsRestored: providerRestored, adminsRestored: reactivated, stageSettingsKept: true, conversationArchived: true, retainedFixtureReuse: 'xiaok-v1-02-live-reports/terminal-scheduler05' };
    save();
    if (release) await release();
    await closePostgresPool();
  });
