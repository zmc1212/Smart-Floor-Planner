import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { reviewCheckpointer } from '@/lib/assistant/core/review-graph';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';

const prefix = 'synthetic-d3-contact-' + randomUUID();
const fixture = { enterprises: [] as string[], users: [] as string[], staff: [] as string[], conversations: [] as string[], works: [] as Array<{ id: string; versionId: string; assetId: string; authorId: string }>, leadId: '' };
const report = { scope: 'D3 direct portfolio contact compatibility with existing review graph; real isolated HTTP/auth/publication/checkpoints; no model/native acceptance',
  started: new Date().toISOString(), fixture, checks: [] as string[], providerAttempts: 0, externalFetchRequests: 0, cleaned: false };
const originalFetch = globalThis.fetch, originalRollout = process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS;
let actor: ActorContext, owner: PortfolioService, author: PortfolioService;
const save = () => { if (process.env.ASSISTANT_PORTFOLIO_CONTACT_EVIDENCE) fs.writeFileSync(path.join(process.env.ASSISTANT_PORTFOLIO_CONTACT_EVIDENCE, 'portfolio-contact-service.json'), JSON.stringify(report, null, 2)); };
const op = (service: PortfolioService, action: string, input: Row) => service.execute(action, input, randomUUID());
const customer = (index = 0): ActorContext => ({ enterpriseId: fixture.enterprises[0], principal: { kind: 'user', userId: fixture.users[index] }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
async function request(parts: string[], method = 'GET', body?: Row, key = randomUUID(), userIndex = 0) {
  const userId = fixture.users[userIndex];
  const token = await signMiniProgramToken({ sub: userId, id: userId, contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  return assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + parts.join('/'), {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), parts);
}
async function sourceConversation(kind: 'share' | 'company' = 'share', userIndex = 0) {
  const base = String((await new ConversationService(customer(userIndex)).create(randomUUID())).id); fixture.conversations.push(base);
  const share = await new PortfolioCatalog(customer(userIndex), base).share(fixture.works[0].id, fixture.works[0].versionId);
  const response = await request(['entry-context'], 'POST', kind === 'share' ? { portfolioEntry: share.token } : { publicEnterpriseId: actor.enterpriseId }, randomUUID(), userIndex);
  assert.equal(response.status, 200); const entry = (await response.json()).data as Row;
  const created = await request(['conversations'], 'POST', { entryToken: entry.entryToken }, randomUUID(), userIndex);
  assert.equal(created.status, 200); const id = String((await created.json()).data.id); fixture.conversations.push(id);
  const stored = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${id}`));
  assert.equal((stored!.entry_snapshot as Row).requirementReviewMode, true, 'ordinary signed entry must bind the authorized development rollout');
  return id;
}
async function publishWork(title: string, service = author, authorId = fixture.staff[1]) {
  const created = await op(service, 'create', { content: { title } }), workId = String(created.id);
  const imageBase64 = (await sharp({ create: { width: 80, height: 60, channels: 3, background: '#d8dfd5' } }).png().toBuffer()).toString('base64');
  const asset = await op(service, 'upload', { workId, expectedVersion: 1, imageBase64 });
  const content = { title, description: '合成厨房收纳和动线参考', primaryStyle: '原木风', secondaryStyles: [], cityCode: '330100', cityName: '杭州市', district: '',
    authorRole: '主创设计', source: 'SYNTHETIC TEST ONLY', authorization: '合成作者授权本隔离测试展示', showOnProfile: true,
    images: [{ assetId: String(asset.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '合成效果图' }], coverAssetId: String(asset.assetId) };
  await op(service, 'save', { workId, expectedVersion: 1, content }); await op(service, 'submit', { workId, expectedVersion: 2 });
  await op(owner, 'publish', { workId, expectedVersion: 3 });
  const detail = await op(service, 'detail', { workId });
  return { id: workId, versionId: String((detail.work as Row).published_version_id), assetId: String(asset.assetId), authorId };
}

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname)); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  globalThis.fetch = async () => { report.externalFetchRequests++; throw Error('D3 contact acceptance forbids external calls'); };
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${'测试专用D3接待' + i},${prefix + i},'active') returning id`))!.id); fixture.enterprises.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,12000000,100000000,30,'{"runtime":"langgraph-v1","providerKey":"synthetic-no-dispatch","model":"synthetic-no-dispatch","tools":true,"imageInput":false,"probeVersion":"d3-contact"}'::jsonb)`);
    }
    for (let i = 0; i < 3; i++) {
      const uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id); fixture.users.push(uid);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix + i})`);
      const role = i === 0 ? 'enterprise_admin' : 'designer';
      const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${fixture.enterprises[0]},${prefix + '-staff' + i},'unusable-synthetic',${role},'active',false,${'合成设计师' + i}) returning id`))!.id); fixture.staff.push(aid);
    }
    fixture.leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,assigned_to)
      values(${fixture.enterprises[0]},${fixture.users[0]},'合成既有客户','13000000000','manual',${fixture.staff[1]}) returning id`))!.id);
  });
  process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = fixture.enterprises[0]; actor = customer();
  owner = new PortfolioService({ enterpriseId: actor.enterpriseId, adminId: fixture.staff[0] });
  author = new PortfolioService({ enterpriseId: actor.enterpriseId, adminId: fixture.staff[1] });
  fixture.works.push(await publishWork('合成原木厨房'), await publishWork('合成第二套厨房')); save();
});
after(async () => {
  try {
    for (const cid of fixture.conversations) {
      const bindings = await withTenantTransaction(fixture.enterprises[0], tx => rows(tx, sql`select result from app.assistant_idempotency_records where operation=${'handoff-review:' + cid}`));
      for (const row of bindings) {
        const proposalId = (row.result as Row)?.proposalId;
        if (typeof proposalId === 'string') await reviewCheckpointer().deleteThread(`handoff:${fixture.enterprises[0]}:${cid}:${proposalId}`);
      }
    }
    await withPlatformTransaction(async tx => {
      for (const eid of fixture.enterprises) {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${eid} and status in ('queued','running')`);
      }
      for (const uid of fixture.users) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      report.providerAttempts = (await rows(tx, sql`select id from app.ai_provider_attempts where enterprise_id in (${fixture.enterprises[0] || '0'},${fixture.enterprises[1] || '0'})`)).length;
      assert.equal(report.providerAttempts, 0); assert.equal(report.externalFetchRequests, 0);
    }); report.cleaned = true;
  } finally {
    if (originalRollout === undefined) delete process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS; else process.env.ASSISTANT_REVIEW_DEVELOPMENT_ENTERPRISE_IDS = originalRollout;
    globalThis.fetch = originalFetch; save(); await closePostgresPool();
  }
});

test('D3 signed work entry reaches the same reviewed conversation and real designer without a phone', async () => {
  const cid = await sourceConversation(), work = fixture.works[0], chat = new ConversationService(actor);
  const sourceLead = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select * from app.leads where id=${fixture.leadId}`));
  const leadCount = Number((await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*) n from app.leads`)))!.n);
  const sent = await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '我喜欢这套厨房，想和这位设计师聊聊收纳，先不留电话。' }] });
  const parts = ['conversations', cid, 'portfolio', 'works', work.id, 'contact'], key = randomUUID();
  const response = await request(parts, 'POST', { versionId: work.versionId }, key);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await request(parts, 'POST', { versionId: work.versionId }, key)).status, 200);
  const reopened = await new HandoffWorkflow(actor).customerRead(cid), h = reopened.handoff as Row;
  assert.equal(reopened.mode, 'handoff_requested'); assert.equal(h.recipientId, work.authorId); assert.equal(h.contactConsent, false); assert.equal(h.phone, '');
  assert.deepEqual((h.source as Row).portfolio, { workId: work.id, versionId: work.versionId, authorId: work.authorId });
  assert.equal((h.source as Row).kind, 'portfolio_content');
  if (sent.runId) assert.equal((await chat.run(String(sent.runId))).status, 'cancelled');
  const staff: ActorContext = { enterpriseId: actor.enterpriseId, principal: { kind: 'admin', adminId: work.authorId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
  const reception = new HandoffService(staff); await reception.staffWrite(cid, randomUUID(), { action: 'claim' });
  const packet = await reception.staffRead(cid); assert.match(JSON.stringify(packet), /想和这位设计师聊聊收纳/);
  await reception.staffWrite(cid, randomUUID(), { action: 'reply', text: '可以，我们先确认厨房里最常用的收纳区域。' });
  assert.equal((await chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '锅具比较多，希望拿取顺手。' }] })).runId, null);
  assert.equal((await new HandoffWorkflow(actor).customerRead(cid)).mode, 'human');
  assert.equal(fingerprint(await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select * from app.leads where id=${fixture.leadId}`))), fingerprint(sourceLead));
  assert.equal(Number((await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select count(*) n from app.leads`)))!.n), leadCount);
  report.checks.push('signed source -> real HTTP contact -> idempotent waiting/reentry -> author claim/reply -> no-phone human chat; existing lead unchanged'); save();
});

test('D3 company entry retains its channel and binds original-key recovery to the exact work', async () => {
  const cid = await sourceConversation('company', 1), a = customer(1), work = fixture.works[0], key = randomUUID();
  const contact = new PortfolioCatalog(a, cid);
  const result = await contact.contact(work.id, { versionId: work.versionId }, key);
  assert.equal(result.reviewWorkflow, 'langgraph');
  assert.equal((result.handoff!.source as Row).kind, 'public_site_entry');
  assert.deepEqual((result.handoff!.source as Row).portfolio, { workId: work.id, versionId: work.versionId, authorId: work.authorId });
  await assert.rejects(contact.contact(fixture.works[1].id, { versionId: fixture.works[1].versionId }, key), /idempotency_conflict/);
  const again = await new PortfolioCatalog(a, cid).contact(work.id, { versionId: work.versionId }, key);
  assert.equal(again.handoff!.requestId, key); assert.equal(again.mode, 'handoff_requested');
  report.checks.push('company source retained; same key cannot switch work/version; same-work reentry recovers original request'); save();
});

test('D3 lost response resumes one durable contact and a cancelled request is never resurrected', async () => {
  const cid = await sourceConversation(), work = fixture.works[0], key = randomUUID(); let lost = false;
  const contact = new PortfolioCatalog(actor, cid, { afterWrite: async () => { if (!lost) { lost = true; throw Error('synthetic-contact-response-loss'); } } });
  await assert.rejects(contact.contact(work.id, { versionId: work.versionId }, key), /synthetic-contact-response-loss/);
  assert.equal((await new HandoffWorkflow(actor).customerRead(cid)).mode, 'handoff_requested');
  const resumed = await new PortfolioCatalog(actor, cid).contact(work.id, { versionId: work.versionId }, key);
  assert.equal(resumed.handoff!.requestId, key);
  const events = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.domain_event_outbox
    where type='assistant.handoff.customer.v1' and correlation_id=${key}`)); assert.equal(events.length, 1);
  const workflow = new HandoffWorkflow(actor), current = await workflow.customerRead(cid);
  await workflow.customerWrite(cid, randomUUID(), { action: 'cancel', expectedVersion: current.version });
  const reopened = await new PortfolioCatalog(actor, cid).contact(work.id, { versionId: work.versionId }, key);
  assert.equal(reopened.handoff!.state, 'cancelled'); assert.equal(reopened.mode, 'ai');
  assert.equal((await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id from app.domain_event_outbox
    where type='assistant.handoff.customer.v1' and correlation_id=${key}`))).length, 1);
  report.checks.push('lost response kept real committed request; same checkpoint/key recovered once; old replay after cancel preserved AI mode'); save();
});

test('D3 withdrawal while graph is paused prevents the contact write', async () => {
  const cid = await sourceConversation(), work = await publishWork('合成撤回保护作品'); fixture.works.push(work);
  const contact = new PortfolioCatalog(actor, cid, { afterPause: async () => {
    const detail = await op(author, 'detail', { workId: work.id });
    await op(owner, 'withdraw', { workId: work.id, expectedVersion: (detail.work as Row).version });
  } });
  await assert.rejects(contact.contact(work.id, { versionId: work.versionId }, randomUUID()), /portfolio_not_found/);
  const current = await new HandoffWorkflow(actor).customerRead(cid); assert.equal(current.handoff, null); assert.equal(current.mode, 'ai');
  report.checks.push('publication withdrawn between pause/resume denied; no waiting request or mode change'); save();
});

test('D3 current owner changing during review cannot silently assign the work author', async () => {
  const cid = await sourceConversation(), work = fixture.works[0];
  const contact = new PortfolioCatalog(actor, cid, { afterPause: async () => {
    await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set assigned_to=${fixture.staff[2]} where id=${fixture.leadId}`));
  } });
  try {
    await assert.rejects(contact.contact(work.id, { versionId: work.versionId }, randomUUID()), /portfolio_owner_conflict/);
    const current = await new HandoffWorkflow(actor).customerRead(cid); assert.equal(current.handoff, null); assert.equal(current.mode, 'ai');
    assert.equal(String((await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select assigned_to from app.leads where id=${fixture.leadId}`)))!.assigned_to), fixture.staff[2]);
  } finally { await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.leads set assigned_to=${fixture.staff[1]} where id=${fixture.leadId}`)); }
  report.checks.push('owner conflict rechecked at apply after durable pause; current assignment retained'); save();
});

test('D3 legacy contact receipts keep their existing hash and normal review requests keep consent/version guards', async () => {
  const cid = await sourceConversation(), work = fixture.works[0], key = randomUUID();
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot=entry_snapshot-'requirementReviewMode'-'requirementWorkflow'-'agentReviewCandidate' where id=${cid}`));
  const source = { workId: work.id, versionId: work.versionId, authorId: work.authorId };
  await new HandoffService(actor).customerWrite(cid, key, { action: 'request', recipientId: work.authorId }, undefined, source);
  const recovered = await new PortfolioCatalog(actor, cid).contact(work.id, { versionId: work.versionId }, key);
  assert.equal(recovered.handoff!.requestId, key);
  const reviewCid = await sourceConversation(), workflow = new HandoffWorkflow(actor), current = await workflow.customerRead(reviewCid);
  await assert.rejects(new HandoffService(actor).customerWrite(reviewCid, randomUUID(), { action: 'request', consent: true }), /handoff_review_required/);
  await assert.rejects(workflow.customerWrite(reviewCid, randomUUID(), { action: 'request', consent: true }), /invalid_message/);
  await assert.rejects(workflow.customerWrite(reviewCid, randomUUID(), { action: 'request', consent: true, expectedVersion: Number(current.version) + 1 }), /version_conflict/);
  const requested = await workflow.customerWrite(reviewCid, randomUUID(), { action: 'request', consent: true, expectedVersion: current.version });
  assert.equal(requested.mode, 'handoff_requested');
  report.checks.push('legacy original body/hash replay preserved; raw review bypass and missing/stale consent/version remain denied; ordinary reviewed request works'); save();
});

test('D3 stale/publication and caller scopes fail without sharing another customer conversation', async () => {
  const cid = await sourceConversation(), work = fixture.works[0];
  const parts = ['conversations', cid, 'portfolio', 'works', work.id, 'contact'];
  assert.equal((await request(parts, 'POST', { versionId: '9223372036854775806' })).status, 404);
  assert.equal((await request(parts, 'POST', { versionId: work.versionId }, randomUUID(), 1)).status, 404);
  const anonymous = await assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + parts.join('/'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ versionId: work.versionId }),
  }), parts); assert.equal(anonymous.status, 401);
  const foreign = { ...actor, enterpriseId: fixture.enterprises[1] };
  await assert.rejects(new PortfolioCatalog(foreign, cid).contact(work.id, { versionId: work.versionId }, randomUUID()), /assistant_resource_not_found/);
  report.checks.push('stale work version404; other customer404; no bearer401; foreign enterprise denies private conversation'); save();
});

test('D3 a waiting designer request cannot claim a second author was contacted', async () => {
  const cid = await sourceConversation('company', 1), a = customer(1), first = fixture.works[0];
  const second = await publishWork('合成另一位设计师作品', new PortfolioService({ enterpriseId: actor.enterpriseId, adminId: fixture.staff[2] }), fixture.staff[2]); fixture.works.push(second);
  const catalog = new PortfolioCatalog(a, cid), key = randomUUID();
  await catalog.contact(first.id, { versionId: first.versionId }, key);
  await assert.rejects(catalog.contact(second.id, { versionId: second.versionId }, randomUUID()), /portfolio_owner_conflict/);
  const current = await new HandoffWorkflow(a).customerRead(cid);
  assert.equal(current.handoff!.recipientId, first.authorId); assert.equal(current.handoff!.requestId, key);
  report.checks.push('waiting target is retained; another author requires explicit coordination rather than false successful contact'); save();
});
