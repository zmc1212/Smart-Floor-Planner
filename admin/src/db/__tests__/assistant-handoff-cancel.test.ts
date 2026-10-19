import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { AssistantError, type ActorContext } from '@/lib/assistant/contracts';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';

const prefix = 'synthetic-handoff-cancel-' + randomUUID(), tenants: string[] = [], users: string[] = [];
const output = process.env.XIAOK_HANDOFF_OUTPUT!;
let actor: ActorContext, other: ActorContext, stranger: ActorContext, staffActor: ActorContext, staffId = '';
let externalFetches = 0;
const originalFetch = globalThis.fetch;
const report: Record<string, unknown> = { prefix, scope: 'real isolated PostgreSQL handoff cancellation; no Worker or provider', cases: [] };
const content = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
const save = () => { if (output) fs.writeFileSync(output + '/service.json', JSON.stringify(report, null, 2)); };

before(async () => {
  assert.ok(process.env.XIAOK_HANDOFF_LOCK_HELD, 'Use the canonical-lock acceptance coordinator');
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input));
    if (['localhost', '127.0.0.1'].includes(url.hostname) && ['9431', '3008'].includes(url.port)) return originalFetch(input, init);
    externalFetches++; throw Error('Acceptance forbids external/provider fetch');
  }) as typeof fetch;
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${tenants[i]},true,100,12000000,1000000000,30)`);
    }
    for (let i = 0; i < 3; i++) {
      users.push(String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
    }
    staffId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${tenants[0]},${prefix},'synthetic-unused','enterprise_admin','active',ARRAY[]::text[],false) returning id`))!.id);
  });
  actor = { enterpriseId: tenants[0], principal: { kind: 'user', userId: users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  other = { ...actor, enterpriseId: tenants[1], principal: { kind: 'user', userId: users[1] } };
  stranger = { ...actor, principal: { kind: 'user', userId: users[2] } };
  staffActor = { enterpriseId: tenants[0], principal: { kind: 'admin', adminId: staffId }, contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
  report.fixtures = { tenants, users, staffId }; save();
});

async function waiting() {
  const chat = new ConversationService(actor), handoff = new HandoffService(actor), cid = String((await chat.create(randomUUID())).id);
  await handoff.customerWrite(cid, randomUUID(), { action: 'request' });
  assert.equal((await handoff.customerRead(cid)).mode, 'handoff_requested');
  return { chat, handoff, cid };
}
async function counts(cid: string) {
  return withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select
    (select count(*)::int from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and purpose='handoff.cancel') feedback,
    (select count(*)::int from app.assistant_participants where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and participant_role='handoff_staff' and status='active') staff,
    (select count(*)::int from app.domain_event_outbox where enterprise_id=${actor.enterpriseId} and aggregate_id=${cid} and type='assistant.handoff.customer.v1' and payload->>'action'='cancel') events`));
}

test('real send atomically cancels waiting, persists existing feedback and reenters without an AI job', async () => {
  const { chat, handoff, cid } = await waiting(), key = randomUUID();
  const sent = await chat.send(cid, key, content('取消人工接待'));
  assert.equal(sent.runId, null);
  const state = await handoff.customerRead(cid);
  assert.equal(state.mode, 'ai'); assert.equal(state.handoff?.state, 'cancelled');
  assert.deepEqual(await counts(cid), { feedback: 1, staff: 0, events: 1 });
  const history = (await chat.messages(cid)).items;
  assert.equal(history.filter(m => m.authorKind === 'user' && JSON.stringify(m.content).includes('取消人工接待')).length, 1);
  assert.ok(history.some(m => m.authorKind === 'system' && JSON.stringify(m.content).includes('本次接续已结束，小K恢复回复。')));
  assert.equal((await new HandoffService(actor).customerRead(cid)).handoff?.state, 'cancelled');
  assert.equal((await chat.detail(cid)).latestRun, null);
  assert.deepEqual(await chat.send(cid, key, content('取消人工接待')), sent);
  assert.deepEqual(await counts(cid), { feedback: 1, staff: 0, events: 1 });
  (report.cases as unknown[]).push({ name: 'persisted-cancel-and-reentry', cid, messageId: sent.messageId }); save();
});

test('replaying an old send cannot cancel a newer handoff and a changed body conflicts', async () => {
  const { chat, handoff, cid } = await waiting(), key = randomUUID();
  const receipt = await chat.send(cid, key, content('不找设计师了'));
  const newRequest = randomUUID(); await handoff.customerWrite(cid, newRequest, { action: 'request' });
  assert.deepEqual(await chat.send(cid, key, content('不找设计师了')), receipt);
  const state = await handoff.customerRead(cid);
  assert.equal(state.mode, 'handoff_requested'); assert.equal(state.handoff?.requestId, newRequest);
  await assert.rejects(chat.send(cid, key, content('取消人工接待')), /idempotency_conflict/);
  assert.deepEqual(await counts(cid), { feedback: 1, staff: 0, events: 1 });
});

test('ordinary, quoted, hypothetical, question and multi-block supplements do not cancel', async () => {
  const { chat, handoff, cid } = await waiting();
  for (const text of ['不要取消人工接待', '“取消人工接待”', '如果取消人工接待会怎样', '取消人工接待？', '算了', '书房预算还没定']) {
    assert.equal((await chat.send(cid, randomUUID(), content(text))).runId, null);
    assert.equal((await handoff.customerRead(cid)).mode, 'handoff_requested');
  }
  await assert.rejects(chat.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '取消人工接待' }, { type: 'text', text: '先聊预算' }] }), /invalid_message/);
  assert.equal((await handoff.customerRead(cid)).mode, 'handoff_requested');
  assert.deepEqual(await counts(cid), { feedback: 0, staff: 0, events: 0 });
});

test('an active reception receives the text without being automatically ended', async () => {
  const { chat, handoff, cid } = await waiting(), staff = new HandoffService(staffActor);
  await staff.staffWrite(cid, randomUUID(), { action: 'claim' });
  await chat.send(cid, randomUUID(), content('取消人工接待'));
  const state = await handoff.customerRead(cid);
  assert.equal(state.mode, 'human'); assert.equal(state.handoff?.state, 'active');
  assert.deepEqual(await counts(cid), { feedback: 0, staff: 1, events: 0 });
  await handoff.customerWrite(cid, randomUUID(), { action: 'end' });
  assert.equal((await handoff.customerRead(cid)).mode, 'ai');
});

test('cancel-before-claim rejects late takeover and claim/cancel transactions have one legal outcome', async () => {
  const first = await waiting(), staff = new HandoffService(staffActor);
  await first.chat.send(first.cid, randomUUID(), content('取消等待设计师'));
  await assert.rejects(staff.staffWrite(first.cid, randomUUID(), { action: 'claim' }), error => error instanceof AssistantError && error.status === 404);
  assert.deepEqual(await counts(first.cid), { feedback: 1, staff: 0, events: 1 });
  const next = await waiting();
  const results = await Promise.allSettled([staff.staffWrite(next.cid, randomUUID(), { action: 'claim' }), next.chat.send(next.cid, randomUUID(), content('我先不找设计师了'))]);
  const state = await next.handoff.customerRead(next.cid), count = await counts(next.cid);
  assert.equal(results[1].status, 'fulfilled');
  if (state.mode === 'ai') { assert.equal(results[0].status, 'rejected'); assert.deepEqual(count, { feedback: 1, staff: 0, events: 1 }); }
  else { assert.equal(state.mode, 'human'); assert.equal(results[0].status, 'fulfilled'); assert.deepEqual(count, { feedback: 0, staff: 1, events: 0 }); }
  (report.cases as unknown[]).push({ name: 'claim-cancel-real-transactions', cid: next.cid, mode: state.mode }); save();
});

test('tenant, owner and inconsistent-state failures leave the original message and transition unwritten', async () => {
  const { chat, handoff, cid } = await waiting();
  for (const candidate of [other, stranger]) await assert.rejects(new ConversationService(candidate).send(cid, randomUUID(), content('取消人工接待')), /assistant_resource_not_found/);
  assert.equal((await handoff.customerRead(cid)).mode, 'handoff_requested');
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{handoff,state}','"active"'::jsonb) where enterprise_id=${actor.enterpriseId} and id=${cid}`));
  const key = randomUUID(); await assert.rejects(chat.send(cid, key, content('取消人工接待')), /context_changed/);
  assert.equal(await withTenantTransaction(actor.enterpriseId, async tx => Number((await one(tx, sql`select count(*) n from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and client_message_id=${key}`))!.n)), 0);
  assert.deepEqual(await counts(cid), { feedback: 0, staff: 0, events: 0 });
});

test('real customer HTTP uses the same original send key and response shape', async () => {
  const { cid, handoff } = await waiting();
  const token = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const key = randomUUID(), call = () => assistantHttp(new Request('http://localhost/api/miniprogram/assistant/conversations/' + cid + '/messages', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key }, body: JSON.stringify({ clientMessageId: key, content: content('取消人工接待') }),
  }), ['conversations', cid, 'messages']);
  const response = await call(); assert.equal(response.status, 202); const first = await response.json();
  const retry = await call(); assert.equal(retry.status, 202); const again = await retry.json();
  assert.equal(again.success, true); assert.deepEqual(again.data, first.data);
  assert.equal((await handoff.customerRead(cid)).handoff?.state, 'cancelled');
  assert.deepEqual(await counts(cid), { feedback: 1, staff: 0, events: 1 });
});

if (process.env.XIAOK_HANDOFF_NATIVE === '1') test('Stable C01 exercises real cancellation and lost-receipt reentry', async () => {
  const { cid, handoff } = await waiting();
  const token = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || '/', 'http://localhost:3008');
      if (!url.pathname.startsWith('/api/miniprogram/assistant/')) { outgoing.writeHead(404); outgoing.end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(url, { method: incoming.method, headers, ...(['GET', 'HEAD'].includes(incoming.method || 'GET') ? {} : { body: Buffer.concat(chunks).toString('utf8') }) });
      const response = await assistantHttp(request, url.pathname.slice('/api/miniprogram/assistant/'.length).split('/'));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries())); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end('Synthetic acceptance handler failed'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(3008, 'localhost', resolve); });
  try {
    const { run } = await import('../../../scripts/assistant-handoff-cancel-native.mjs');
    report.native = await run({ automationRoot: process.env.XIAOK_AUTOMATION_ROOT!, output, origin: 'http://localhost:3008',
      customer: { token, enterpriseId: actor.enterpriseId, conversationId: cid } });
    assert.equal((await handoff.customerRead(cid)).handoff?.state, 'cancelled');
    assert.deepEqual(await counts(cid), { feedback: 2, staff: 0, events: 2 });
    assert.equal(await withTenantTransaction(actor.enterpriseId, async tx => Number((await one(tx, sql`select count(*) n from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and author_kind='user' and content::text like '%取消人工接待%'`))!.n)), 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

after(async () => {
  try {
    report.provider = { externalFetches };
    const tenantIds = '{' + tenants.join(',') + '}', userIds = '{' + users.join(',') + '}';
    try {
      report.audit = await withPlatformTransaction(tx => one(tx, sql`select
        (select count(*)::int from app.assistant_runs where enterprise_id=any(${tenantIds}::bigint[])) runs,
        (select count(*)::int from app.ai_provider_attempts where enterprise_id=any(${tenantIds}::bigint[])) attempts,
        (select count(*)::int from app.assistant_jobs where enterprise_id=any(${tenantIds}::bigint[]) and provider_started_at is not null) starts`));
    } finally {
      // A diagnostic failure must never bypass precise owned-fixture cleanup.
      await withPlatformTransaction(async tx => {
        for (const tenant of tenants) { await deleteAssistantData(tx, BigInt(tenant)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant}`); await tx.execute(sql`delete from app.enterprises where id=${tenant}`); }
        for (const user of users) await tx.execute(sql`delete from app.users where id=${user}`);
      });
      report.remaining = await withPlatformTransaction(tx => one(tx, sql`select
        (select count(*)::int from app.enterprises where id=any(${tenantIds}::bigint[])) enterprises,
        (select count(*)::int from app.users where id=any(${userIds}::bigint[])) users,
        (select count(*)::int from app.admin_users where id=${staffId || '0'}) staff`));
    }
    assert.equal(externalFetches, 0);
    assert.deepEqual(report.audit, { runs: 0, attempts: 0, starts: 0 });
    assert.deepEqual(report.remaining, { enterprises: 0, users: 0, staff: 0 });
  } finally { globalThis.fetch = originalFetch; await closePostgresPool(); save(); }
});
