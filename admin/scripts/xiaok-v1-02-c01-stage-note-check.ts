/** Real C01 services; labelled development fixtures, no model dispatch. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { type ActorContext } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { ConstructionService } from '@/lib/construction/service';
import { FollowupService } from '@/lib/construction/followup-service';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/v1-02-c01-stage-note/service-01-before');
const nativeScript = process.argv.find(a => a.startsWith('--native-script='))?.slice(16);
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Preserve every original run');
fs.mkdirSync(output, { recursive: true });
const files = execFileSync('rg', ['--files', 'admin/src/lib/assistant', 'admin/src/lib/construction', 'admin/src/db', 'admin/drizzle', 'miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
files.push('admin/scripts/xiaok-v1-02-c01-stage-note-check.ts', 'admin/scripts/assistant-acceptance-safety.mjs', 'admin/.env.local', 'admin/package.json', 'admin/package-lock.json', 'admin/tsconfig.json', 'tmp/xiaok-vector/connection.private.json');
if (nativeScript) files.push(path.resolve(nativeScript), 'admin/scripts/wechatide-native-client.ts', 'tmp/v1-02-human-takeover/host-passive.ps1', 'tmp/wechat-devtools-version-test/window.ps1', 'tmp/v1-02-conversation-list-visual/inspect-window.ps1', 'D:/微信开发工具/微信web开发者工具/resources/app.asar', 'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe');
const bind = () => Object.fromEntries(files.sort().map(f => [f.replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
const before = bind(), report: Row = { startedAt: new Date().toISOString(), scope: 'C01 note-only stage notice/follow-up, original consumer and private destination isolation', checks: [], modelCalls: 0, embeddingCalls: 0, ingestionCalls: 0 };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const owner = new ConstructionService({ enterpriseId: eid, adminId: '5410' });
let release: (() => Promise<void>) | undefined, account: Row | undefined, settings: Row | undefined, actor: ActorContext, chat: ConversationService;
let pid = '', leadId = '', cid = '', bid = '', privateCid = '', uid = '';
let originalEventId = '', otherConversationId = '';
let originalMessageIds: string[] = [];
const conversations: string[] = [];
const progress = async (stageKey: string, note: string, sendReminder = false) => {
  const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('progress', { projectId: pid, expectedVersion: p.version, stageKey, note, sendReminder }, randomUUID());
};
const state = async (status: string, customerAccess: boolean) => {
  const p = (await owner.execute('detail', { projectId: pid })).project as Row;
  return owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status, customerAccess }, randomUUID());
};
const event = () => read(tx => one(tx, sql`select e.id,e.aggregate_version,e.payload,p.progress_revision from app.domain_event_outbox e
  join app.construction_projects p on p.enterprise_id=e.enterprise_id and p.id::text=e.aggregate_id
  where e.enterprise_id=${eid} and e.type='construction.stage.updated.v1' and e.aggregate_id=${pid} order by e.aggregate_version desc limit 1`));
const notices = (destination: string) => read(tx => rows(tx, sql`select m.id,m.purpose,m.source_event_id,e.payload from app.assistant_messages m
  join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
  where m.enterprise_id=${eid} and m.conversation_id=${destination} and m.purpose in ('construction.stage','construction.followup') order by m.seq`));
const accounting = () => withPlatformTransaction(async tx => ({
  provider: await one(tx, sql`select coalesce(max(id),0)::text id from app.ai_provider_attempts`),
  knowledge: await one(tx, sql`select coalesce(max(id),0)::text id from app.assistant_knowledge_attempts`),
  unknown: await one(tx, sql`select status,input_tokens from app.assistant_knowledge_attempts where id=3753`),
  reservations: await one(tx, sql`select count(*)::int n,sum(reserved_tokens)::text tokens from app.assistant_quota_reservations where enterprise_id=${eid} and status='reconciling'`),
  policy: await one(tx, sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
  published: await rows(tx, sql`select id,status,published_version_id from app.assistant_knowledge_documents where enterprise_id=${eid} and id in (404,405) order by id`),
}));
async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).stack }); throw e; }
  finally { save(); console.log(name + ': ' + ((report.checks as Row[]).at(-1)!.passed ? 'PASS' : 'FAIL')); }
}
async function main() {
  release = await lockAssistantAcceptance(JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL, { waitForLock: true });
  assert.equal((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)))!.n, 0);
  const accountingBefore = await accounting(); report.accountingBefore = accountingBefore; assert.equal(accountingBefore.policy!.enabled, false);
  await step('labelled own-home fixture and waiting consultation, report policy remains disabled', async () => {
    await withPlatformTransaction(async tx => {
      account = await one(tx, sql`select id,username,status from app.admin_users where id=5410`);
      assert.match(String(account!.username), /^synthetic-v1-02-/); assert.equal(account!.status, 'disabled');
      await tx.execute(sql`update app.admin_users set status='active' where id=5410`);
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values('合成测试C01·备注提醒',1) returning id,context_version`))!;
      uid = String(user.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${'synthetic-c01-note-' + randomUUID()})`);
      actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: Number(user.context_version), capabilities: ['assistant.chat.self'] };
    });
    leadId = await read(async tx => String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${eid},${uid},'合成测试C01·备注提醒','13800000000','natural') returning id`))!.id));
    actor.entry = { kind: 'lead', id: leadId };
    chat = new ConversationService(actor); cid = String((await chat.create(randomUUID())).id); conversations.push(cid);
    settings = await owner.execute('stages');
    const room = '合成厨房' + cid;
    await owner.execute('saveStages', { expectedVersion: settings.version, stages: (settings.stages as Row[]).map(s => s.key === 'utilities'
      ? { ...s, visitReminder: true, visitReason: '合成测试：核对厨房点位', watchPoints: '合成测试：核对插座位置', followUps: [{ field: 'devices', room, question: room + '要预留哪些设备插座？' }] } : s) }, randomUUID());
    pid = String((await owner.execute('create', { leadId, name: '合成测试C01·备注提醒', managerId: '5410', rooms: [room] }, randomUUID())).id);
    await state('active', true);
    const followup = await new FollowupService({ ...actor, capabilities: ['assistant.followup.self'] }).open(randomUUID(), pid);
    bid = String(followup.bindingId); privateCid = String(followup.conversationId);
    await new HandoffService(actor).customerWrite(cid, randomUUID(), { action: 'request' });
    Object.assign(report, { projectId: pid, leadId, userId: uid, conversationId: cid, bindingId: bid, privateConversationId: privateCid }); save();
    return { projectId: pid, leadId, conversationId: cid, privateConversationId: privateCid };
  });
  await step('note before first delivery preserves the original stage event and one visible reminder/question', async () => {
    await progress('utilities', '合成测试：已进入水电'); const source = (await event())!;
    await progress('utilities', '合成测试：只补充备注'); const current = (await event())!;
    assert.equal(String(current.id), String(source.id)); assert.deepEqual(current.payload, source.payload);
    assert.ok(Number(current.progress_revision) > Number(current.aggregate_version));
    assert.equal((await notices(cid)).length, 0);
    await new ConversationService({ ...actor, capabilities: ['assistant.followup.self'] }).messages(privateCid);
    assert.equal((await notices(privateCid)).length, 0, 'Private reports must not consume ordinary C01 notices');
    await new HandoffService(actor).customerWrite(cid, randomUUID(), { action: 'cancel' });
    const messages = (await chat.messages(cid)).items as Row[], delivered = await notices(cid);
    const original = { eventId: String(source.id), eventRevision: Number(source.aggregate_version), projectRevision: Number(current.progress_revision), raw: delivered.length,
      visibleReminders: messages.filter(m => m.constructionReminder && m.available).length, visibleQuestions: messages.filter(m => m.constructionFollowUp && m.available).length };
    report.original = original; originalEventId = original.eventId;
    save(); assert.equal(original.visibleReminders, 1); assert.equal(original.visibleQuestions, 1); assert.equal(delivered.length, 2);
    originalMessageIds = delivered.map(m => String(m.id)); report.originalMessageIds = originalMessageIds;
    return original;
  });
  await step('delivered originals survive later note edits and concurrent reentry without duplicate consumption', async () => {
    const source = (await event())!; await progress('utilities', '合成测试：再补备注'); await progress('utilities', '合成测试：再补备注');
    const results = await Promise.all([chat.messages(cid), new ConversationService(actor).messages(cid)]);
    for (const result of results) for (const id of originalMessageIds) assert.equal((result.items as Row[]).find(m => m.id === id)?.available, true);
    assert.deepEqual((await notices(cid)).map(m => String(m.id)), originalMessageIds); assert.deepEqual((await event())!.payload, source.payload);
    return { sameMessageIds: originalMessageIds, immutableEvent: true, concurrentReads: 2 };
  });
  await step('another consultation and private follow-up do not duplicate the original consumer', async () => {
    const other = String((await chat.create(randomUUID())).id); conversations.push(other); otherConversationId = other; report.otherConversationId = other;
    await chat.messages(other); await new ConversationService({ ...actor, capabilities: ['assistant.followup.self'] }).messages(privateCid);
    assert.equal((await notices(other)).length, 0); assert.equal((await notices(privateCid)).length, 0);
    const deliveries = await read(tx => rows(tx, sql`select consumer_key,status from app.domain_event_deliveries where enterprise_id=${eid} and event_id=${originalEventId} order by consumer_key`));
    assert.deepEqual(deliveries.map(d => d.consumer_key).sort(), ['construction:need:user:' + uid, 'construction:user:' + uid]);
    assert.ok(deliveries.every(d => d.status === 'delivered')); return { deliveries, privateConversationId: privateCid };
  });
  if (nativeScript) {
    const native = (await import(pathToFileURL(path.resolve(nativeScript)).href)).default;
    const token = await new SignJWT({ sub: uid, id: uid, mode: 'customer', role: 'user', enterpriseId: eid, contextVersion: actor.contextVersion, source: 'password' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    report.native = await native({ root, output, actor: { uid, role: 'user', token, cid, bid }, pid, leadId, cid, bid, privateCid, originalMessageIds, progress, read }); save();
  }
  await step('a real stage change away and back revokes old originals without asking the stable need twice', async () => {
    const other = (settings!.stages as Row[]).find(s => s.key !== 'utilities')!;
    await progress(String(other.key), '合成测试：实际离开水电'); await progress('utilities', '合成测试：新水电阶段事件');
    const old = (await chat.messages(cid)).items as Row[];
    for (const id of originalMessageIds) assert.equal(old.find(m => m.id === id)?.available, false);
    const current = (await chat.messages(otherConversationId)).items as Row[];
    assert.equal(current.filter(m => m.constructionReminder && m.available).length, 1);
    assert.equal(current.filter(m => m.constructionFollowUp).length, 0);
    return { originalUnavailable: true, newEventId: String((await event())!.id), stableNeedNotRepeated: true };
  });
  await step('customer-access revocation and regrant do not revive an old stage notice', async () => {
    await state('active', false); await state('active', true); await progress('utilities', '合成测试：撤权后补备注');
    const current = (await chat.messages(otherConversationId)).items as Row[];
    assert.ok(current.filter(m => m.constructionReminder).every(m => m.available === false));
    await progress('utilities', '合成测试：明确重发当前节点', true);
    assert.equal(((await chat.messages(otherConversationId)).items as Row[]).filter(m => m.constructionReminder && m.available).length, 1);
    return { regrantDidNotResurrect: true, explicitNewNotice: true };
  });
  await step('configuration revision and foreign customer/tenant cannot reveal the saved originals', async () => {
    const s = await owner.execute('stages'); await owner.execute('saveStages', { expectedVersion: s.version, stages: s.stages }, randomUUID());
    assert.ok(((await chat.messages(otherConversationId)).items as Row[]).filter(m => m.constructionReminder).every(m => m.available === false));
    const foreign = { ...actor, principal: { kind: 'user' as const, userId: '3915' } };
    await assert.rejects(new ConversationService(foreign).messages(cid));
    await assert.rejects(new ConversationService({ ...actor, enterpriseId: '1455' }).messages(cid));
    return { settingsInvalidated: true, foreignCustomerDenied: true, foreignTenantDenied: true };
  });
  report.passed = true;
}
async function execute() {
  try { await main(); } catch (e) { report.passed = false; report.error = (e as Error).stack; process.exitCode = 1; }
  finally {
    try {
      if (bid && actor!) { const service = new FollowupService({ ...actor, capabilities: ['assistant.followup.self'] }), b = await service.context(bid);
        if (b.status === 'enabled') await service.change(bid, 'stop', Number(b.version), randomUUID()); }
      for (const id of conversations) { const c = await chat.detail(id);
        if (c.mode === 'handoff_requested') await new HandoffService(actor).customerWrite(id, randomUUID(), { action: 'cancel' });
        const current = await chat.detail(id); if (current.status === 'open') await chat.archive(id, Number(current.version), randomUUID()); }
      if (pid && account) await state('archived', false);
      if (leadId) await read(tx => tx.execute(sql`update app.leads set archived_at=now() where enterprise_id=${eid} and id=${leadId} and name='合成测试C01·备注提醒'`));
      if (settings) { const s = await owner.execute('stages'); await owner.execute('saveStages', { expectedVersion: s.version, stages: settings.stages }, randomUUID()); }
      if (account) await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status=${String(account!.status)} where id=5410 and username=${String(account!.username)}`));
      if (uid) await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid} and nickname='合成测试C01·备注提醒'`));
      report.accountingAfter = await accounting(); if (report.accountingBefore) assert.deepEqual(report.accountingAfter, report.accountingBefore);
      const queue = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`));
      report.queue = queue; assert.equal(queue!.n, 0); report.cleanup = true;
    } catch (e) { report.cleanup = false; report.cleanupError = (e as Error).stack; process.exitCode = 1; }
    const after = bind(), drift = Object.keys(before).filter(f => before[f] !== after[f]); report.drift = drift;
    if (drift.length) { report.passed = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after }, null, 2));
    report.finishedAt = new Date().toISOString(); save();
    try { if (release) await release(); } finally { await closePostgresPool(); }
    console.log(JSON.stringify({ passed: report.passed, cleanup: report.cleanup, checks: (report.checks as Row[]).length, drift }));
  }
}
void execute().catch(e => { console.error(e); process.exitCode = 1; });
