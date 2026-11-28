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
import { constructionWorkbench } from '@/lib/construction/workbench';
import { shanghaiToday } from '@/lib/construction/workbench-reports';
import { siteChatHttp } from '@/lib/construction/site-http';
import { processSiteRecord } from '@/lib/construction/site-worker';
import { AiProviderError } from '@/lib/ai/provider-types';
import { claimJob, markProviderStarted } from '@/lib/assistant/infrastructure/job-queue';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { customerSiteMedia, publishedSiteRecord, deliverSiteNotifications } from '@/lib/construction/site-publications';
import { queryBusiness, businessSnapshotAvailable } from '@/lib/assistant/agent/business-tools';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { signMiniProgramToken, verifyFamilyInvite } from '@/lib/miniprogram-jwt';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { GET, POST } from '@/app/api/miniprogram/construction/[[...path]]/route';
import { GET as adminGet, POST as adminPost } from '@/app/api/construction/[[...path]]/route';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { parseSiteDraft } from '@/lib/construction/site-contract';
import { siteWatchIntent } from '@/lib/construction/site-watches';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { ownerSiteHome, ownerSiteProgressPhoto } from '@/lib/construction/owner-home';
import { enqueueReport, ensureFollowupBinding } from '@/lib/construction/report-store';
import { deliverConstructionReports, processConstructionReport } from '@/lib/construction/report-worker';
import { getDefaultMenuKeys } from '@/lib/admin-user-roles';
import { SystemRoleRepository } from '@/db/repositories/system-role-repository';
import { CustomerProjectProgress } from '@/lib/construction/family-progress';

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
const signWorkerToken = () => signMiniProgramToken({ sub: workerUser, id: workerUser, mode: 'staff', role: 'construction_staff',
  staffRole: 'construction_staff', staffId: staffIds[0][0], enterpriseId: eids[0], contextVersion: 1, source: 'phone' });
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
    await new SystemRoleRepository(tx).ensureDefaults([
      { roleKey: 'designer', label: '设计师', menuKeys: getDefaultMenuKeys('designer') },
    ]);
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
  const token = await signWorkerToken();
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
  let calls = 0;
  await processSiteRecord(lease!, async messages => { calls++; assert.ok(JSON.stringify(messages).includes('image/jpeg'));
    const draft = output(String(room.id)); return { ...draft, text: '', finishReason: 'tool_calls',
      toolCalls: [{ id: 'synthetic-site-draft', name: 'final_response', arguments: draft.text }] }; });
  assert.equal(calls, 1);
  const provider = await withTenantTransaction(eids[0], tx => one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${eids[0]} and run_id=${String(sent.runId)} and step_seq=1100`));
  assert.equal(((provider!.private_checkpoint as Row).toolCalls as Row[])[0].name, 'final_response');
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
test('internal publication never opens the source chat or notifies the homeowner; workers cannot approve their own report', async () => {
  const version = (await record()).version;
  const token = await signWorkerToken();
  const path = ['projects', pid, 'chat', 'records', rid, 'publish'];
  for (const audience of ['internal', 'customer']) {
    const response = await POST(new NextRequest('http://localhost:3006/api/miniprogram/construction/' + path.join('/'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expectedVersion: version, audience }),
    }), { params: Promise.resolve({ path }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'construction_forbidden');
  }
  const pending = await record();
  assert.equal(pending.version, version);
  assert.equal(pending.status, 'draft');
  assert.equal(pending.approved_by, null);
  assert.equal(pending.published_version, null);
  const event = await withTenantTransaction(eids[0], tx => one(tx, sql`select id from app.domain_event_outbox
    where enterprise_id=${eids[0]} and type='construction.record.publish.v1' and aggregate_id=${rid}`));
  assert.ok(!event);
  const reviewer = site(0, 1), reviewBody = { expectedVersion: version, audience: 'internal' }, reviewKey = randomUUID();
  const approved = await reviewer.mutate(pid, rid, 'publish', reviewBody, reviewKey);
  assert.equal(String((await record()).approved_by), staffIds[0][1]);
  assert.deepEqual(await reviewer.mutate(pid, rid, 'publish', reviewBody, reviewKey), approved);
  assert.ok(!(await privateChat.messages(cid)).items.some((m: Row) => m.siteRecord));

  const membership = { projectId: pid, adminId: staffIds[0][1], active: true, workLabel: '' };
  await act('member', { ...membership, expectedVersion: await pv(), role: 'worker' });
  try {
    await assert.rejects(reviewer.mutate(pid, rid, 'publish', reviewBody, reviewKey),
      { code: 'construction_forbidden', status: 403 });
  } finally {
    await act('member', { ...membership, expectedVersion: await pv(), role: 'designer' });
  }
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
  assert.doesNotMatch(snapshot.displayText, new RegExp(`记录${rid}|版本\\d`));
  assert.ok(((snapshot.data as Row[])[0].records as Row[]).some(r => String(r.id) === rid && Number(r.version) === Number(result.version)));
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
test('manager returns require instructions; new-photo resubmissions retain the original chain and require manager review', async () => {
  const photo = async (color: string) => String((await site().upload(pid, randomUUID(), await sharp({ create: { width: 48, height: 40, channels: 3, background: color } }).png().toBuffer())).id);
  const firstPhoto = await photo('#124571');
  const sent = await site().send(pid, { text: '书房线管已铺好，底盒还未固定。', mediaIds: [firstPhoto] }, randomUUID());
  const originalId = String(sent.recordId);
  const get = (id: string) => withTenantTransaction(eids[0], tx => one(tx, sql`select * from app.construction_site_records where enterprise_id=${eids[0]} and id=${id}`));
  const firstData = { title: '书房进展', roomId: String(((await boss().read(pid)).rooms as Row[])[0].id), completed: '线管已铺好', pending: '底盒未固定', coordination: '', note: '' };
  await site().mutate(pid, originalId, 'edit', { expectedVersion: 1, data: firstData }, randomUUID());
  await boss().mutate(pid, originalId, 'publish', { expectedVersion: 2, audience: 'customer' }, randomUUID());
  let currentId = originalId;
  for (const [round, aid] of [owners[0], ...platformIds].entries()) {
    const manager = new SiteChatService({ enterpriseId: eids[0], adminId: aid });
    const expectedVersion = Number((await get(currentId))!.version);
    const requirements = `第${round + 1}次：请补拍书房底盒全景和固定位置近照，照片要能看清线管连接。`;
    const request = { expectedVersion, requirements };
    await assert.rejects(site().mutate(pid, currentId, 'request_changes', request, randomUUID()), { code: 'construction_forbidden' });
    await assert.rejects(manager.mutate(pid, currentId, 'request_changes', { expectedVersion, requirements: '   ' }, randomUUID()));
    await assert.rejects(site(0, 2).mutate(pid, currentId, 'request_changes', request, randomUUID()), { code: 'construction_forbidden' });
    const returnKey = randomUUID(), returned = await manager.mutate(pid, currentId, 'request_changes', request, returnKey);
    assert.deepEqual(await manager.mutate(pid, currentId, 'request_changes', request, returnKey), returned);
    assert.equal(returned.status, 'changes_requested');
    const outsideReportRange = { from: '2000-01-01', to: '2000-01-02' };
    const priority = await constructionWorkbench(actor(), 'construction_staff', pid, outsideReportRange);
    assert.equal('latestReturn' in priority && priority.latestReturn?.recordId, currentId);
    assert.equal('latestReturn' in priority && priority.latestReturn?.returnReason, requirements);
    assert.equal((await get(currentId))!.published_version, null);
    assert.equal(await withTenantTransaction(eids[0], tx => publishedSiteRecord(tx, eids[0], customer.principal.kind === 'user' ? customer.principal.userId : '', currentId)), undefined);
    await assert.rejects(site().mutate(pid, currentId, 'edit', { expectedVersion: returned.version, data: firstData }, randomUUID()), { code: 'site_rework_state_conflict' });
    await assert.rejects(manager.mutate(pid, currentId, 'publish', { expectedVersion: returned.version, audience: 'customer' }, randomUUID()), { code: 'site_rework_state_conflict' });
    await site(0, 1).send(pid, { text: '书房底盒待核对，帮我找对应图纸和需求', mediaIds: [] }, randomUUID());
    const reentry = await site().read(pid, undefined, 1);
    assert.ok((reentry.items as Row[]).some(i => (i.record as Row)?.id === currentId && (i.record as Row).canResubmit));
    assert.equal((await get(currentId))!.review_requirements, requirements);
    const empty = { expectedVersion: returned.version, text: '已按要求补拍。', mediaIds: [] };
    await assert.rejects(site().mutate(pid, currentId, 'resubmit', empty, randomUUID()), { code: 'site_rework_photos_required' });
    const duplicate = await photo('#124571');
    await assert.rejects(site().mutate(pid, currentId, 'resubmit', { ...empty, mediaIds: [duplicate] }, randomUUID()), { code: 'site_rework_photos_required' });
    await assert.rejects(site().mutate(otherPid, currentId, 'resubmit', empty, randomUUID()));
    await assert.rejects(site(1).mutate(pid, currentId, 'resubmit', empty, randomUUID()));
    const newPhoto = await photo(['#427511', '#327842', '#a47132'][round]);
    const body = { ...empty, mediaIds: [newPhoto] }, submitKey = randomUUID();
    await assert.rejects(site(0, 1).mutate(pid, currentId, 'resubmit', body, randomUUID()), { code: 'construction_forbidden' });
    await assert.rejects(site(0, 2).mutate(pid, currentId, 'resubmit', body, randomUUID()));
    await assert.rejects(site().mutate(pid, currentId, 'resubmit', { ...body, expectedVersion }, randomUUID()), { code: 'version_conflict' });
    const results = await Promise.allSettled([site().mutate(pid, currentId, 'resubmit', body, submitKey), site().mutate(pid, currentId, 'resubmit', body, randomUUID())]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    const result = results.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<Row>;
    const submitted = result.value;
    // Recover with the actual winning key, including a response lost by the client.
    if (results[0].status === 'fulfilled') assert.deepEqual(await site().mutate(pid, currentId, 'resubmit', body, submitKey), submitted);
    assert.equal(submitted.originalRecordId, originalId); assert.equal(submitted.resubmissionOfId, currentId);
    const nextPriority = await constructionWorkbench(actor(), 'construction_staff', pid, outsideReportRange);
    assert.notEqual('latestReturn' in nextPriority && nextPriority.latestReturn?.recordId, currentId);
    const childId = String(submitted.recordId), lease = await claimJob(); assert.equal(lease?.runId, submitted.runId);
    assert.equal(String((await get(childId))!.room_id), firstData.roomId);
    if (round === 0) {
      await processSiteRecord(lease!, async () => { throw new AiProviderError('Synthetic service unavailable', 'HTTP_503', 'safe_fallback', 503); });
      const failed = await get(childId); assert.equal(failed!.status, 'organizing');
      // Dispatched usage remains conservatively fenced until reconciled. Recovery
      // can use explicit manual review without issuing another provider request.
      await assert.rejects(site().mutate(pid, childId, 'retry', { expectedVersion: failed!.version }, randomUUID()), { code: 'site_retry_unavailable' });
      await site().mutate(pid, childId, 'edit', { expectedVersion: failed!.version, data: { ...firstData, note: '师傅核对补拍原件后人工整理，非模型成功。' } }, randomUUID());
    } else await processSiteRecord(lease!, async () => { const value = output(firstData.roomId), data = JSON.parse(value.text);
      if (round === 1) delete data.roomId; else data.roomId = null;
      return { ...value, text: JSON.stringify(data) }; });
    const child = (await get(childId))!;
    assert.equal(child.status, 'draft'); assert.equal(String(child.author_id), staffIds[0][0]);
    assert.equal(String(child.room_id), firstData.roomId);
    const visible = ((await site().read(pid)).items as Row[]).find(i => (i.record as Row)?.id === childId)!.record as Row;
    assert.equal(visible.canPublish, false); assert.equal(visible.review_requirements, requirements);
    assert.deepEqual((visible.media as Row[]).map(m => m.id), [newPhoto]);
    for (const audience of ['internal', 'customer']) {
      await assert.rejects(site().mutate(pid, childId, 'publish', { expectedVersion: child.version, audience }, randomUUID()),
        { code: 'construction_forbidden', status: 403 });
    }
    const pending = (await get(childId))!;
    assert.equal(pending.status, 'draft');
    assert.equal(pending.version, child.version);
    assert.equal(pending.approved_by, null);
    await manager.mutate(pid, childId, 'publish', { expectedVersion: child.version, audience: 'customer' }, randomUUID());
    const versions = (await manager.versions(pid, childId)).items as Row[];
    assert.ok(versions.some(v => (v.snapshot as Row).recordId === originalId));
    assert.ok(versions.some(v => v.action === 'request_changes' && (v.snapshot as Row).reviewRequirements === requirements));
    assert.ok(versions.some(v => (v.media_ids as string[]).includes(firstPhoto)));
    currentId = childId;
  }
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
test('a definitive provider rejection fails once while ambiguous dispatches remain fenced', async () => {
  const sent=await site().send(pid,{text:'合成现场资料，等待核对。',mediaIds:[]},randomUUID()),lease=await claimJob();
  assert.equal(lease?.runId,sent.runId);let calls=0;
  await processSiteRecord(lease!,async()=>{calls++;throw new AiProviderError('Synthetic protocol rejection','HTTP_400','safe_fallback',400);});
  const result=await withTenantTransaction(eids[0],tx=>one(tx,sql`select r.status,j.status job_status from app.assistant_runs r join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id where r.enterprise_id=${eids[0]} and r.id=${String(sent.runId)}`));
  assert.equal(calls,1);assert.equal(result!.status,'failed');assert.equal(result!.job_status,'failed');
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
test('worker workbench returns own report history with stage snapshot, nine photos and today summary', async () => {
  const mediaIds: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    mediaIds.push(String((await site().upload(pid, randomUUID(), await sharp({ create: { width: 24, height: 24, channels: 3, background: '#123456' } }).png().toBuffer())).id));
  }
  const sent = await site().send(pid, { text: '九张照片现场记录', mediaIds, capture: { kind: 'free' }, stageKeys: ['utilities'] }, randomUUID());
  const stored = await withTenantTransaction(eids[0], tx => one(tx, sql`select stage_snapshot from app.construction_site_records
    where enterprise_id=${eids[0]} and id=${sent.recordId}`));
  assert.deepEqual(stored!.stage_snapshot, [{ key: 'utilities', name: '水电' }]);
  const today = shanghaiToday();
  const data = await constructionWorkbench(actor(), 'construction_staff', pid, { from: today, to: today }) as {
    reports: { items: Row[] }; todaySummary: Row;
  };
  const history = data.reports.items.find(item => String(item.recordId) === String(sent.recordId))!;
  assert.ok(history);
  assert.equal(history.photoCount, 9);
  assert.equal(history.status, 'pending');
  assert.deepEqual(history.stages, [{ key: 'utilities', name: '水电' }]);
  assert.ok(Number(data.todaySummary.total) >= 1);
  const past = await constructionWorkbench(actor(), 'construction_staff', pid, { from: '2000-01-01', to: '2000-01-02' }) as { reports: { items: Row[] } };
  assert.equal(past.reports.items.some(item => String(item.recordId) === String(sent.recordId)), false);
});

test('six domain tables force tenant RLS and pure contracts reject invalid room IDs and non-direct watch language', async () => {
  const result = await withPlatformTransaction(tx => rows(tx, sql`select relrowsecurity,relforcerowsecurity from pg_class where relnamespace='app'::regnamespace and relname in ('construction_chats','construction_site_records','construction_site_media','construction_site_record_versions','construction_site_attachments','construction_watches')`));
  assert.equal(result.length, 6); assert.ok(result.every(r => r.relrowsecurity && r.relforcerowsecurity));
  assert.throws(() => parseSiteDraft(output('999999999').text, ['1']));
  assert.equal(siteWatchIntent('怎么取消关注？'), null);
});

test('manager progress is published once to the confirmed owner and tracks the actual daily and weekly versions', async () => {
  const enterpriseId = eids[0];
  const userId = customer.principal.kind === 'user' ? customer.principal.userId : '';
  assert.ok(userId);
  const identity = { userId, contextVersion: 1 };
  const create = { leadId: lid, name: '合成 · 负责人发布', managerId: staffIds[0][1], rooms: ['厨房'], stageKey: 'utilities', customerAccess: true };
  const createKey = randomUUID();
  const created = await owner.execute('create', create, createKey);
  assert.deepEqual(await owner.execute('create', create, createKey), created);
  const projectId = String(created.id);
  const detail = (await owner.execute('detail', { projectId })).project as Row;
  assert.equal(detail.current_stage_key, 'utilities');
  assert.equal(detail.customer_access, true);
  const denied = await act('create', { ...create, name: '合成 · 未开通查看', customerAccess: false });
  await assert.rejects(ownerSiteHome(identity, String(denied.id)), /construction_not_found/);
  await assert.rejects(act('create', { ...create, stageKey: 'invalid_stage' }), /construction_stage_unavailable/);
  await act('member', { projectId, expectedVersion: Number(detail.version), adminId: staffIds[0][0], role: 'worker', active: true, workLabel: '' });

  const manager = site(0, 1);
  const board = await constructionWorkbench(actor(0, 1), 'designer', projectId) as Row;
  assert.equal(board.view, 'manager');
  assert.equal(board.canCapture, true);
  const target = String((board.project as Row).publicationTarget);
  const text = '厨房线管铺好了，明天核对底盒位置。';
  const body = { text, mediaIds: [] as string[], stageKeys: ['utilities'], capture: { kind: 'manager', target } };
  await assert.rejects(site().send(projectId, body, randomUUID()), /construction_forbidden/);
  await assert.rejects(manager.send(projectId, { ...body, capture: { kind: 'manager', target: fingerprint('旧业主') } }, randomUUID()),
    /site_publication_target_changed/);
  const photo = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#a69376' } }).jpeg().toBuffer();
  body.mediaIds = [String((await manager.upload(projectId, randomUUID(), photo)).id)];
  const requestKey = randomUUID();
  const sent = await manager.send(projectId, body, requestKey) as Row;
  assert.equal(sent.organizationStatus, 'published');
  assert.equal(sent.runId, null);
  assert.deepEqual(await manager.send(projectId, body, requestKey), sent);
  assert.deepEqual(await manager.operation(projectId, requestKey), { found: true, result: sent });
  const recordId = String(sent.recordId), [mediaId] = body.mediaIds;
  const readReceipt = async () => ((((await manager.reviewRecord(projectId, recordId)).items as Row[])[0].record as Row).publicationReceipt);
  assert.deepEqual(await readReceipt(), { ownerReadable: true, daily: 'not_enabled', weekly: 'not_enabled' });
  const reopened = await ownerSiteHome(identity, projectId);
  assert.equal(reopened.latestProgress?.recordId, recordId);
  assert.equal(reopened.latestProgress?.text, text);
  assert.equal(reopened.latestProgress?.mediaId, mediaId);
  assert.equal((await ownerSiteProgressPhoto(identity, projectId, recordId, 2, mediaId)).mime, 'image/jpeg');
  await assert.rejects(ownerSiteProgressPhoto(identity, projectId, recordId, 1, mediaId), /construction_not_found/);
  const familyId = uids[2];
  const family = new CustomerProjectProgress({ ...customer, principal: { kind: 'user', userId: familyId } });
  await assert.rejects(family.read(projectId), /construction_not_found/);
  const invite = await verifyFamilyInvite((await new CustomerProjectProgress(customer).invite(projectId)).token);
  assert.ok(invite);
  await family.acceptInvite(invite);
  assert.equal((await family.read(projectId)).latestProgressText, text);
  await assert.rejects(ownerSiteProgressPhoto({ userId: familyId, contextVersion: 1 }, projectId, recordId, 2, mediaId), /construction_not_found/);

  await withTenantTransaction(enterpriseId, tx => tx.execute(sql`insert into app.construction_report_settings
    (enterprise_id,enabled,next_daily_at,next_weekly_at,audiences,project_ids)
    values(${enterpriseId},true,now()+interval '1 day',now()+interval '7 days','["customer"]'::jsonb,${JSON.stringify([projectId])}::jsonb)`));
  assert.deepEqual(await readReceipt(), { ownerReadable: true, daily: 'pending', weekly: 'pending' });
  for (const kind of ['daily', 'weekly'] as const) {
    const queued = await withTenantTransaction(enterpriseId, async tx => {
      const binding = await ensureFollowupBinding(tx, enterpriseId, { kind: 'user', id: userId, audience: 'customer', projectId });
      const settings = (await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${enterpriseId}`))!;
      const end = new Date(Date.now() + 1000);
      const start = new Date(end.getTime() - (kind === 'daily' ? 1 : 7) * 86400000);
      return enqueueReport(tx, enterpriseId, binding, settings, { kind, start, end, cutoff: end, scheduledAt: end });
    });
    assert.ok(queued);
    const lease = await claimJob({ enterpriseId, runId: queued.runId });
    assert.ok(lease);
    await processConstructionReport(lease);
    await deliverConstructionReports(enterpriseId);
    assert.deepEqual(await readReceipt(), { ownerReadable: true, daily: 'generated', weekly: kind === 'daily' ? 'pending' : 'generated' });
  }
  const stages = await owner.execute('stages');
  await act('saveStages', { expectedVersion: stages.version, stages: (stages.stages as Row[]).map(stage =>
    stage.key === 'utilities' ? { ...stage, inspectionCheckpoints: [{ key: 'seal_review', name: '封槽前到场核对' }] } : stage) });
  const required = await manager.send(projectId, { ...body, mediaIds: [], text: '封槽前请到场核对。',
    inspectionCheckpoint: { stageKey: 'utilities', key: 'seal_review' } }, randomUUID()) as Row;
  assert.equal(required.organizationStatus, 'draft');
  await assert.rejects(manager.mutate(projectId, String(required.recordId), 'publish',
    { expectedVersion: 1, audience: 'customer' }, randomUUID()), /inspection_pin_missing|inspection_proof_required/);
  assert.equal((await ownerSiteHome(identity, projectId)).latestProgress?.recordId, recordId);
  const current = (await owner.execute('detail', { projectId })).project as Row;
  await act('update', { projectId, expectedVersion: Number(current.version), name: create.name, status: 'active', customerAccess: false });
  await assert.rejects(ownerSiteHome(identity, projectId), /construction_not_found/);
  await assert.rejects(ownerSiteProgressPhoto(identity, projectId, recordId, 2, mediaId), /construction_not_found/);
  await assert.rejects(family.read(projectId), /construction_not_found/);
  assert.deepEqual(await readReceipt(), { ownerReadable: false, daily: 'not_enabled', weekly: 'not_enabled' });
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
