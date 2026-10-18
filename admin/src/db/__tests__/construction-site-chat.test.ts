import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { siteChatHttp } from '@/lib/construction/site-http';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { claimJob, markProviderStarted } from '@/lib/assistant/infrastructure/job-queue';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { customerSiteMedia, publishedSiteRecord, deliverSiteNotifications } from '@/lib/construction/site-publications';
import { queryBusiness, businessSnapshotAvailable } from '@/lib/assistant/agent/business-tools';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { GET } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { GET as adminGet, POST as adminPost } from '@/app/api/construction/[[...path]]/route';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { parseSiteDraft } from '@/lib/construction/site-contract';
import { siteWatchIntent } from '@/lib/construction/site-watches';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'site-chat-' + randomUUID(), eids: string[] = [], uids: string[] = [], owners: string[] = [], staffIds: string[][] = [];
const platformIds: string[] = [];
let pid: string, otherPid: string, lid: string, workerUser: string, cid: string, mediaId: string, rid: string;
let owner: ConstructionService, customer: ActorContext, privateChat: ConversationService;
const live = process.env.CONSTRUCTION_LIVE_MODEL === '1';
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
const actor = (index = 0, staffIndex = 0) => ({ enterpriseId: eids[index], adminId: staffIds[index][staffIndex],
  ...(index === 0 && staffIndex === 0 ? { miniProgramUserId: workerUser, miniProgramContextVersion: 1 } : {}) });
const site = (index = 0, staffIndex = 0) => new SiteChatService(actor(index, staffIndex));
const boss = () => new SiteChatService({ enterpriseId: eids[0], adminId: owners[0] });
const read = () => site().read(pid);
const record = async (id = rid) => ((await read()).items as Row[]).find(x => String((x.record as Row).id) === id)!.record as Row;
const act = (action: string, body: Row) => owner.execute(action, body, randomUUID());
const pv = async () => Number(((await owner.execute('detail', { projectId: pid })).project as Row).version);
const edit = async (service = boss(), data: Row = {}) => service.mutate(pid, rid, 'edit', { expectedVersion: Number((await record()).version), data: { ...(await record()).data as Row, ...data } }, randomUUID());
const publish = async (audience = 'customer') => boss().mutate(pid, rid, 'publish', { expectedVersion: Number((await record()).version), audience }, randomUUID());
const output = (roomId: string): ModelTurnOutput => ({ text: JSON.stringify({ title: '书房施工进展', roomId, completed: '线管今天铺好了', pending: '底盒还没固定', coordination: '请设计师核对底盒位置', note: '' }),
  toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 120, outputTokens: 60 } });
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  if (live) {
    const primary = new URL(process.env.CONSTRUCTION_PRIMARY_DATABASE_URL || '');
    assert.ok(['localhost','127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port, '5432'); assert.equal(primary.pathname, '/smart_floor_planner');
    const evaluation = process.env.DATABASE_URL; await closePostgresPool();
    let provider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try { process.env.DATABASE_URL = primary.toString(); provider = await getPlatformLlmRuntimeConfig(); }
    finally { await closePostgresPool(); process.env.DATABASE_URL = evaluation; }
    assert.equal(provider.providerKey, 'deepseek'); assert.equal(new URL(provider.baseUrl).origin, 'https://api.deepseek.com');
    priorProvider = await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({ enabled: true, providerKey: provider.providerKey, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey });
  }
  await withPlatformTransaction(async tx => {
    for (const role of ['admin','super_admin']) platformIds.push(String((await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password,display_name)
      values(${prefix+role},'test-only',${role},'active',false,${role}) returning id`))!.id));
    for (let i = 0; i < 2; i++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id); eids.push(eid); staffIds.push([]);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,12000000,1000000000,30,'{"runtime":"langgraph-v1","providerKey":"deepseek","model":"deepseek-flash","tools":true,"imageInput":true,"probeVersion":"site-isolation-fixture"}'::jsonb)`);
      owners.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${eid},${prefix+i+'owner'},'test-only','enterprise_admin','active',false,'隔离负责人') returning id`))!.id));
      for (let n = 0; n < 3; n++) {
        const uid = String((await one(tx, sql`insert into app.users(nickname,phone,context_version) values(${prefix+i+n},${'13981'+String(i*10+n).padStart(6,'0')},1) returning id`))!.id); uids.push(uid); if (!i && !n) workerUser = uid;
        staffIds[i].push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,user_id,username,password_hash,role,status,must_change_password,display_name)
          values(${eid},${uid},${prefix+i+n},'test-only',${n === 1 ? 'designer' : 'construction_staff'},'active',${n === 0},${['水电师傅','项目设计师','只读成员'][n]}) returning id`))!.id));
      }
    }
    const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+'customer'},1) returning id`))!.id); uids.push(uid);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
    lid = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[0]},${uid},'隔离业主','13982000001','natural') returning id`))!.id);
    customer = { enterpriseId: eids[0], principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lid } };
  });
  owner = new ConstructionService({ enterpriseId: eids[0], adminId: owners[0] });
  pid = String((await act('create', { leadId: lid, name: '隔离一号工地', managerId: owners[0], rooms: ['书房','客厅'] })).id);
  otherPid = String((await act('create', { leadId: lid, name: '隔离二号工地', managerId: owners[0], rooms: [] })).id);
  for (let n = 0; n < 3; n++) await act('member', { projectId: pid, expectedVersion: await pv(), adminId: staffIds[0][n], role: ['worker','designer','observer'][n], active: true, workLabel: '' });
  privateChat = new ConversationService(customer); cid = String((await privateChat.create(randomUUID())).id);
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) {
      await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid));
      await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`);
    }
    for (const uid of uids) { await tx.execute(sql`delete from app.wechat_identities where user_id=${uid}`); await tx.execute(sql`delete from app.users where id=${uid}`); }
    for (const aid of platformIds) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  }); } finally { try { if (priorProvider) await savePlatformLlmConfig(priorProvider); } finally { await closePostgresPool(); } }
});

test('shared conversation is project-owned; designer, worker and owner reenter the same conversation', async () => {
  const first = await read(); const second = await site(0, 1).read(pid); const third = await boss().read(pid);
  assert.equal(first.conversationId, second.conversationId); assert.equal(first.conversationId, third.conversationId); assert.notEqual(first.conversationId, cid);
  assert.notEqual((await boss().read(otherPid)).conversationId, first.conversationId);
  await assert.rejects(site().read(otherPid)); await assert.rejects(site(1).read(pid));
  await assert.rejects(withTenantTransaction(eids[0], tx => new AssistantRepository(tx, site().actor).conversation(cid)));
});
test('phone-authorized first-password-change staff can use the HTTP entry without acquiring customer/private-chat access', async () => {
  const token = await signMiniProgramToken({ sub: workerUser, id: workerUser, mode: 'staff', role: 'construction_staff', staffRole: 'construction_staff', staffId: staffIds[0][0], enterpriseId: eids[0], contextVersion: 1, source: 'phone' });
  const response = await GET(new NextRequest(`http://localhost:3006/api/miniprogram/construction/projects/${pid}/chat`, { headers: { Authorization: 'Bearer ' + token } }), { params: Promise.resolve({ path: ['projects',pid,'chat'] }) });
  assert.equal(response.status, 200);
});
test('media normalizes to private JPEG, deduplicates keys and remains private until explicitly sent', async () => {
  const bytes = await sharp({ create: { width: 48, height: 40, channels: 3, background: '#b7b09c' } }).png().toBuffer(), k = randomUUID();
  mediaId = String((await site().upload(pid, k, bytes)).id); assert.equal((await site().upload(pid, k, bytes)).id, mediaId);
  assert.equal((await site().media(pid, mediaId)).mime, 'image/jpeg');
  await assert.rejects(site(0, 1).media(pid, mediaId)); await assert.rejects(site(1).media(pid, mediaId));
  await assert.rejects(site().upload(pid, randomUUID(), Buffer.from('<svg/>')));
  const url = `http://localhost:3006/api/miniprogram/construction/projects/${pid}/chat/media`, form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'fixture.png');
  const response = await siteChatHttp(new Request(url, { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: form }), actor(), pid, ['media']);
  assert.equal(response.status, 200); const uploaded = (await response.json()).data;
  const removed = await siteChatHttp(new Request(url + '/' + uploaded.id + '/remove', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: '{}' }), actor(), pid, ['media',String(uploaded.id),'remove']);
  assert.equal(removed.status, 200); await assert.rejects(site().media(pid, String(uploaded.id)));
  await assert.rejects(siteChatHttp(new Request(url, { method: 'POST', headers: { 'Idempotency-Key': randomUUID(), 'Content-Type': 'text/plain' }, body: 'bad multipart' }), actor(), pid, ['media']), { code: 'media_invalid', status: 422 });
  await assert.rejects(siteChatHttp(new Request(url.replace(/media$/, 'messages'), { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: 'x'.repeat(20001) }), actor(), pid, ['messages']), { status: 413 });
});
test('real source and job commit once; configured model contract produces a shared review draft without publication', async () => {
  const k = randomUUID(), body = { text: '书房线管今天铺好了，底盒还没固定，等设计师核对位置。', mediaIds: [mediaId] };
  const sent = await site().send(pid, body, k); rid = String(sent.recordId);
  assert.deepEqual(await site().send(pid, body, k), sent);
  await assert.rejects(site().send(pid, { ...body, text: '另一个内容' }, k));
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  const room = ((await read()).rooms as Row[]).find(r => r.name === '书房')!;
  await processSiteRecord(lease!, async messages => { assert.ok(JSON.stringify(messages).includes('image/jpeg')); return output(String(room.id)); });
  const r = await record(); assert.equal(r.status, 'draft'); assert.equal((r.data as Row).pending, '底盒还没固定'); assert.equal(r.audience, 'internal');
  assert.equal(((await site(0, 1).read(pid)).items as Row[]).length, 1); assert.ok((await site(0, 1).media(pid, mediaId)).data.length);
});
test('author/manager mutation boundaries, observer writes and exact versions are enforced', async () => {
  const r = await record(), body = { expectedVersion: r.version, data: r.data };
  await assert.rejects(site(0, 1).mutate(pid, rid, 'edit', body, randomUUID()));
  await assert.rejects(site(0, 2).send(pid, { text: '不能发送', mediaIds: [] }, randomUUID()));
  const results = await Promise.allSettled([site().mutate(pid, rid, 'edit', body, randomUUID()), boss().mutate(pid, rid, 'edit', body, randomUUID())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});
test('explicit watch uses the original private chat with a real receipt and visible cancel action', async () => {
  const k = randomUUID(), content = { version: 1, blocks: [{ type: 'text', text: '隔离一号工地书房有新照片告诉我' }] };
  const result = await privateChat.send(cid, k, content, siteWatchInterceptor); assert.equal(result.runId, null);
  await privateChat.send(cid, k, content, siteWatchInterceptor);
  const history = await privateChat.messages(cid); assert.ok((history.items as Row[]).some(m => m.siteWatch));
  const count = await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) n from app.construction_watches where enterprise_id=${eids[0]} and active`)); assert.equal(Number(count!.n), 1);
});
test('internal publication never opens the source chat or notifies the homeowner; worker cannot select the customer audience', async () => {
  await assert.rejects(site().mutate(pid, rid, 'publish', { expectedVersion: (await record()).version, audience: 'customer' }, randomUUID()));
  await site().mutate(pid, rid, 'publish', { expectedVersion: (await record()).version, audience: 'internal' }, randomUUID());
  assert.ok(!(await privateChat.messages(cid)).items.some((m: Row) => m.siteRecord));
});
test('manager publication exposes only this reviewed version and associated photos, and reentry does not duplicate delivery', async () => {
  await edit(); const result = await publish();
  assert.ok(await deliverSiteNotifications() >= 1);
  const stored = await withTenantTransaction(eids[0], tx => one(tx, sql`select id from app.assistant_messages where enterprise_id=${eids[0]} and conversation_id=${cid} and purpose='construction.record'`)); assert.ok(stored);
  const history = await privateChat.messages(cid);
  const m = (history.items as Row[]).find(m => (m.siteRecord as Row)?.id === rid)!; assert.ok(m); assert.equal((m.siteRecord as Row).version, result.version);
  assert.equal((await privateChat.messages(cid)).items.filter((m: Row) => (m.siteRecord as Row)?.id === rid).length, 1);
  const media = await withTenantTransaction(eids[0], async tx => { const repo = new AssistantRepository(tx, customer); await repo.settings(); return customerSiteMedia(tx, customer, await repo.conversation(cid), rid, mediaId, Number(result.version)); });
  assert.equal(media.mime, 'image/jpeg');
  const snapshot = await withTenantTransaction(eids[0], tx => queryBusiness(tx, customer, { domain: 'construction', leadId: lid }));
  assert.match(snapshot.displayText, /底盒还没固定/);
  const k = randomUUID(), body = { expectedVersion: (await record()).version, reason: '底盒位置需要重新核对' };
  await boss().mutate(pid, rid, 'withdraw', body, k); await boss().mutate(pid, rid, 'withdraw', body, k);
  assert.equal(await withTenantTransaction(eids[0], tx => businessSnapshotAvailable(tx, eids[0], snapshot)), false);
  assert.equal(await withTenantTransaction(eids[0], tx => publishedSiteRecord(tx, eids[0], customer.principal.kind === 'user' ? customer.principal.userId : '', rid)), undefined);
  assert.ok((await privateChat.messages(cid)).items.some((m: Row) => m.available === false));
  await assert.rejects(withTenantTransaction(eids[0], async tx => customerSiteMedia(tx, customer, await new AssistantRepository(tx, customer).conversation(cid), rid, mediaId, Number(result.version))));
});
test('owner, administrator and super administrator can review/publish in the selected enterprise without project membership', async () => {
  for (const aid of [owners[0], ...platformIds]) {
    const service = new SiteChatService({ enterpriseId: eids[0], adminId: aid });
    const role = aid === owners[0] ? 'enterprise_admin' : platformIds.indexOf(aid) === 0 ? 'admin' : 'super_admin';
    const jwt = await new SignJWT({ id: aid, role, enterpriseId: role === 'enterprise_admin' ? eids[0] : null, permissions: ['construction-projects'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const http = async (suffix: string[], body?: Row) => {
      const path = ['projects',pid,'chat',...suffix];
      return (body ? adminPost : adminGet)(new NextRequest('http://localhost:3006/api/construction/' + path.join('/'), { method: body ? 'POST' : 'GET',
        headers: { cookie: 'auth_token=' + jwt + (role === 'enterprise_admin' ? '' : '; global_tenant_id=' + eids[0]), 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ path }) });
    };
    assert.equal((await http([])).status, 200);
    const response = await http(['messages'], { text: '项目管理人员现场留档，等待核对。', mediaIds: [] }); assert.equal(response.status, 200);
    const sent = (await response.json()).data;
    await service.mutate(pid, String(sent.recordId), 'edit', { expectedVersion: 1, data: { title: '现场留档', roomId: null, completed: '', pending: '', coordination: '等待核对', note: '' } }, randomUUID());
    const published = await http(['records',String(sent.recordId),'publish'], { expectedVersion: 2, audience: 'customer' }); assert.equal(published.status, 200);
    const pub = (await published.json()).data; assert.equal(pub.status, 'published');
    if (aid !== owners[0]) await assert.rejects(new SiteChatService({ enterpriseId: eids[1], adminId: aid }).read(pid));
  }
});
test('correction requires a new publication and room/source changes revoke the previous customer version', async () => {
  await edit(); const pub = await publish(); await privateChat.messages(cid);
  await edit(); assert.equal((await record()).published_version, null);
  await assert.rejects(withTenantTransaction(eids[0], async tx => customerSiteMedia(tx, customer, await new AssistantRepository(tx, customer).conversation(cid), rid, mediaId, Number(pub.version))));
  await publish(); const roomId = String((await record()).room_id);
  await act('room', { projectId: pid, expectedVersion: await pv(), roomId, name: '新书房' });
  assert.equal(await withTenantTransaction(eids[0], tx => publishedSiteRecord(tx, eids[0], customer.principal.kind === 'user' ? customer.principal.userId : '', rid)), undefined);
  await edit();
});
test('membership removal during a provider call prevents late draft writes and preserves measured usage', async () => {
  const sent = await site().send(pid, { text: '客厅等待设计师核对，暂未施工。', mediaIds: [] }, randomUUID()); const lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await processSiteRecord(lease!, async () => {
    await act('member', { projectId: pid, expectedVersion: await pv(), adminId: staffIds[0][0], role: 'worker', active: false, workLabel: '' });
    return output(String(((await boss().read(pid)).rooms as Row[])[0].id));
  });
  await assert.rejects(read()); await assert.rejects(site().media(pid, mediaId));
  const result = await withTenantTransaction(eids[0], tx => one(tx, sql`select r.status,(select count(*) from app.assistant_usage_records u where u.enterprise_id=r.enterprise_id and u.run_id=r.id) as usage from app.assistant_runs r where r.enterprise_id=${eids[0]} and id=${String(sent.runId)}`));
  assert.equal(result!.status, 'failed'); assert.equal(Number(result!.usage), 1);
  await act('member', { projectId: pid, expectedVersion: await pv(), adminId: staffIds[0][0], role: 'worker', active: true, workLabel: '' });
});
test('a provider outcome that is unknown is not dispatched again after a worker restart', async () => {
  const sent = await site().send(pid, { text: '现场补充，等待核对。', mediaIds: [] }, randomUUID()), lease = await claimJob(); assert.equal(lease?.runId, sent.runId);
  await markProviderStarted(lease!);
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()-interval '1 second' where enterprise_id=${eids[0]} and run_id=${String(sent.runId)}`));
  assert.equal(await claimJob(), null);
  const row = await withTenantTransaction(eids[0], tx => one(tx, sql`select status from app.assistant_runs where enterprise_id=${eids[0]} and id=${String(sent.runId)}`)); assert.equal(row!.status, 'indeterminate');
});
test('cancel survives private-chat human mode; no later publication is delivered from a cancelled watch', async () => {
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.assistant_conversations set mode='human' where enterprise_id=${eids[0]} and id=${cid}`));
  const result = await privateChat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '隔离一号工地不用再提醒' }] }, siteWatchInterceptor); assert.equal(result.runId, null);
  const active = await withTenantTransaction(eids[0], tx => one(tx, sql`select count(*) n from app.construction_watches where enterprise_id=${eids[0]} and active`)); assert.equal(Number(active!.n), 0);
  await withTenantTransaction(eids[0], tx => tx.execute(sql`update app.assistant_conversations set mode='ai' where enterprise_id=${eids[0]} and id=${cid}`));
});
test('six domain tables force tenant RLS and pure contracts reject invalid room IDs and non-direct watch language', async () => {
  const result = await withPlatformTransaction(tx => rows(tx, sql`select relrowsecurity,relforcerowsecurity from pg_class where relnamespace='app'::regnamespace and relname in ('construction_chats','construction_site_records','construction_site_media','construction_site_record_versions','construction_site_attachments','construction_watches')`));
  assert.equal(result.length, 6); assert.ok(result.every(r => r.relrowsecurity && r.relforcerowsecurity));
  assert.throws(() => parseSiteDraft(output('999999999').text, ['1']));
  assert.equal(siteWatchIntent('怎么取消关注？'), null);
});
test('configured real provider, private photo and durable Worker produce a reviewable draft without formal approvals', { skip: !live }, async () => {
  const photo = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#cac4b6' } }).jpeg().toBuffer();
  const media = await site().upload(pid, randomUUID(), photo);
  const sent = await site().send(pid, { text: '新书房线管今天已经铺好；底盒还没固定，等设计师来核对底盒位置。照片仅作现场资料，不代表已验收，也没有费用或工期批准。', mediaIds: [String(media.id)] }, randomUUID());
  const lease = await claimJob(); assert.equal(lease?.runId, sent.runId); await processSiteRecord(lease!);
  const r = await record(String(sent.recordId)); assert.equal(r.run_status, 'succeeded'); assert.equal(r.status, 'draft');
  assert.match((r.data as Row).pending as string, /底盒/); assert.doesNotMatch((r.data as Row).completed as string, /底盒.*(?:已固定|完成固定)/);
  assert.equal(r.audience, 'internal'); assert.equal(r.published_version, null);
});
