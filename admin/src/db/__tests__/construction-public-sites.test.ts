import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { SiteChatService } from '@/lib/construction/site-chat';
import { PublicMaterialService } from '@/lib/construction/public-service';
import { PublicCustomerService } from '@/lib/construction/public-customer';
import { PublicSiteCatalog } from '@/lib/construction/public-read';
import { publicCatalogHttp } from '@/lib/construction/public-http';
import { deliverPublicConsents, publicContextAvailable } from '@/lib/construction/public-projections';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { POST as adminPost, GET as adminGet } from '@/app/api/construction/[[...path]]/route';
import type { ActorContext } from '@/lib/assistant/contracts';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { entryContext } from '@/lib/assistant/application/auth';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';

const prefix = 'public-site-' + randomUUID(), eids: string[] = [], aids: string[] = [], uids: string[] = [], platformIds: string[] = [];
const live = process.env.CONSTRUCTION_LIVE_MODEL === '1';
let priorProvider: Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>> | undefined;
let pid: string, pid2: string, lid: string, rid: string, mediaId: string, cid: string, visitorCid: string, designer: string;
let owner: ConstructionService, shared: SiteChatService, materials: PublicMaterialService, catalog: PublicSiteCatalog;
let customer: ActorContext, visitor: ActorContext, chat: ConversationService, decisions: PublicCustomerService, state: Row;
const args = () => ({ versionId: state.versionId, expectedRevision: state.revision });
const act = (action: string, body = args()) => materials.mutate(pid, action, body, randomUUID());
async function draft(name = '春和苑 · 水电阶段') {
  const view = await materials.read(pid), source = (view.sourceItems as Row[]).find(s => s.id === rid)!;
  return materials.save(pid, { expectedRevision: view.revision, material: { name, cityCode: '420500', district: '伍家岗区',
    sources: [{ kind: source.kind, id: source.id, sourceHash: source.sourceHash, text: source.text }],
    photos: [{ recordId: rid, mediaId, masks: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] }] } }, randomUUID());
}
async function approve(projectId = pid, service = materials) {
  const view = await service.read(projectId), material = view.material as Row;
  let result = await service.mutate(projectId, 'submit', { versionId: material.versionId, expectedRevision: view.revision }, randomUUID());
  result = await decisions.decide(String(result.id), 'preview', { versionId: result.versionId, expectedRevision: result.revision }, randomUUID());
  return decisions.decide(String(result.id), 'approve', { versionId: result.versionId, expectedRevision: result.revision }, randomUUID());
}
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  if(live){
    const primary=new URL(process.env.CONSTRUCTION_PRIMARY_DATABASE_URL||'');assert.equal(primary.port,'5432');assert.equal(primary.pathname,'/smart_floor_planner');assert.ok(['localhost','127.0.0.1'].includes(primary.hostname));
    const evaluation=process.env.DATABASE_URL;await closePostgresPool();let provider:Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try{process.env.DATABASE_URL=primary.toString();provider=await getPlatformLlmRuntimeConfig();}finally{await closePostgresPool();process.env.DATABASE_URL=evaluation;}
    assert.equal(provider.providerKey,'deepseek');assert.equal(new URL(provider.baseUrl).origin,'https://api.deepseek.com');priorProvider=await getPlatformLlmRuntimeConfig();
    await savePlatformLlmConfig({enabled:true,providerKey:'deepseek',baseUrl:provider.baseUrl,model:provider.model,apiKey:provider.apiKey});
  }
  await withPlatformTransaction(async tx => {
    for (let n = 0; n < 2; n++) {
      eids.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+n},${prefix+n},'active') returning id`))!.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eids[n]},true,100,10000000,100000000,30)`);
      await tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify({runtime:'langgraph-v1',model:live?'deepseek-flash':'Qwen/Qwen3.5-4B',providerKey:live?'deepseek':'siliconflow',imageInput:true,tools:true,probeVersion:'p4b-public-context-v1'})}::jsonb where enterprise_id=${eids[n]}`);
      aids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${eids[n]},${prefix+n},'test-only','enterprise_admin','active',false,'隔离负责人') returning id`))!.id));
    }
    for (const role of ['admin','super_admin']) platformIds.push(String((await one(tx, sql`insert into app.admin_users(username,password_hash,role,status,must_change_password) values(${prefix+role},'test-only',${role},'active',false) returning id`))!.id));
    designer = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${eids[0]},${prefix+'designer'},'test-only','designer','active',false,'隔离设计师') returning id`))!.id); aids.push(designer);
    for (const label of ['owner','visitor']) uids.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+label},1) returning id`))!.id));
    lid = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eids[0]},${uids[0]},'私有业主姓名','13980001234','natural') returning id`))!.id);
  });
  customer = { enterpriseId: eids[0], principal: { kind: 'user', userId: uids[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: lid } };
  visitor = { ...customer, principal: { kind: 'user', userId: uids[1] }, entry: { kind: 'identity' } };
  owner = new ConstructionService({ enterpriseId: eids[0], adminId: aids[0] });
  for (const name of ['私有业主原项目名','第二工地']) {
    const projectId = String((await owner.execute('create', { leadId: lid, name, managerId: aids[0], rooms: [] }, randomUUID())).id);
    if (!pid) pid = projectId; else pid2 = projectId;
    await owner.execute('member', { projectId, expectedVersion: 1, adminId: designer, role: 'designer', active: true, workLabel: '' }, randomUUID());
  }
  shared = new SiteChatService({ enterpriseId: eids[0], adminId: aids[0] }); materials = new PublicMaterialService({ enterpriseId: eids[0], adminId: aids[0] }); catalog = new PublicSiteCatalog(eids[0]);
  const image = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#eac478' } }).png().toBuffer();
  mediaId = String((await shared.upload(pid, randomUUID(), image)).id);
  rid = String((await shared.send(pid, { text: '客厅线管已铺好，底盒未固定，等设计师核对。', mediaIds: [mediaId] }, randomUUID())).recordId);
  await shared.mutate(pid, rid, 'edit', { expectedVersion: 1, data: { title: '水电预留核对', roomId: null, completed: '线管已铺好', pending: '底盒未固定', coordination: '请设计师核对点位', note: '' } }, randomUUID());
  await shared.mutate(pid, rid, 'publish', { expectedVersion: 2, audience: 'customer' }, randomUUID());
  chat = new ConversationService(customer); cid = String((await chat.create(randomUUID())).id); decisions = new PublicCustomerService(customer, cid);
  visitorCid = String((await new ConversationService(visitor).create(randomUUID())).id);
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const eid of eids) { await deleteConstructionData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.leads where enterprise_id=${eid}`); }
    for (const aid of [...aids, ...platformIds]) await tx.execute(sql`delete from app.admin_users where id=${aid}`);
    for (const uid of uids) await tx.execute(sql`delete from app.users where id=${uid}`);
    for (const eid of eids) await tx.execute(sql`delete from app.enterprises where id=${eid}`);
  }); } finally { try{if(priorProvider)await savePlatformLlmConfig(priorProvider);}finally{await closePostgresPool();} }
});
test('originals stay private; tenant/visitor isolation and independent masked immutable drafts', async () => {
  assert.deepEqual((await catalog.list()).items, []); await assert.rejects(new PublicMaterialService({ enterpriseId: eids[1], adminId: aids[1] }).read(pid));
  assert.throws(() => new PublicCustomerService({ ...customer, principal: { kind: 'admin', adminId: aids[0] } }, cid));
  state = await draft(); const view = await materials.read(pid), m = view.material as Row;
  assert.equal(state.status, 'draft'); assert.deepEqual((await catalog.list()).items, []);
  const media = await materials.media(pid, String((m.photos as Row[])[0].id), String(state.versionId));
  assert.equal((await sharp(media.data).metadata()).exif, undefined);
  const pixel = await sharp(media.data).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer(); assert.ok(pixel[0] < 50 && pixel[1] < 50);
  assert.notDeepEqual(media.data, (await shared.media(pid, mediaId)).data);
  await assert.rejects(withTenantTransaction(eids[0], tx => tx.execute(sql`update app.construction_public_versions set content='{}' where enterprise_id=${eids[0]} and id=${String(state.versionId)}`)));
});
test('offline outbox/reentry deduplicate a version-bound owner card and deny approval before full preview', async () => {
  state = await act('submit'); assert.equal(await deliverPublicConsents(), 1); assert.equal(await deliverPublicConsents(), 0);
  const cards = (await chat.messages(cid)).items.filter(m => m.publicConsent); assert.equal(cards.length, 1); assert.equal((cards[0].publicConsent as Row).versionId, state.versionId);
  await assert.rejects(new PublicCustomerService(visitor, visitorCid).consent(String(state.id), String(state.versionId)));
  await assert.rejects(new PublicCustomerService(customer, visitorCid).consent(String(state.id), String(state.versionId)));
  await assert.rejects(decisions.decide(String(state.id), 'approve', args(), randomUUID()), /public_preview_required/); await assert.rejects(act('publish'), /public_consent_required/);
  state = await decisions.decide(String(state.id), 'preview', args(), randomUUID()); const input = args(), requestKey = randomUUID();
  state = await decisions.decide(String(state.id), 'approve', input, requestKey); assert.deepEqual(await decisions.decide(String(state.id), 'approve', input, requestKey), state);
  assert.deepEqual((await catalog.list()).items, []);
});
test('all three management roles publish through real cookie APIs within the selected enterprise', async () => {
  for (let i = 0; i < 3; i++) {
    if (i) { state = await draft(); state = await approve(); }
    const aid = i ? platformIds[i - 1] : aids[0], role = ['enterprise_admin','admin','super_admin'][i];
    const token = await new SignJWT({ id: aid, role, enterpriseId: i ? null : eids[0], permissions: ['construction-projects'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const path = ['projects', pid, 'public-materials'], headers = { cookie: 'auth_token=' + token + (i ? '; global_tenant_id=' + eids[0] : ''), 'Idempotency-Key': randomUUID() };
    assert.equal((await adminGet(new NextRequest('http://localhost:3006/api/construction/' + path.join('/'), { headers }), { params: Promise.resolve({ path }) })).status, 200);
    const response = await adminPost(new NextRequest('http://localhost:3006/api/construction/' + path.join('/') + '/publish', { method: 'POST', headers, body: JSON.stringify(args()) }), { params: Promise.resolve({ path: [...path, 'publish'] }) });
    assert.equal(response.status, 200, await response.clone().text()); state = (await response.json()).data;
  }
});
test('public company entry resumes only the visitor own unambiguous consultation and rejects mixed identity bases', async()=>{
  const entry=await entryContext({userId:uids[1],contextVersion:1,enterpriseId:undefined},{publicEnterpriseId:eids[0]});assert.equal(entry.resumeConversationId,visitorCid);assert.equal(entry.enterprise.id,eids[0]);
  await assert.rejects(entryContext({userId:uids[1],contextVersion:1,enterpriseId:undefined},{publicEnterpriseId:eids[0],leadId:lid}),/entry_context_invalid/);
  await assert.rejects(entryContext({userId:uids[1],contextVersion:0,enterpriseId:undefined},{publicEnterpriseId:eids[0]}));
});

test('durable Agent uses only the current public copy, persists source chips and never acquires publication tools',async()=>{
  const service=new PublicCustomerService(visitor,visitorCid);await service.context(String(state.id),{versionId:state.versionId},randomUUID());
  const sent=await new ConversationService(visitor).send(visitorCid,randomUUID(),{version:1,blocks:[{type:'text',text:'围观这个工地，底盒是已经固定了吗？'}]});const lease=await claimJob();assert.equal(lease?.runId,sent.runId);
  await processAgentAnswer(lease!,live?{}:{model:async(messages,tools)=>{
    const prompt=JSON.stringify(messages);assert.match(prompt,/底盒未固定/);assert.doesNotMatch(prompt,/13980001234|私有业主姓名|私有业主原项目名/);
    assert.ok(!tools.some(t=>/publish|consent|public_material/.test(t.name)));
    return {text:JSON.stringify({kind:'general',text:'公开节选写的是底盒未固定，需要设计师核对点位。'}),toolCalls:[],usage:{inputTokens:100,outputTokens:30},finishReason:'stop',providerRequestId:null};
  }});
  assert.equal((await new ConversationService(visitor).run(String(sent.runId))).status,'succeeded');
  const answer=(await new ConversationService(visitor).messages(visitorCid)).items.find(m=>m.authorKind==='assistant');assert.ok(answer);assert.equal((answer.publicReferences as Row[])[0].id,state.id);
});

test('anonymous APIs expose only public copies; visitor consultation remains independent and withdrawal revokes links/media/context', async () => {
  const detail = await catalog.detail(String(state.id), String(state.versionId)); assert.equal(detail.name, '春和苑 · 水电阶段');
  assert.doesNotMatch(JSON.stringify(detail), /私有业主姓名|13980001234|私有业主原项目名|customerId|projectId|sourceHash|conversationId/);
  const response = await publicCatalogHttp(new Request('http://localhost:3006/api/public/construction/' + eids[0] + '/sites/' + state.id), eids[0], ['sites', String(state.id)]);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); await assert.rejects(new PublicSiteCatalog(eids[1]).detail(String(state.id)));
  const media = await catalog.media(String(state.id), String(state.versionId), detail.photos[0].id); assert.equal(media.data[0], 0xff);
  await new PublicCustomerService(visitor, visitorCid).context(String(state.id), { versionId: state.versionId }, randomUUID());
  assert.ok((await new ConversationService(visitor).messages(visitorCid)).items.some(m => m.publicContext)); await assert.rejects(new ConversationService(visitor).detail(cid));
  const old = { siteId: String(state.id), versionId: String(state.versionId) }; state = await decisions.decide(old.siteId, 'withdraw', args(), randomUUID());
  await assert.rejects(catalog.detail(old.siteId, old.versionId)); await assert.rejects(catalog.media(old.siteId, old.versionId, detail.photos[0].id));
  assert.deepEqual((await catalog.list()).items, []); assert.ok((await new ConversationService(visitor).messages(visitorCid)).items.some(m => m.available === false));
  assert.equal(await withTenantTransaction(eids[0], tx => publicContextAvailable(tx, eids[0], old)), false);
});
test('new versions never inherit consent, retries retain their exact body, and simultaneous edits conflict', async () => {
  const oldVersion = state.versionId; state = await draft('春和苑 · 现场进展'); assert.notEqual(state.versionId, oldVersion); await assert.rejects(act('publish'));
  await assert.rejects(decisions.decide(String(state.id), 'approve', { ...args(), versionId: oldVersion }, randomUUID()));
  const view = await materials.read(pid), m = view.material as Row;
  const body = { expectedRevision: state.revision, material: { name: m.name, cityCode: m.cityCode, district: m.district, sources: m.sources, photos: (m.draftPhotos as Row[]).map(p => ({ recordId: p.recordId, mediaId: p.mediaId, masks: p.masks })) } };
  const k = randomUUID(); state = await materials.save(pid, body, k); assert.deepEqual(await materials.save(pid, body, k), state); await assert.rejects(materials.save(pid, { ...body, expectedRevision: 999 }, k), /idempotency_conflict/);
  const results = await Promise.allSettled([materials.save(pid, { ...body, expectedRevision: state.revision }, randomUUID()), materials.save(pid, { ...body, expectedRevision: state.revision }, randomUUID())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); state = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Row>).value;
  state = await approve(); state = await act('publish'); const photo = (await catalog.detail(String(state.id))).photos[0].id;
  await shared.mutate(pid, rid, 'withdraw', { expectedVersion: 3, reason: '需重新核对' }, randomUUID());
  assert.deepEqual((await catalog.list()).items, []); await assert.rejects(catalog.media(String(state.id), String(state.versionId), photo));
  assert.equal((await materials.mutate(pid, 'withdraw', { ...args(), reason: '来源已失效' }, randomUUID())).status, 'withdrawn');
});
test('private excerpts require active reception; unapproved private drafts do not grant project-manager access', async () => {
  await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我想预留洗碗机，联系电话13980001234。' }] });
  await new HandoffService(customer).customerWrite(cid, randomUUID(), { action: 'request', recipientId: designer, contactConsent: false });
  const staffActor: ActorContext = { enterpriseId: eids[0], principal: { kind: 'admin', adminId: designer }, contextVersion: 1, capabilities: ['assistant.handoff.staff'] };
  await new HandoffService(staffActor).staffWrite(cid, randomUUID(), { action: 'claim', expectedVersion: Number((await chat.detail(cid)).version) });
  const service = new PublicMaterialService({ enterpriseId: eids[0], adminId: designer }), view = await service.read(pid2);
  const source = (view.sourceItems as Row[]).find(s => s.kind === 'consultation_message' && String(s.text).includes('13980001234'))!; assert.ok(source);
  const input = { expectedRevision: 0, material: { name: '春和苑 · 服务节选', cityCode: '420500', district: '伍家岗区', sources: [{ kind: source.kind, id: source.id, sourceHash: source.sourceHash, text: '我想预留洗碗机，联系电话[已隐藏]。' }], photos: [] } };
  await assert.rejects(async () => service.save(pid2, { ...input, material: { ...input.material, sources: [{ ...input.material.sources[0], text: source.text }] } }, randomUUID()), /public_material_sensitive/);
  const saved = await service.save(pid2, input, randomUUID()), managerView = await materials.read(pid2); assert.equal(managerView.material, null); assert.doesNotMatch(JSON.stringify(managerView), /13980001234|我想预留洗碗机/);
  const approved = await approve(pid2, service); assert.equal(approved.id, saved.id); assert.ok((await materials.read(pid2)).material);
  await materials.mutate(pid2, 'publish', { versionId: approved.versionId, expectedRevision: approved.revision }, randomUUID()); assert.doesNotMatch(JSON.stringify(await catalog.detail(String(saved.id))), /13980001234/);
  await new HandoffService(customer).customerWrite(cid, randomUUID(), { action: 'end' }); const next = await service.read(pid2);
  assert.equal((next.sourceItems as Row[]).some(s => s.kind === 'consultation_message'), false); await assert.rejects(service.save(pid2, { ...input, expectedRevision: next.revision }, randomUUID()), /construction_forbidden/);
});
test('revoked public sources cannot be recovered through old preview or approval receipts, while withdrawal can reconcile', async () => {
  const projectId = String((await owner.execute('create', { leadId: lid, name: '隔离测试 · 公开回执来源撤回', managerId: aids[0], rooms: [] }, randomUUID())).id);
  const recordId = String((await shared.send(projectId, { text: '测试原文：书房底盒待核对。', mediaIds: [] }, randomUUID())).recordId);
  const edited = await shared.mutate(projectId, recordId, 'edit', { expectedVersion: 1, data: { title: '测试回执撤回', roomId: null, completed: '', pending: '底盒待核对', coordination: '', note: '' } }, randomUUID());
  const record = await shared.mutate(projectId, recordId, 'publish', { expectedVersion: edited.version, audience: 'customer' }, randomUUID());
  const view = await materials.read(projectId), source = (view.sourceItems as Row[]).find(s => s.id === recordId)!;
  let result = await materials.save(projectId, { expectedRevision: 0, material: { name: '测试专用 · 公开回执', cityCode: '420500', district: '伍家岗区',
    sources: [{ kind: source.kind, id: source.id, sourceHash: source.sourceHash, text: source.text }], photos: [] } }, randomUUID());
  const siteId = String(result.id), versionId = String(result.versionId);
  result = await materials.mutate(projectId, 'submit', { versionId, expectedRevision: result.revision }, randomUUID());
  const previewInput = { versionId, expectedRevision: result.revision }, previewKey = randomUUID();
  result = await decisions.decide(siteId, 'preview', previewInput, previewKey);
  const approveInput = { versionId, expectedRevision: result.revision }, approveKey = randomUUID();
  result = await decisions.decide(siteId, 'approve', approveInput, approveKey);
  await shared.mutate(projectId, recordId, 'withdraw', { expectedVersion: record.version, reason: '测试来源撤回' }, randomUUID());
  assert.equal((await decisions.consent(siteId, versionId)).available, false);
  const replays = await Promise.allSettled([
    decisions.decide(siteId, 'preview', previewInput, previewKey),
    decisions.decide(siteId, 'approve', approveInput, approveKey),
  ]);
  assert.deepEqual(replays.map(r => r.status), ['rejected', 'rejected']);
  for (const replay of replays) assert.match((replay as PromiseRejectedResult).reason.message, /public_source_unavailable/);
  const withdrawalInput = { versionId, expectedRevision: result.revision }, withdrawalKey = randomUUID();
  const withdrawn = await decisions.decide(siteId, 'withdraw', withdrawalInput, withdrawalKey);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual(await decisions.decide(siteId, 'withdraw', withdrawalInput, withdrawalKey), withdrawn);
});

test('new tables enforce RLS, stale identities cannot decide, and tenant cleanup removes the whole public projection', async () => {
  const tables = ['construction_public_sites','construction_public_versions','construction_public_sources','construction_public_media','construction_public_audits'];
  const policies = await withPlatformTransaction(tx => rows(tx, sql`select relrowsecurity,relforcerowsecurity from pg_class where relnamespace='app'::regnamespace and relname in (${sql.join(tables.map(t => sql`${t}`), sql`,`)})`));
  assert.equal(policies.length, 5); assert.ok(policies.every(p => p.relrowsecurity && p.relforcerowsecurity));
  await withTenantTransaction(eids[1], async tx => { for (const t of tables) assert.equal(Number((await one(tx, sql`select count(*) n from ${sql.raw('app.' + t)}`))!.n), 0); });
  await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=2 where id=${uids[0]}`)); await assert.rejects(decisions.consent(String(state.id), String(state.versionId)), /identity_context_invalid/);
  await withPlatformTransaction(async tx => { await deleteConstructionData(tx, BigInt(eids[0])); for (const t of tables) assert.equal(Number((await one(tx, sql`select count(*) n from ${sql.raw('app.' + t)} where enterprise_id=${eids[0]}`))!.n), 0); });
});
