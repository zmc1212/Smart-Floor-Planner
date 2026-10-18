import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { projectSiteIssues, siteIssueCommand } from '@/lib/construction/site-issues';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { deliverSiteResults } from '@/lib/construction/site-results';
import { queryNeedIssues } from '@/lib/construction/need-issues';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { fingerprint, safeText } from '@/lib/assistant/contracts';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { sharedMaterials } from '@/lib/construction/site-materials';

const prefix = 'synthetic-issue-continuation-' + randomUUID();
const enterprises: string[] = [], admins: string[] = [], platform: string[] = [];
let uid = '', eid = '', pid = '', cid = '', roomId = '';
let owner: ConstructionService, boss: SiteChatService, worker: SiteChatService, designer: SiteChatService, chat: ConversationService;
const send = async (service: SiteChatService, text: string, key = randomUUID(), versions?: Row) => service.send(pid,
  { text, mediaIds: [], versions: versions || (await service.read(pid)).versions }, key);
const say = (text: string) => chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text }] }, siteWatchInterceptor);
const view = (iid: string) => withTenantTransaction(eid, async tx => (await projectSiteIssues(tx, eid, pid)).find(i => i.issueId === iid)!);
const followups = () => withTenantTransaction(eid, tx => queryNeedIssues(tx, chat.actor, cid));
const member = async (aid: string, active: boolean, role = 'designer') => owner.execute('member', {
  projectId: pid, expectedVersion: Number(((await owner.execute('detail', { projectId: pid })).project as Row).version),
  adminId: aid, active, role, workLabel: '',
}, randomUUID());

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) enterprises.push(String((await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${prefix+i},${prefix+i},'active') returning id`))!.id));
    eid = enterprises[0];
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${eid},true,200,12000000,1000000000,30)`);
    for (const [i, role] of ['enterprise_admin','construction_staff','designer','construction_staff'].entries()) admins.push(String((await one(tx,
      sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix+i},'unusable-test-only',${role},'active',false,${['合成负责人','合成师傅','合成设计师','合成观察员'][i]}) returning id`))!.id));
    for (const role of ['admin','super_admin']) platform.push(String((await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password)
      values(${prefix+role},'unusable-test-only',${role},'active',false) returning id`))!.id));
    uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
  });
  owner = new ConstructionService({ enterpriseId: eid, adminId: admins[0] }); boss = new SiteChatService(owner.actor);
  worker = new SiteChatService({ enterpriseId: eid, adminId: admins[1] }); designer = new SiteChatService({ enterpriseId: eid, adminId: admins[2] });
  const leadId = String((await withTenantTransaction(eid, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eid},${uid},'合成连续服务业主','13800000000','natural') returning id`)))!.id);
  pid = String((await owner.execute('create', { leadId, name: '合成连续服务工地', managerId: admins[0], rooms: ['书房'] }, randomUUID())).id);
  await member(admins[1], true, 'worker'); await member(admins[2], true); await member(admins[3], true, 'observer');
  roomId = String(((await boss.read(pid)).rooms as Row[])[0].id);
  chat = new ConversationService({ enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
  cid = String((await chat.create(randomUUID())).id);
  await say('共享书房需求：双人办公，底盒点位仍待现场核对。');
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const e of enterprises) {
      await deleteConstructionData(tx, BigInt(e)); await deleteAssistantData(tx, BigInt(e));
      await tx.execute(sql`delete from app.leads where enterprise_id=${e}`);
      await tx.execute(sql`delete from app.admin_users where enterprise_id=${e}`); await tx.execute(sql`delete from app.enterprises where id=${e}`);
    }
    await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`);
    for (const aid of platform) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  }); } finally { await closePostgresPool(); }
});
async function open() {
  const source = await send(worker, '书房底盒还没固定，等设计师核对位置。');
  const lease = await claimJob(); assert.equal(lease?.runId, source.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '合成现场记录', roomId, completed: '', pending: '底盒未固定', coordination: '等设计师核对', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 100, outputTokens: 30 } }));
  const opened = await send(worker, '跟进记录' + source.recordId + '：待核对底盒');
  const iid = String(opened.issueId); await send(boss, '转交事项' + iid + '给合成设计师');
  await send(designer, '回复事项' + iid + '：PRIVATE_INTERNAL_REPLY 须现场核对，尚无正式批准。');
  return { iid, rid: String(source.recordId) };
}
const cancel = (iid: string) => send(boss, '取消事项' + iid + '：暂缓本次核对，未安排施工。');
const resume = (iid: string, service = boss) => send(service, '恢复事项' + iid + '：继续按当前资料核对。');
const publish = (iid: string) => send(boss, '回传事项' + iid + '：本次状态以团队实际回执为准，未批准点位。');

test('explicit restore command has exact identity and reason; questions, quotations and acknowledgements cannot authorize it', () => {
  assert.deepEqual(siteIssueCommand('恢复事项123：继续核对'), { action: 'resume', target: '123', value: '继续核对' });
  for (const raw of ['恢复事项123','恢复事项123：  ','能恢复事项123吗？','如果恢复事项123：继续核对','“恢复事项123：继续核对”','好','收到']) assert.equal(siteIssueCommand(raw), null);
});
test('cancelled state returns only a manager-selected excerpt and truthful waiting state to the original consultation', async () => {
  const { iid } = await open(); await publish(iid); await deliverSiteResults();
  const old = (await followups()).data.find(x => x.issueId === iid)!; assert.equal(old.status, 'awaiting_review');
  await cancel(iid); assert.equal((await followups()).data.find(x => x.issueId === iid)!.status, 'invalidated');
  assert.equal(await deliverSiteResults(), 0, 'cancelling does not silently publish internal content');
  await assert.rejects(send(designer, '回传事项' + iid + '：不能自行对客披露'), /construction_forbidden/);
  await publish(iid); assert.equal(await deliverSiteResults(), 1); assert.equal(await deliverSiteResults(), 0);
  const current = (await followups()).data.find(x => x.issueId === iid)!;
  assert.equal(current.status, 'cancelled'); assert.equal(current.waitingFor, 'none'); assert.match(current.value, /已取消跟进/);
  assert.doesNotMatch(current.value, /PRIVATE_INTERNAL_REPLY|仍待项目团队核对/);
  const other = String((await chat.create(randomUUID())).id);
  assert.equal((await withTenantTransaction(eid, tx => queryNeedIssues(tx, chat.actor, other))).data.length, 0);
});
test('lost receipt, concurrent same-key restore and stale revisions cannot duplicate or revive old processing evidence', async () => {
  const { iid } = await open(); await cancel(iid); const versions = (await boss.read(pid)).versions as Row;
  await assert.rejects(resume(iid, designer), /construction_forbidden/);
  const raw = '恢复事项' + iid + '：丢回包仍沿原键恢复', key = randomUUID();
  const [a,b] = await Promise.all([send(boss, raw, key, versions), send(boss, raw, key, versions)]); assert.deepEqual(a,b);
  const restored = await view(iid); assert.equal(restored.issueId, iid); assert.equal(restored.revision, Number((versions.issues as Row)[iid]) + 1);
  assert.equal(restored.status, 'awaiting_owner'); assert.equal(restored.progressMessageId, null); assert.equal(restored.drawingGrantId, null);
  assert.equal(restored.ownerId, admins[2]); assert.match(restored.text, /旧回复.*不自动恢复/); assert.doesNotMatch(restored.text, /PRIVATE_INTERNAL_REPLY/);
  await assert.rejects(send(boss, raw, randomUUID(), versions), /version_conflict/);
  await assert.rejects(resume(iid), /context_changed/);
  assert.equal((await view(iid)).revision, restored.revision);
  await publish(iid); await deliverSiteResults(); const current = (await followups()).data.find(x => x.issueId === iid)!;
  assert.equal(current.status, 'awaiting_owner'); assert.equal(current.waitingFor, 'team'); assert.equal(current.ownerName, '合成设计师');
});
test('persisted reentry and a real phase change keep one issue and never create a new assignment or resurrect a cancelled one', async () => {
  const { iid, rid } = await open(); await cancel(iid); const revision = (await view(iid)).revision;
  await owner.execute('progress', { projectId: pid, expectedVersion: Number(((await owner.execute('detail', { projectId: pid })).project as Row).version),
    stageKey: 'utilities', note: '合成阶段变更，不代表完工验收', sendReminder: false }, randomUUID());
  const fresh = new SiteChatService({ enterpriseId: eid, adminId: admins[0] }); await fresh.read(pid);
  assert.equal((await view(iid)).status, 'cancelled'); assert.equal((await view(iid)).revision, revision);
  assert.equal(String((await send(fresh, '跟进记录' + rid)).issueId), iid);
  await resume(iid, fresh); assert.equal((await view(iid)).revision, revision + 1);
  const count = await withTenantTransaction(eid, tx => one(tx, sql`select count(*) n from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.site.issue.opened.v1' and aggregate_id=${rid}`)); assert.equal(Number(count!.n), 1);
});
test('replacement record requires fresh record and material snapshots before same-id recovery', async () => {
  const { iid, rid } = await open(); await cancel(iid); const stale = (await boss.read(pid)).versions as Row;
  const record = ((await boss.read(pid)).items as Row[]).find(i => String((i.record as Row | null)?.id) === rid)!.record as Row;
  await boss.mutate(pid, rid, 'edit', { expectedVersion: Number(record.version), data: { ...(record.data as Row), pending: '本版底盒仍需实测', note: '合成新版本' } }, randomUUID());
  await assert.rejects(send(boss, '恢复事项' + iid + '：旧记录不能恢复', randomUUID(), stale), /version_conflict/);
  const missing = (await boss.read(pid)).versions as Row; await assert.rejects(send(boss, '恢复事项' + iid + '：缺资料快照', randomUUID(), { ...missing, materials: {} }), /version_conflict/);
  await resume(iid); const current = await view(iid); assert.equal(current.recordVersion, Number(record.version) + 1); assert.equal(current.drawingGrantId, null);
});
test('paged-out originals still have bounded current revision metadata for same-issue recovery after fresh reentry', async () => {
  const { iid, rid } = await open(); await cancel(iid); const sharedCid = String((await boss.read(pid)).conversationId);
  await withTenantTransaction(eid, async tx => {
    await tx.execute(sql`select id from app.assistant_conversations where enterprise_id=${eid} and id=${sharedCid} for update`);
    for (let i = 0; i < 35; i++) await appendMessage(tx, boss.actor, sharedCid, { author: 'admin', clientMessageId: randomUUID(), purpose: 'site.source',
      content: { version: 1, blocks: [{ type: 'text', text: '合成分页占位，仅用于持久重进' + i }] } });
  });
  const fresh = new SiteChatService({ enterpriseId: eid, adminId: admins[0] }), data = await fresh.read(pid);
  assert.ok(!(data.items as Row[]).some(i => String((i.record as Row | null)?.id) === rid), 'source is outside the latest message page');
  assert.equal(((data.versions as Row).records as Row)[rid], (await view(iid)).recordVersion);
  assert.ok(Object.keys((data.versions as Row).records as Row).length <= 150);
  await resume(iid, fresh); assert.equal((await view(iid)).status, 'awaiting_owner');
});
test('human takeover defers the same event, obsolete cancellation dies, and resume needs a new explicit return', async () => {
  const { iid } = await open(); await cancel(iid);
  const h = new HandoffService(chat.actor); await h.customerWrite(cid, randomUUID(), { action: 'request', recipientId: admins[2] });
  await publish(iid); const event = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.domain_event_outbox
    where enterprise_id=${eid} and type='construction.site.issue.result.v1' and aggregate_id=${iid} order by id desc limit 1`));
  assert.equal(await deliverSiteResults(), 0); await resume(iid);
  await h.customerWrite(cid, randomUUID(), { action: 'cancel' }); await deliverSiteResults();
  const old = await withTenantTransaction(eid, tx => one(tx, sql`select status from app.domain_event_deliveries where enterprise_id=${eid}
    and event_id=${String(event!.id)} and consumer_key=${'construction:result:'+cid}`)); assert.equal(old?.status, 'dead');
  await publish(iid); assert.equal(await deliverSiteResults(), 1); assert.equal(await deliverSiteResults(), 0);
  assert.equal((await followups()).data.find(x => x.issueId === iid)!.status, 'awaiting_owner');
});
test('removed assignee stays unassigned on recovery and no old returned authority revives after membership is restored', async () => {
  const { iid } = await open(); await publish(iid); await deliverSiteResults();
  await member(admins[2], false); assert.equal((await followups()).data.find(x => x.issueId === iid)!.status, 'invalidated');
  await member(admins[2], true); assert.equal((await followups()).data.find(x => x.issueId === iid)!.status, 'invalidated');
  await member(admins[2], false); await publish(iid); await deliverSiteResults();
  assert.equal((await followups()).data.find(x => x.issueId === iid)!.waitingFor, 'unassigned', 'a manager may explicitly return the live unassigned state without reviving an old reply');
  assert.equal((await view(iid)).progressMessageId, null);
  await cancel(iid); await resume(iid); await publish(iid); await deliverSiteResults();
  const current = (await followups()).data.find(x => x.issueId === iid)!;
  assert.equal(current.waitingFor, 'unassigned'); assert.equal(current.ownerName, ''); assert.match(current.value, /尚未分配/);
  await member(admins[2], true);
  assert.equal((await view(iid)).ownerId, null, 'rejoining cannot auto-assign the returned or recovered issue');
});
test('owner/admin/super_admin restore in the selected enterprise without membership; disabled/password-required identities cannot', async () => {
  for (const aid of [admins[0], ...platform]) {
    const { iid } = await open(); await cancel(iid); await resume(iid, new SiteChatService({ enterpriseId: eid, adminId: aid }));
    assert.equal((await view(iid)).status, 'awaiting_owner');
  }
  const { iid } = await open(); await cancel(iid);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=true where id=${platform[0]}`));
  await assert.rejects(resume(iid, new SiteChatService({ enterpriseId: eid, adminId: platform[0] })), /construction_forbidden/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=false,status='disabled' where id=${platform[0]}`));
  await assert.rejects(resume(iid, new SiteChatService({ enterpriseId: eid, adminId: platform[0] })), /construction_forbidden/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${platform[0]}`));
});
test('cross-tenant, nonmember and observer writes cannot recover another project issue or expand customer visibility', async () => {
  const { iid } = await open(); await cancel(iid); const revision = (await view(iid)).revision;
  for (const service of [new SiteChatService({ enterpriseId: enterprises[1], adminId: admins[0] }),
    new SiteChatService({ enterpriseId: eid, adminId: admins[3] })]) await assert.rejects(resume(iid, service));
  await member(admins[2], false); await assert.rejects(resume(iid, designer)); await member(admins[2], true);
  assert.equal((await view(iid)).revision, revision);
});
test('legacy delivered results retain their original source hash and progress shape across the code upgrade', async () => {
  const { iid } = await open(), issue = await view(iid);
  const materials = await withTenantTransaction(eid, tx => sharedMaterials(tx, eid, pid, roomId));
  const need = materials.sources.find(s => s.kind === 'need')!;
  const payload = { projectId: pid, issueId: iid, revision: issue.revision, conversationId: cid, customerId: uid,
    materialVersion: materials.version, needGrantId: need.id, drawingGrantId: null, text: '合成旧格式回传，仍待核对', roomName: '书房' };
  // Insert an old-format fixture event, without rewriting any existing immutable event.
  await withTenantTransaction(eid, tx => tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.site.issue.result.v1','construction_site_issue',${iid},${issue.revision},${JSON.stringify(boss.actor.principal)}::jsonb,${randomUUID()},${JSON.stringify(payload)}::jsonb)`));
  assert.equal(await deliverSiteResults(), 1);
  const current = (await followups()).data.find(x => x.issueId === iid)!;
  assert.equal(current.status, 'awaiting_review'); assert.equal(current.ownerName, ''); assert.equal(current.waitingFor, 'team'); assert.equal(current.lastProgress, 'team_result');
  assert.equal(current.sourceVersion, fingerprint({ materialVersion: materials.version, lifecycleId: null, text: payload.text, shareOriginals: false }));
});
test('withdrawn customer source invalidates new status and pending delivery; recovery never reauthorizes an old excerpt', async () => {
  const { iid } = await open(); await cancel(iid); await resume(iid); await publish(iid); await deliverSiteResults();
  const history = await chat.messages(cid, undefined, 100), result = history.items.filter(m => /项目团队回传/.test(safeText(m.content as Parameters<typeof safeText>[0]))).at(-1)!;
  assert.ok(result.available); assert.doesNotMatch(safeText(result.content as Parameters<typeof safeText>[0]), /PRIVATE_INTERNAL_REPLY/);
  const grant = await withTenantTransaction(eid, tx => one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
    and type='construction.material.shared.v1' order by id desc limit 1`));
  await say('撤回共享资料' + String(grant!.id));
  assert.equal((await followups()).data.find(x => x.issueId === iid)!.status, 'invalidated');
  assert.equal((await chat.messages(cid, undefined, 100)).items.find(m => m.id === result.id)!.available, false);
  await assert.rejects(publish(iid), /context_changed|site_review_required/);
  await cancel(iid); await resume(iid); await assert.rejects(publish(iid), /site_review_required/);
});
