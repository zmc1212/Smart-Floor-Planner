import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { POST as workerPost } from '@/app/api/internal/assistant/jobs/run/route';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { ConversationService, startInternalRun } from '@/lib/assistant/core/conversation';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { changeMode, appendEventNotice, bindContext } from '@/lib/assistant/core/extensions';
import { claimJob, completeRun, failRun, heartbeat, markProviderStarted, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { ContextRegistry } from '@/lib/assistant/capabilities/registry';
import { entryContext, fromEntry, locate } from '@/lib/assistant/application/auth';
import type { ActorContext } from '@/lib/assistant/contracts';

const prefix = 'assistant-test-' + process.pid + '-' + Date.now();
let a: ActorContext; let b: ActorContext; let stranger: ActorContext; let service: ConversationService;
const tenants: string[] = []; const userIds: string[] = [];
const content = (text = '旧房改造包含哪些服务？') => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
before(async () => {
  loadEnvConfig(process.cwd());
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(resolvePostgresRuntimeConfig().connectionString).hostname));
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const tenant = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!;
      tenants.push(String(tenant.id));
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${String(tenant.id)},true,100,1200000,100000000,90)`);
      const user = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!;
      userIds.push(String(user.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(user.id)},${prefix + '-openid-' + i})`);
    }
  });
  a = { enterpriseId: tenants[0], principal: { kind: 'user', userId: userIds[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  b = { ...a, enterpriseId: tenants[1] }; stranger = { ...a, principal: { kind: 'user', userId: userIds[1] } };
  service = new ConversationService(a);
});
after(async () => {
  await withPlatformTransaction(async tx => {
    for (const tenant of tenants) {
      await deleteAssistantData(tx, BigInt(tenant));
      await tx.execute(sql`delete from app.enterprises where id=${tenant}`);
    }
    for (const user of userIds) await tx.execute(sql`delete from app.users where id=${user}`);
  });
  await closePostgresPool();
});
async function conversation() { return String((await service.create('create-' + crypto.randomUUID())).id); }
async function pending() {
  const c = await conversation(); const r = await service.send(c, crypto.randomUUID(), content());
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, r.runId);
  return { c, r, lease: lease as Lease };
}
test('A01/A02 tenant RLS, same-tenant membership, global customer identity and composite FKs', async () => {
  const c = await conversation();
  assert.equal((await service.detail(c)).id, c);
  await assert.rejects(new ConversationService(b).detail(c), /assistant_resource_not_found/);
  await assert.rejects(new ConversationService(stranger).detail(c), /assistant_resource_not_found/);
  assert.equal((await withTenantTransaction(b.enterpriseId, tx => rows(tx, sql`select id from app.assistant_conversations where id=${c}`))).length, 0);
  await assert.rejects(withTenantTransaction(b.enterpriseId, tx => tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,grant_basis)
    values(${b.enterpriseId},${c},'user',${userIds[0]},'{}')`)));
  const ownOther = await new ConversationService(b).create('global-customer'); assert.ok(ownOther.id);
  assert.equal((await service.list()).items.some(item => item.id === ownOther.id), false);
});
test('history titles use the first question for existing conversations and respect retention and membership', async () => {
  const c = await conversation();
  const title = async () => (await service.list()).items.find(item => item.id === c)?.title;
  assert.equal(await title(), '');
  const question = '  水电验收\n需要哪些记录？  ';
  const first = await service.send(c, 'title-first', content(question));
  await service.send(c, 'title-first', content(question));
  await service.run(String(first.runId), 'cancel', 'title-cancel-first');
  const second = await service.send(c, 'title-second', content('后续问题不能覆盖标题'));
  await service.run(String(second.runId), 'cancel', 'title-cancel-second');
  assert.equal(await title(), '水电验收 需要哪些记录？');
  assert.equal((await new ConversationService(stranger).list()).items.some(item => item.id === c), false);
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_messages
    set content=${JSON.stringify(content('😀'.repeat(81)))}::jsonb where id=${String(first.messageId)}`));
  assert.equal(await title(), '😀'.repeat(80) + '…');
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot='{"retentionRedacted":true}'::jsonb where id=${c}`));
  assert.equal(await title(), '');
});

test('A05 concurrent same key creates one conversation and send, different body conflicts, busy writes no message', async () => {
  const [first, second] = await Promise.all([service.create('same-create'), service.create('same-create')]);
  assert.equal(first.id, second.id); const c = String(first.id);
  const [r1, r2] = await Promise.all([service.send(c, 'same-send', content()), service.send(c, 'same-send', content())]);
  assert.deepEqual(r1, r2);
  const recovered = await service.detail(c);
  assert.equal(recovered.latestRun?.id, r1.runId);
  assert.equal(recovered.latestRun?.status, 'queued');
  assert.equal('previewScope' in recovered, false);
  await assert.rejects(service.send(c, 'same-send', content('另一问题')), /idempotency_conflict/);
  await assert.rejects(service.send(c, 'new-send', content()), /conversation_busy/);
  assert.equal((await service.messages(c)).items.length, 1);
  await service.run(String(r1.runId), 'cancel', 'cancel-same-send');
  const retry = await service.run(String(r1.runId), 'retry', 'retry-same-send') as Row;
  assert.equal((await service.detail(c)).latestRun?.id, retry.runId);
  assert.notEqual(retry.runId, r1.runId); assert.equal(retry.messageId, r1.messageId);
  assert.deepEqual(await service.run(String(r1.runId), 'retry', 'retry-same-send'), retry);
  await service.run(String(retry.runId), 'cancel', 'cancel-retry');
});
test('A05 two distinct simultaneous sends commit exactly one message/run', async () => {
  const c = await conversation();
  const results = await Promise.allSettled([service.send(c, 'race-a', content()), service.send(c, 'race-b', content())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.messages(c)).items.length, 1);
  const result = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Record<string, unknown>>;
  await service.run(String(result.value.runId), 'cancel', 'cancel-race');
});
test('A06 lease recovery before provider dispatch fences stale worker and preserves IDs', async () => {
  const { r, lease } = await pending();
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()-interval '1 second' where id=${lease.jobId}`));
  const next = await claimJob(); assert.ok(next); assert.equal(next.runId, lease.runId); assert.notEqual(next.token, lease.token);
  await assert.rejects(completeRun(lease, { content: content('late'), usage: null }), /context_changed/);
  await heartbeat(next);
  const messageId = await completeRun(next, { content: content('test adapter response'), usage: null });
  const state = await service.run(String(r.runId)); assert.equal(state.status, 'succeeded'); assert.equal(state.outputMessageId, messageId);
  await assert.rejects(completeRun(next, { content: content(), usage: null }), /context_changed/);
});
test('A06 provider dispatch crash becomes indeterminate, never reclaims or automatically retries', async () => {
  const { r, lease } = await pending(); await markProviderStarted(lease);
  await assert.rejects(markProviderStarted(lease), /context_changed/);
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()-interval '1 second' where id=${lease.jobId}`));
  assert.equal(await claimJob(), null);
  assert.equal((await service.run(String(r.runId))).status, 'indeterminate');
  await assert.rejects(service.run(String(r.runId), 'retry', 'unknown-retry'), /context_changed/);
  const reservation = await withTenantTransaction(a.enterpriseId, tx => one(tx, sql`select status from app.assistant_quota_reservations where run_id=${lease.runId}`));
  assert.equal(reservation!.status, 'reconciling');
});
test('A06 cancellation blocks late response and unsafe retry after provider submission', async () => {
  const { r, lease } = await pending(); await markProviderStarted(lease);
  await service.run(String(r.runId), 'cancel', 'cancel-inflight');
  await assert.rejects(completeRun(lease, { content: content('late'), usage: null }), /context_changed/);
  await assert.rejects(service.run(String(r.runId), 'retry', 'unsafe-retry'), /context_changed/);
  assert.equal((await service.run(String(r.runId))).status, 'cancelled');
});
test('A02 revoked membership invalidates reads, idempotent replay and in-flight commit', async () => {
  const { c, lease } = await pending();
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now() where conversation_id=${c}`));
  await assert.rejects(service.detail(c), /assistant_resource_not_found/);
  await assert.rejects(completeRun(lease, { content: content(), usage: null }), /assistant_resource_not_found/);
  await failRun(lease, 'context_changed');
});
test('A02 identity version change invalidates in-flight worker and historical reads', async () => {
  const { c, lease } = await pending();
  await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=2 where id=${userIds[0]}`));
  await assert.rejects(service.detail(c), /identity_context_invalid/);
  await assert.rejects(completeRun(lease, { content: content(), usage: null }), /identity_context_invalid/);
  await failRun(lease, 'identity_context_invalid');
  await withPlatformTransaction(tx => tx.execute(sql`update app.users set context_version=1 where id=${userIds[0]}`));
});
test('A09 tenant quota is serialized across separate conversations; no user message on rejection', async () => {
  const svc = new ConversationService(b); const c1 = String((await svc.create('quota-1')).id); const c2 = String((await svc.create('quota-2')).id);
  await withTenantTransaction(b.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set daily_requests=1 where enterprise_id=${b.enterpriseId}`));
  const result = await Promise.allSettled([svc.send(c1, 'quota-a', content()), svc.send(c2, 'quota-b', content())]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const failure = result.find(r => r.status === 'rejected') as PromiseRejectedResult; assert.match(failure.reason.message, /assistant_quota_exceeded/);
  assert.equal((await svc.messages(c1)).items.length + (await svc.messages(c2)).items.length, 1);
  const accepted = result.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Record<string, unknown>>;
  await svc.run(String(accepted.value.runId), 'cancel', 'quota-cancel');
});
test('A11 disabled feature preserves participant history but rejects send and worker commit', async () => {
  const { c, lease } = await pending();
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${a.enterpriseId}`));
  const identity = { userId: userIds[0], contextVersion: 1, enterpriseId: a.enterpriseId };
  const entry = await entryContext(identity, { conversationId: c });
  assert.equal(entry.canSend, false);
  assert.equal(entry.maxMessageChars, 4000);
  const historyService = new ConversationService(await fromEntry(identity, entry.entryToken));
  assert.ok((await historyService.list()).items.some(item => item.id === c));
  await assert.rejects(historyService.create('disabled-create'), /assistant_disabled/);
  assert.equal((await service.messages(c)).items.length, 1);
  await assert.rejects(service.send(c, 'disabled-send', content()), /assistant_disabled/);
  await assert.rejects(completeRun(lease, { content: content(), usage: null }), /assistant_disabled/);
  await failRun(lease, 'assistant_disabled');
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${a.enterpriseId}`));
});
test('E02 deduplicated system event has no fake user author; archived conversation stays closed', async () => {
  const c = await conversation();
  const event = await withTenantTransaction(a.enterpriseId, tx => one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id)
    values(${a.enterpriseId},'test.notice.v1','test','1',1,'{"kind":"system"}','test') returning id`));
  const actor = { ...a, capabilities: [...a.capabilities, 'assistant.event.append'] };
  const first = await appendEventNotice(actor, c, String(event!.id), 'reminder', '测试提醒');
  assert.equal(await appendEventNotice(actor, c, String(event!.id), 'reminder', '测试提醒'), first);
  assert.equal((await service.messages(c)).items[0].authorKind, 'system');
  const current = await service.detail(c); await service.archive(c, Number(current.version), 'archive-event');
  await assert.rejects(appendEventNotice(actor, c, String(event!.id), 'another', '测试'), /context_changed/);
});
test('E03 internal mode switch fences AI without changing conversation or exposing a production action', async () => {
  const { c, lease } = await pending();
  await assert.rejects(changeMode(a, c, 'human'), /assistant_capability_forbidden/);
  await changeMode({ ...a, capabilities: [...a.capabilities, 'assistant.mode.manage'] }, c, 'human');
  await assert.rejects(completeRun(lease, { content: content(), usage: null }), /context_changed/);
  assert.equal((await service.detail(c)).id, c); assert.equal((await service.detail(c)).mode, 'human');
});
test('E04 binding never grants access; a registered provider rechecks revoked resource access', async () => {
  let allowed = true;
  const registry = new ContextRegistry().register('test-project', {
    authorize: async actor => allowed && actor.contextVersion === 1,
    resolve: async (_, ref) => [{ ref, text: '正式事实', hash: 'test' }],
  });
  const c = await conversation(); const ref = { type: 'test-project', id: '1', version: '2' };
  await bindContext({ ...a, capabilities: [...a.capabilities, 'assistant.binding.manage'] }, c, ref, registry);
  assert.equal((await registry.resolve(a, ref)).length, 1);
  allowed = false; await assert.rejects(registry.resolve(a, ref), /assistant_resource_not_found/);
  await assert.rejects(registry.resolve(a, { type: 'unregistered', id: '1' }), /assistant_resource_not_found/);
});
test('A01 entry tokens bind customer/version, forbidden arbitrary enterprise and safe resource locator', async () => {
  const identity = { userId: userIds[0], contextVersion: 1, enterpriseId: a.enterpriseId };
  const entry = await entryContext(identity, {});
  assert.equal((await fromEntry(identity, entry.entryToken)).enterpriseId, a.enterpriseId);
  await assert.rejects(fromEntry({ ...identity, userId: userIds[1] }, entry.entryToken), /entry_context_invalid/);
  await assert.rejects(fromEntry({ ...identity, contextVersion: 2 }, entry.entryToken), /entry_context_invalid/);
  await assert.rejects(entryContext(identity, { enterpriseId: b.enterpriseId }), /entry_context_invalid/);
  await assert.rejects(entryContext({ ...identity, enterpriseId: undefined }, {}), /entry_context_invalid/);
  const c = await conversation();
  assert.equal((await locate({ ...identity, enterpriseId: undefined }, 'conversation', c)).enterpriseId, a.enterpriseId);
  await assert.rejects(locate({ ...identity, userId: userIds[1] }, 'conversation', c), /assistant_resource_not_found/);
});
test('archive version conflict, input bounds, unknown protocol fields reject without effects', async () => {
  const c = await conversation();
  await assert.rejects(service.archive(c, 100, 'bad-version'), /version_conflict/);
  await assert.rejects(service.send(c, 'too-long', content('x'.repeat(4001))), /invalid_message/);
  await assert.rejects(service.send(c, 'injected', { ...content(), role: 'system' }), /invalid_message/);
  assert.equal((await service.messages(c)).items.length, 0);
});
test('HTTP no-phone WeChat identity can create/send/poll; unauthorized and forbidden fields fail safely', async () => {
  const token = await signMiniProgramToken({ sub: userIds[0], id: userIds[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const entry = await entryContext({ userId: userIds[0], contextVersion: 1, enterpriseId: a.enterpriseId }, {});
  const call = (method: string, path: string[], body?: unknown, requestKey?: string) => assistantHttp(new Request('http://localhost/api/miniprogram/assistant/' + path.join('/'), {
    method, headers: { Authorization: 'Bearer ' + token, ...(requestKey ? { 'Idempotency-Key': requestKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path);
  const created = await call('POST', ['conversations'], { entryToken: entry.entryToken }, 'http-create');
  assert.equal(created.status, 200); const c = (await created.json()).data.id;
  const sent = await call('POST', ['conversations', c, 'messages'], { clientMessageId: 'http-send', content: content() }, 'http-send');
  assert.equal(sent.status, 202); const run = (await sent.json()).data;
  assert.equal((await call('GET', ['runs', run.runId])).status, 200);
  assert.equal((await call('POST', ['conversations', c, 'messages'], { clientMessageId: 'injected-role', content: content(), enterpriseId: b.enterpriseId }, 'injected-role')).status, 422);
  assert.equal((await assistantHttp(new Request('http://localhost'), ['conversations'])).status, 401);
  await service.run(run.runId, 'cancel', 'http-cancel');
});
test('E06 summary adapter reuses run and final appender without a trigger user message', async () => {
  const c = await conversation();
  const actor = { ...a, capabilities: [...a.capabilities, 'assistant.run.internal'] };
  const r = await startInternalRun(actor, c, { kind: 'scheduled_task', occurrenceKey: 'test-digest-1' }, 'digest', 'digest-1');
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, r.runId);
  const facts = await new ContextRegistry().register('test-digest', { authorize: async () => true,
    resolve: async (_, ref) => [{ ref, text: '今日量房 2 次', hash: 'facts-v1' }] }).resolve(actor, { type: 'test-digest', id: '1', version: '1' });
  await completeRun(lease, { content: content(facts[0].text), usage: null });
  const history = await service.messages(c); assert.equal(history.items.length, 1); assert.equal(history.items[0].authorKind, 'assistant');
});
test('A06 separate worker process exits after durable claim; next process recovers same run', async () => {
  const c = await conversation(); const r = await service.send(c, 'process-crash', content());
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import queue from './src/lib/assistant/infrastructure/job-queue.ts'; const lease=await queue.claimJob(); console.log(JSON.stringify(lease)); process.exit(0);"],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.stderr);
  const old = JSON.parse(child.stdout.trim()) as Lease; assert.equal(old.runId, r.runId);
  await withTenantTransaction(a.enterpriseId, tx => tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()-interval '1 second' where id=${old.jobId}`));
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, old.runId); assert.notEqual(lease.token, old.token);
  await failRun(lease, 'retrieval_unavailable');
});
test('independent worker script calls authenticated handler, persists health and restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-worker-test-'));
  const health = path.join(directory, 'health.json'); const oldSecret = process.env.CRON_SECRET;
  const responses: number[] = [];
  process.env.CRON_SECRET = 'assistant-test-internal';
  const server = createServer((incoming, outgoing) => {
    const request = new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': String(incoming.headers['x-cron-secret'] || '') },
    });
    void workerPost(request).then(async response => { responses.push(response.status); outgoing.writeHead(response.status); outgoing.end(await response.text()); })
      .catch(() => { outgoing.writeHead(500); outgoing.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let restart = 0; restart < 2; restart++) {
      const started = Date.now();
      const worker = spawn(process.execPath, ['scripts/assistant-worker.mjs'], { cwd: process.cwd(), stdio: 'ignore',
        env: { ...process.env, ASSISTANT_WORKER_ENDPOINT: 'http://127.0.0.1:' + address.port + '/api/internal/assistant/jobs/run', ASSISTANT_WORKER_HEALTH_FILE: health } });
      try {
        let healthy = false;
        // Includes process startup and real SQL over the documented SSH tunnel.
        // Five seconds is not a reliable bound for a remote lease/outbox sweep.
        for (let attempt = 0; attempt < 300; attempt++) {
          const value = await readFile(health, 'utf8').catch(() => '{}');
          if (JSON.parse(value).lastSuccessAt >= started) { healthy = true; break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(healthy, true, `worker did not persist fresh health within 30s; handler statuses=${responses.join(',')}; exit=${worker.exitCode}`);
        assert.equal(spawnSync(process.execPath, ['scripts/assistant-worker-healthcheck.mjs'], { cwd: process.cwd(),
          env: { ...process.env, ASSISTANT_WORKER_HEALTH_FILE: health } }).status, 0);
      } finally {
        if (worker.exitCode === null && worker.signalCode === null) {
          const exited = new Promise<void>(resolve => worker.once('exit', () => resolve()));
          worker.kill(); await exited;
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
  }
});
