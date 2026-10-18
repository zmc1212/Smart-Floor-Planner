import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { siteMessageIntent } from '@/lib/construction/site-queries';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { projectSiteIssues, siteIssueCommand } from '@/lib/construction/site-issues';

const prefix = 'shared-query-' + randomUUID();
const eids: string[] = [], aids: string[] = [], uids: string[] = [], platformIds: string[] = [];
let pid: string, otherPid: string, rid: string, mid: string;
let owner: ConstructionService, boss: SiteChatService, worker: SiteChatService, designer: SiteChatService;
const members: string[] = [];
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const item = async (messageId: string) => ((await boss.read(pid)).items as Row[]).find(i => String((i.message as Row).id) === messageId)!;
const record = async () => ((await boss.read(pid, undefined, 100)).items as Row[]).find(i => (i.record as Row | null)?.id === rid)!.record as Row;
const counts = () => withTenantTransaction(eids[0], tx => one(tx, sql`select
  (select count(*) from app.construction_site_records where enterprise_id=${eids[0]}) records,
  (select count(*) from app.assistant_runs where enterprise_id=${eids[0]}) runs`));
const command = async (service: SiteChatService, text: string, key = randomUUID(), versions?: Row) => service.send(pid,
  { text, mediaIds: [], versions: versions || (await service.read(pid)).versions }, key);
const issue = async () => (await withTenantTransaction(eids[0], tx => projectSiteIssues(tx, eids[0], pid)))[0];

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (const role of ['admin','super_admin']) platformIds.push(String((await one(tx,sql`insert into app.admin_users(username,password_hash,role,status,must_change_password,display_name)
      values(${prefix+role},'test-only',${role},'active',false,${'合成'+role}) returning id`))!.id));
    for (let n = 0; n < 2; n++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id); eids.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,100,12000000,1000000000,30)`);
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${eid},${prefix+n},'test-only','enterprise_admin','active',false,'合成负责人') returning id`))!.id));
    }
    for (const [index, role] of ['construction_staff','designer','construction_staff'].entries()) members.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eids[0]},${prefix+'staff'+index},'test-only',${role},'active',false,${['合成师傅','合成设计师','合成观察员'][index]}) returning id`))!.id));
    uids.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uids[0]},${prefix})`);
  });
  owner = new ConstructionService({ enterpriseId: eids[0], adminId: aids[0] });
  boss = new SiteChatService(owner.actor); worker = new SiteChatService({ enterpriseId: eids[0], adminId: members[0] }); designer = new SiteChatService({ enterpriseId: eids[0], adminId: members[1] });
  const leadId = String((await withTenantTransaction(eids[0], tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
    values(${eids[0]},${uids[0]},'合成业主','13982000091','natural') returning id`)))!.id);
  for (const name of ['本期合成工地','隔离反例工地']) {
    const p = await act('create', { leadId, name, managerId: aids[0], rooms: ['书房','客厅'] });
    if (!pid) pid = String(p.id); else otherPid = String(p.id);
  }
  for (let n = 0; n < 3; n++) await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[n], role: ['worker','designer','observer'][n], active: true, workLabel: '' });
  const privateChat = new ConversationService({ enterpriseId: eids[0], principal: { kind: 'user', userId: uids[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } });
  const privateConversation = await privateChat.create(randomUUID());
  await withTenantTransaction(eids[0], tx => appendMessage(tx, privateChat.actor, String(privateConversation.id), { author:'user', clientMessageId:randomUUID(),
    content: { version:1, blocks:[{type:'text',text:'PRIVATE_NEED_DO_NOT_SHARE 书房双人办公的私人生活需求'}] } }));
  const bytes = await sharp({ create: { width: 48, height: 40, channels: 3, background: '#b7b09c' } }).png().toBuffer();
  mid = String((await worker.upload(pid, randomUUID(), bytes)).id);
  const source = await worker.send(pid, { text: '书房线管今天铺好了，底盒还没固定，等设计师核对位置。', mediaIds: [mid] }, randomUUID()); rid = String(source.recordId);
  const room = ((await boss.read(pid)).rooms as Row[]).find(r => r.name === '书房')!;
  const lease = await claimJob(); assert.equal(lease?.runId, source.runId);
  await processSiteRecord(lease!, async () => ({ text: JSON.stringify({ title: '书房施工进展', roomId: String(room.id), completed: '线管铺好了', pending: '底盒还没固定', coordination: '等设计师核对位置', note: '' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 120, outputTokens: 60 } }));
});

after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) { await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); }
    for (const uid of uids) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
    for (const aid of platformIds) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  }); } finally { await closePostgresPool(); }
});

test('PPT23 query preserves same shared originals, exact record version and missing sources without creating a draft/job', async () => {
  const before = await counts(), key = randomUUID(), body = { text: '书房底盒待核对，帮我找对应图纸和需求', mediaIds: [] };
  const result = await designer.send(pid, body, key);
  assert.equal(result.recordId, null); assert.equal(result.runId, null); assert.equal(result.intent, 'query');
  assert.deepEqual(await designer.send(pid, body, key), result); assert.deepEqual(await counts(), before);
  const response = (await item(String(result.messageId))).response as Row;
  assert.match(String(response.text), new RegExp('记录' + rid)); assert.match(String(response.text), /原现场照片：1张/); assert.match(String(response.text), /缺项.*点位图/); assert.match(String(response.text), /私人咨询/);
  assert.doesNotMatch(String(response.text), /PRIVATE_NEED_DO_NOT_SHARE|私人生活需求/);
  assert.deepEqual((await designer.operation(pid, key)).result, result);
  const reentered = await new SiteChatService(designer.staff).read(pid); assert.ok((reentered.items as Row[]).some(i => (i.message as Row).id === result.messageId));
});

test('ambiguous rooms and acknowledgements retain originals but produce no progress or approval', async () => {
  const before = await counts();
  for (const raw of ['帮我找对应图纸和需求', '书房和客厅的资料在哪里？', '收到', '请跟进书房的底盒问题']) {
    const r = await worker.send(pid, { text: raw, mediaIds: [] }, randomUUID()); assert.equal(r.recordId, null); assert.equal(r.runId, null);
  }
  assert.deepEqual(await counts(), before);
  assert.equal(siteMessageIntent('书房线管今天铺好了，底盒还没固定，等设计师核对位置。', 1), 'report');
  assert.equal(siteMessageIntent('书房底盒安装好了吗', 0), 'query');
});

test('query photos are shared original attachments without a record and cannot be reused or deleted after sending', async () => {
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#d0bca0' } }).png().toBuffer();
  const photo = String((await worker.upload(pid, randomUUID(), bytes)).id);
  await assert.rejects(designer.media(pid, photo));
  const result = await worker.send(pid, { text: '书房底盒待核对，帮我找相关资料', mediaIds: [photo] }, randomUUID());
  assert.equal(result.recordId, null); assert.equal(((await item(String(result.messageId))).response as Row).media instanceof Array, true);
  assert.ok((await designer.media(pid, photo)).data.length);
  await assert.rejects(worker.removeMedia(pid, photo, randomUUID()));
  await assert.rejects(worker.send(pid, { text: '书房今天施工进展', mediaIds: [photo] }, randomUUID()));
});

test('record corrections invalidate prior derived query text while a fresh query reads the current version', async () => {
  const result = await designer.send(pid, { text: '书房的记录在哪里？', mediaIds: [] }, randomUUID());
  const r = await record(); await boss.mutate(pid, rid, 'edit', { expectedVersion: r.version, data: { ...(r.data as Row), pending: '底盒位置仍待核对，暂不固定' } }, randomUUID());
  assert.match(String(((await item(String(result.messageId))).response as Row).text), /资料已变化/);
  const current = await designer.send(pid, { text: '查一下书房的现场资料', mediaIds: [] }, randomUUID());
  assert.match(String(((await item(String(current.messageId))).response as Row).text), new RegExp('版本' + (Number(r.version) + 1)));
});

test('member removal, observer, same-tenant other project and cross-tenant checks cover reads/media/writes/receipts', async () => {
  await assert.rejects(worker.read(otherPid));
  await assert.rejects(new SiteChatService({ enterpriseId: eids[1], adminId: aids[1] }).read(pid));
  await assert.rejects(new SiteChatService({ enterpriseId: eids[0], adminId: members[2] }).send(pid, { text: '查书房资料', mediaIds: [] }, randomUUID()));
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[1], role: 'designer', active: false, workLabel: '' });
  await assert.rejects(designer.read(pid)); await assert.rejects(designer.media(pid, mid)); await assert.rejects(designer.operation(pid, randomUUID()));
  await assert.rejects(designer.send(pid, { text: '查询书房资料', mediaIds: [] }, randomUUID()));
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[1], role: 'designer', active: true, workLabel: '' });
  assert.equal((await withTenantTransaction(eids[1], tx => rows(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eids[0]}`))).length, 0);
});

test('PPT23/38 explicit follow-up persists one issue, self-claim, owner transfer and sourced reply in the original conversation', async () => {
  const before = await counts();
  const opened = await command(worker, '请跟进记录' + rid + '：底盒位置需核对');
  assert.equal(opened.revision, 1); assert.equal((await issue()).status, 'awaiting_owner'); assert.equal((await issue()).ownerId, null);
  const duplicate = await command(worker, '请跟进记录' + rid + '：底盒位置需核对'); assert.equal(duplicate.issueId, opened.issueId); assert.equal(duplicate.revision, 1);
  const claimed = await command(designer, '接手事项' + opened.issueId); assert.equal(claimed.revision, 2); assert.equal((await issue()).ownerId, members[1]);
  await assert.rejects(command(worker, '转交事项' + opened.issueId + '给合成师傅'), { code: 'construction_forbidden' });
  const transferred = await command(designer, '转交事项' + opened.issueId + '给合成师傅'); assert.equal(transferred.revision, 3); assert.equal((await issue()).ownerId, members[0]);
  const reply = await command(worker, '回复事项' + opened.issueId + '：现场尺寸已复核，底盒先不固定，等待设计师核对点位图。');
  assert.equal(reply.revision, 4); assert.equal((await issue()).status, 'awaiting_review'); assert.match((await issue()).text, /先不固定/);
  const reentered = await new SiteChatService(boss.staff).read(pid), original = (reentered.items as Row[]).find(i => (i.record as Row | null)?.id === rid)!;
  assert.equal((original.issue as Row).issueId, opened.issueId); assert.equal((original.issue as Row).revision, 4);
  const query = await command(designer, '事项' + opened.issueId + '在等谁？'); assert.match(String(((await item(String(query.messageId))).response as Row).text), /合成师傅/);
  assert.deepEqual(await counts(), before); // No record/job/publication is inferred from an issue action.
});

test('optimistic revisions and original-key replay reject stale transfer and recover a lost reply exactly once', async () => {
  const current = await issue(), versions = (await worker.read(pid)).versions as Row, key = randomUUID();
  const text = '回复事项' + current.issueId + '：收到，还需要负责人核对。';
  const first = await command(worker, text, key, versions); assert.deepEqual(await command(worker, text, key, versions), first);
  assert.deepEqual((await worker.operation(pid, key)).result, first); assert.equal((await issue()).revision, current.revision + 1);
  await assert.rejects(command(boss, '转交事项' + current.issueId + '给合成设计师', randomUUID(), versions), { code: 'version_conflict' });
  await assert.rejects(command(boss, '转交事项' + current.issueId + '给合成观察员'), { code: 'construction_staff_unavailable' });
  await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.admin_users set display_name='合成设计师' where enterprise_id=${eids[0]} and id=${members[0]}`));
  try { await assert.rejects(command(boss, '转交事项' + current.issueId + '给合成设计师'), { code: 'construction_staff_unavailable' }); }
  finally { await withTenantTransaction(eids[0],tx=>tx.execute(sql`update app.admin_users set display_name='合成师傅' where enterprise_id=${eids[0]} and id=${members[0]}`)); }
  await command(worker, '收到'); assert.equal((await issue()).revision, first.revision); assert.equal((await issue()).status, 'awaiting_review');
  assert.equal(siteIssueCommand('如果接手事项' + current.issueId), null); assert.equal(siteIssueCommand('不要取消事项' + current.issueId + '：测试'), null);
});

test('same issue survives stage change, loses removed owner, and rejects old source after correction until explicit recheck', async () => {
  const original = await issue();
  await act('progress', { projectId: pid, expectedVersion: await pv(), stageKey: 'utilities', note: '合成节点变化', sendReminder: false });
  assert.equal((await issue()).issueId, original.issueId); assert.equal((await issue()).revision, original.revision);
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[0], role: 'worker', active: false, workLabel: '' });
  assert.equal((await issue()).ownerId, null); assert.equal((await issue()).status, 'awaiting_owner');
  await assert.rejects(command(worker, '回复事项' + original.issueId + '：越权回复'));
  await command(boss, '转交事项' + original.issueId + '给合成设计师');
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: members[0], role: 'worker', active: true, workLabel: '' });
  const r = await record(); await boss.mutate(pid, rid, 'edit', { expectedVersion: r.version, data: { ...(r.data as Row), pending: '改到另一面墙，仍需核对' } }, randomUUID());
  assert.equal((await issue()).status, 'invalidated'); assert.doesNotMatch((await issue()).text, /现场尺寸已复核/);
  await assert.rejects(command(designer, '回复事项' + original.issueId + '：沿用旧资料'), { code: 'context_changed' });
  await command(designer, '重新核对事项' + original.issueId + '：已核对当前记录，继续处理');
  assert.equal((await issue()).issueId, original.issueId); assert.equal((await issue()).status, 'awaiting_owner'); assert.equal((await issue()).recordVersion, Number(r.version) + 1);
});

test('owner, admin and super_admin inherit issue handling in the selected enterprise without project membership', async () => {
  const current = await issue();
  for (const aid of [aids[0],...platformIds]) {
    const management = new SiteChatService({enterpriseId:eids[0],adminId:aid});
    const claimed = await command(management,'接手事项'+current.issueId);
    assert.equal((await issue()).ownerId,aid);
    assert.equal((await command(management,'接手事项'+current.issueId)).revision,claimed.revision);
    await command(management,'回复事项'+current.issueId+'：已复核记录，需要设计师继续核对。');
    await command(management,'转交事项'+current.issueId+'给合成设计师');
    assert.equal((await issue()).ownerId,members[1]);
  }
});

test('cancel requires author/manager and a reason; repeated opening never revives cancelled business or grants customer access', async () => {
  const current = await issue();
  await assert.rejects(command(designer, '取消事项' + current.issueId + '：需要撤销'), { code: 'construction_forbidden' });
  assert.equal(siteIssueCommand('取消事项' + current.issueId), null);
  const cancelled = await command(worker, '取消事项' + current.issueId + '：本次跟进请求撤回，现场另行核对');
  assert.equal((await issue()).status, 'cancelled');
  const again = await command(worker, '跟进记录' + rid); assert.equal(again.issueId, current.issueId); assert.equal(again.revision, cancelled.revision);
  await assert.rejects(command(boss, '接手事项' + current.issueId), { code: 'context_changed' });
  const r = await record(); assert.equal(r.status, 'draft'); assert.equal(r.audience, 'internal');
  const latest = await boss.read(pid); assert.ok(latest.nextCursor);
  const older = await boss.read(pid, String(latest.nextCursor));
  const original = (older.items as Row[]).find(i => (i.record as Row | null)?.id === rid)!;
  assert.equal((original.issue as Row).issueId, current.issueId); assert.equal((original.issue as Row).status, 'cancelled');
  const events = await withTenantTransaction(eids[0], tx => rows(tx, sql`select aggregate_version from app.domain_event_outbox where enterprise_id=${eids[0]}
    and type='construction.site.issue.progress.v1' and aggregate_id=${current.issueId} order by aggregate_version`));
  assert.deepEqual(events.map(e => Number(e.aggregate_version)), Array.from({ length: Number(cancelled.revision) - 1 }, (_, i) => i + 2));
});
