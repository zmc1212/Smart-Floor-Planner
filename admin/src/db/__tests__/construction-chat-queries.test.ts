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
import { ConversationService } from '@/lib/assistant/core/conversation';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';

const prefix = 'shared-query-' + randomUUID();
const eids: string[] = [], aids: string[] = [], uids: string[] = [];
let pid: string, otherPid: string, rid: string, mid: string;
let owner: ConstructionService, boss: SiteChatService, worker: SiteChatService, designer: SiteChatService;
const members: string[] = [];
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const item = async (messageId: string) => ((await boss.read(pid)).items as Row[]).find(i => String((i.message as Row).id) === messageId)!;
const record = async () => ((await boss.read(pid)).items as Row[]).find(i => (i.record as Row | null)?.id === rid)!.record as Row;
const counts = () => withTenantTransaction(eids[0], tx => one(tx, sql`select
  (select count(*) from app.construction_site_records where enterprise_id=${eids[0]}) records,
  (select count(*) from app.assistant_runs where enterprise_id=${eids[0]}) runs`));

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
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
  await privateChat.create(randomUUID());
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
  }); } finally { await closePostgresPool(); }
});

test('PPT23 query preserves same shared originals, exact record version and missing sources without creating a draft/job', async () => {
  const before = await counts(), key = randomUUID(), body = { text: '书房底盒待核对，帮我找对应图纸和需求', mediaIds: [] };
  const result = await designer.send(pid, body, key);
  assert.equal(result.recordId, null); assert.equal(result.runId, null); assert.equal(result.intent, 'query');
  assert.deepEqual(await designer.send(pid, body, key), result); assert.deepEqual(await counts(), before);
  const response = (await item(String(result.messageId))).response as Row;
  assert.match(String(response.text), new RegExp('记录' + rid)); assert.match(String(response.text), /原现场照片：1张/); assert.match(String(response.text), /缺项.*点位图/); assert.match(String(response.text), /私人咨询/);
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
