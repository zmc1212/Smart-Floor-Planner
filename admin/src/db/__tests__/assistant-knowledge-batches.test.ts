import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
import { activeProfile, KnowledgeService } from '@/lib/assistant/knowledge/service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { principalKey, type TextModelGateway } from '@/lib/assistant/contracts';
import type { EvaluationBatchPreparation } from '@/lib/assistant/knowledge/evaluation-batch';
import type { KnowledgeBatchProgress } from '@/lib/assistant/knowledge/operation-batch-view';
import { GET, POST } from '@/app/api/assistant/knowledge/operations/[...path]/route';

const prefix = 'synthetic-kb4-api-' + randomUUID(), tenants: string[] = [], admins: string[] = [];
const identities: Array<{ id: string; role: string; enterpriseId: string | null }> = [];
let eid: string, ops: KnowledgeOperations, caseId: string, batch: EvaluationBatchPreparation;
const question = '合成问题：书房屏幕眩光和通道需要怎样核对？';
const missing = { kind: 'missing', requiredDocumentIds: [], forbiddenDocumentIds: [] };
const selection = () => ({ cases: [{ caseId, expectedVersion: 1 }] });
const service = (index = 0, tenant = eid) => new KnowledgeOperations({ enterpriseId: tenant, adminId: identities[index].id });
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
async function request(path: string[], body?: Row, index = 0, selected: string | null = eid, requestKey: string = randomUUID(), query = '') {
  const identity = identities[index];
  const token = await new SignJWT({ id: identity.id, role: identity.role, enterpriseId: identity.enterpriseId, permissions: [] })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const req = new NextRequest('http://localhost:3006/api/assistant/knowledge/operations/' + path.join('/') + query, {
    method: body ? 'POST' : 'GET', headers: { cookie: `auth_token=${token}${selected === null ? '' : '; global_tenant_id=' + selected}`, 'idempotency-key': requestKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (body ? POST : GET)(req, context(path));
}
async function prepare(index = 0, cases = selection(), key: string = randomUUID()) {
  const response = await request(['batches'], cases, index, eid, key);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()).data as EvaluationBatchPreparation;
}
async function progress(id = batch.batchId, index = 0) {
  const response = await request(['batches', id], undefined, index);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).data as KnowledgeBatchProgress;
}
async function counts() {
  return withTenantTransaction(eid, async tx => {
    const result: Record<string, number> = {};
    for (const name of ['evaluations', 'runs', 'jobs', 'quota_reservations']) result[name] = Number((await one(tx,
      sql`select count(*)::int n from ${sql.identifier('app')}.${sql.identifier('assistant_' + (name === 'evaluations' ? 'knowledge_evaluations' : name))} where enterprise_id=${eid}`))!.n);
    return result;
  });
}
before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname)); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!.id));
    eid = tenants[0];
    for (const tenant of tenants) await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${tenant},true,1000,12000000,1000000000,30)`);
    for (const role of ['enterprise_admin', 'enterprise_admin', 'admin', 'super_admin', 'enterprise_admin']) {
      const permissions = role === 'enterprise_admin' && identities.length !== 4 ? sql`ARRAY['assistant-knowledge']::text[]` : sql`ARRAY[]::text[]`;
      const enterpriseId = role === 'enterprise_admin' ? eid : null;
      const id = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${enterpriseId},${prefix + identities.length},'unusable-synthetic',${role},'active',${permissions},false) returning id`))!.id);
      identities.push({ id, role, enterpriseId }); admins.push(id);
    }
  });
  for (const tenant of tenants) await withTenantTransaction(tenant, async tx => {
    await activeProfile(tx, tenant, (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${tenant} for update`))!, true);
  });
  ops = service();
  caseId = String((await ops.save({ title: '测试专用 · 批次重进', question, expectation: missing }, randomUUID())).id);
});
after(async () => {
  try {
    try {
      const items = await withPlatformTransaction(async tx => {
        const result = [];
        for (const tenant of tenants) result.push({ enterpriseId: tenant,
          indexAttempts: await rows(tx, sql`select operation,status,count(*)::int calls,sum(input_tokens)::text known_input_tokens,count(*) filter(where input_tokens is null)::int unknown_input_calls
            from app.assistant_knowledge_attempts where enterprise_id=${tenant} group by operation,status order by operation,status`),
          queryEmbedding: await rows(tx, sql`select measurement_kind,count(*)::int calls,sum(input_tokens)::text known_input_tokens,count(*) filter(where input_tokens is null)::int unknown_input_calls
            from app.assistant_usage_records where enterprise_id=${tenant} and category='query_embedding' group by measurement_kind order by measurement_kind`),
          reservations: await rows(tx, sql`select status,count(*)::int count from app.assistant_quota_reservations where enterprise_id=${tenant} group by status order by status`),
        });
        return result;
      });
      console.log('KB4_API_AUDIT ' + JSON.stringify({ fixturePrefix: prefix, tenantIds: tenants, adminIds: admins, items, costMicros: null }));
    } finally {
      await withPlatformTransaction(async tx => {
        for (const tenant of tenants) { await deleteAssistantData(tx, BigInt(tenant)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant}`); await tx.execute(sql`delete from app.enterprises where id=${tenant}`); }
        for (const admin of admins) await tx.execute(sql`delete from app.admin_users where id=${admin}`);
      });
    }
  } finally { await closePostgresPool(); }
});

test('batch HTTP routes enforce authenticated manager, selected enterprise, strict query/body and original key', async () => {
  const anonymous = new NextRequest('http://localhost:3006/api/assistant/knowledge/operations/batches');
  assert.equal((await GET(anonymous, context(['batches']))).status, 401);
  assert.equal((await request(['batches'], undefined, 2, null)).status, 400);
  assert.equal((await request(['batches'], undefined, 4)).status, 403);
  assert.equal((await request(['batches'], undefined, 0, eid, randomUUID(), '?enterpriseId=' + tenants[1])).status, 422);
  assert.equal((await request(['batches'], { ...selection(), enterpriseId: tenants[1] })).status, 422);
  assert.equal((await request(['batches'], selection(), 0, eid, '')).status, 422);
  assert.equal((await request(['batches', 'unknown', 'run'], {})).status, 404);
});

test('all three management roles persist owner-private batches without runs, jobs or reservations', async () => {
  const before = await counts();
  for (const index of [0, 2, 3]) {
    const prepared = await prepare(index);
    assert.equal(prepared.adminId, identities[index].id);
    const own = await progress(prepared.batchId, index); assert.equal(own.items[0].status, 'dispatch_pending'); assert.equal(own.items[0].dispatchState, 'not_started');
    assert.equal((await request(['batches', prepared.batchId], undefined, index === 0 ? 1 : 0)).status, 404);
    const history = (await (await request(['batches'], undefined, index)).json()).data;
    assert.deepEqual(history.scope, { enterpriseId: eid, adminId: identities[index].id }); assert.ok(history.items.some((item: Row) => item.batchId === prepared.batchId));
    if (index === 0) batch = prepared;
  }
  const after = await counts(); assert.equal(after.evaluations, before.evaluations + 3);
  for (const name of ['runs', 'jobs', 'quota_reservations']) assert.equal(after[name], before[name]);
  assert.equal((await request(['batches', batch.batchId], undefined, 2, tenants[1])).status, 404);
});

test('lost HTTP preparation receipt replays immutable evaluations and persisted server history after reentry', async () => {
  const before = await counts(), replay = await prepare(0, selection(), batch.batchId);
  assert.deepEqual(replay, batch); assert.deepEqual(await counts(), before);
  const reopened = await service().readBatch(batch.batchId); assert.equal(reopened.batchId, batch.batchId); assert.equal(reopened.items[0].evaluationId, batch.items[0].evaluationId);
  const newest = await prepare();
  const first = (await (await request(['batches'], undefined, 0, eid, randomUUID(), '?limit=1')).json()).data;
  assert.equal(first.items[0].batchId, newest.batchId); assert.match(first.nextCursor, /^[1-9]\d*$/);
  const next = (await (await request(['batches'], undefined, 0, eid, randomUUID(), '?limit=1&beforeId=' + first.nextCursor)).json()).data;
  assert.equal(next.items[0].batchId, batch.batchId);
});

test('stale versions and invalid item fields roll back the whole HTTP preparation', async () => {
  const before = await counts(), key = randomUUID();
  const second = await ops.save({ title: '测试专用 · 原子准备', question, expectation: missing }, randomUUID());
  assert.equal((await request(['batches'], { cases: [...selection().cases, { caseId: String(second.id), expectedVersion: 99 }] }, 0, eid, key)).status, 409);
  assert.deepEqual(await counts(), before); assert.equal((await request(['batches', key])).status, 404);
  assert.equal((await request(['batches'], { cases: [{ ...selection().cases[0], question: '不可替换' }] })).status, 422);
});

test('batch history orders bigint identities across digit widths and preserves the exact cursor', async () => {
  const lower = '900000000000000001', higher = '1000000000000000001', keys = [randomUUID(), randomUUID()];
  await withTenantTransaction(eid, async tx => {
    for (const [index, target] of [lower, higher].entries()) await tx.execute(sql`insert into app.assistant_idempotency_records
      (id,enterprise_id,principal_key,operation,key,request_hash,result,expires_at) overriding system value
      select ${target}::bigint,r.enterprise_id,r.principal_key,r.operation,${keys[index]},r.request_hash,
        r.result||jsonb_build_object('batchId',${keys[index]}::text),r.expires_at
      from app.assistant_idempotency_records r where r.enterprise_id=${eid} and r.principal_key=${principalKey(ops.actor)}
      and r.operation='knowledge-batch-prepare' and r.key=${batch.batchId}`);
  });
  const first = (await (await request(['batches'], undefined, 0, eid, randomUUID(), '?limit=1')).json()).data;
  assert.equal(first.items[0].batchId, keys[1]); assert.equal(first.nextCursor, higher);
  const second = (await (await request(['batches'], undefined, 0, eid, randomUUID(), '?limit=1&beforeId=' + first.nextCursor)).json()).data;
  assert.equal(second.items[0].batchId, keys[0]); assert.equal(second.nextCursor, lower);
});

test('prepared original resume survives a lost send receipt and batch progress never includes answer content', async () => {
  const evaluationId = batch.items[0].evaluationId, original = ConversationService.prototype.send;
  const unstarted = await counts(); assert.equal((await request(['evaluations', evaluationId, 'cancel'], {})).status, 409); assert.deepEqual(await counts(), unstarted);
  ConversationService.prototype.send = function (...args: Parameters<typeof original>) { return original.apply(this, args).then(() => { throw Error('synthetic batch lost send receipt'); }); };
  try { assert.equal((await request(['evaluations', evaluationId, 'resume'], {})).status, 503); } finally { ConversationService.prototype.send = original; }
  const pending = await progress(); assert.equal(pending.items[0].dispatchState, 'receipt_pending'); assert.equal(pending.items[0].runId, null);
  const before = await counts();
  const results = await Promise.all([request(['evaluations', evaluationId, 'resume'], {}), request(['evaluations', evaluationId, 'resume'], {})]);
  assert.deepEqual(results.map(value => value.status), [200, 200]); assert.deepEqual(await counts(), before);
  const queued = await progress(); assert.equal(queued.items[0].status, 'queued'); assert.equal(queued.counts.queued, 1); assert.ok(queued.items[0].runId);
  for (const field of ['snapshot', 'question', 'answer', 'diagnostic', 'review', 'usage']) assert.ok(!Object.hasOwn(queued.items[0], field));
  assert.equal(queued.contentIncluded, false); assert.equal(queued.costMicros, null); assert.equal(queued.semanticCorrectness, 'requires_review');
  assert.equal((await request(['evaluations', evaluationId, 'cancel'], {}, 1)).status, 404);
  assert.equal((await request(['evaluations', evaluationId, 'cancel'], {}, 0, eid, '')).status, 422);
  assert.equal((await request(['evaluations', evaluationId, 'cancel'], { runId: queued.items[0].runId })).status, 422);
  const cancelKey = randomUUID(), cancelled = await request(['evaluations', evaluationId, 'cancel'], {}, 0, eid, cancelKey);
  assert.equal(cancelled.status, 200); const receipt = (await cancelled.json()).data; assert.equal(receipt.status, 'cancelled');
  const replay = await request(['evaluations', evaluationId, 'cancel'], {}, 0, eid, cancelKey); assert.deepEqual((await replay.json()).data, receipt);
  const quota = await withTenantTransaction(eid, tx => one(tx, sql`select status from app.assistant_quota_reservations where enterprise_id=${eid} and run_id=${queued.items[0].runId!}`)); assert.equal(quota!.status, 'released');
  assert.deepEqual(await counts(), before); await ops.resume(evaluationId); assert.deepEqual(await counts(), before);
  assert.equal((await progress()).items[0].status, 'cancelled');
});

test('a leased run cancellation revokes the original lease and retains unknown submitted usage for reconciliation', async () => {
  const prepared = await prepare(), evaluationId = prepared.items[0].evaluationId;
  await ops.resume(evaluationId); const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, (await progress(prepared.batchId)).items[0].runId);
  assert.equal((await progress(prepared.batchId)).items[0].status, 'running');
  // Synthetic provider-boundary marker only: no external model/Embedding is invoked by this scenario.
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_jobs set provider_started_at=now() where enterprise_id=${eid} and id=${lease.jobId}`));
  const before = await counts(), response = await request(['evaluations', evaluationId, 'cancel'], {}); assert.equal(response.status, 200);
  const detail = await progress(prepared.batchId); assert.equal(detail.items[0].status, 'cancelled'); assert.equal(detail.items[0].awaitingReconciliation, true);
  const job = await withTenantTransaction(eid, tx => one(tx, sql`select status,lease_token from app.assistant_jobs where enterprise_id=${eid} and id=${lease.jobId}`)); assert.equal(job!.status, 'cancelled'); assert.equal(job!.lease_token, null);
  await ops.resume(evaluationId); assert.deepEqual(await counts(), before); assert.equal((await ops.read(evaluationId)).status, 'cancelled');
});

test('removed private participant makes even linked-run metadata unavailable', async () => {
  const evaluationId = batch.items[0].evaluationId;
  const evaluation = await withTenantTransaction(eid, tx => one(tx, sql`select conversation_id from app.assistant_knowledge_evaluations where enterprise_id=${eid} and id=${evaluationId}`));
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_participants set status='revoked' where enterprise_id=${eid} and conversation_id=${String(evaluation!.conversation_id)}`));
  const hidden = (await progress()).items[0]; assert.equal(hidden.status, 'unavailable'); assert.equal(hidden.available, false); assert.equal(hidden.runId, null); assert.equal(hidden.dispatchState, null);
  assert.equal((await request(['evaluations', evaluationId, 'cancel'], {})).status, 404);
});

test('case revisions, knowledge epoch and preparation policy changes disable original batch actions', async () => {
  const caseBatch = await prepare();
  await ops.save({ title: '测试专用 · 修订后', question: question + ' 已修改', expectation: missing, expectedVersion: 1 }, randomUUID(), caseId);
  const stale = await progress(caseBatch.batchId); assert.equal(stale.items[0].status, 'source_changed'); assert.equal(stale.items[0].currentRevision, 2); assert.equal(stale.items[0].available, false);
  assert.equal((await request(['evaluations', caseBatch.items[0].evaluationId, 'resume'], {})).status, 409);
  const next = await prepare(0, { cases: [{ caseId, expectedVersion: 2 }] });
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set policy_version=policy_version+1 where enterprise_id=${eid}`));
  assert.equal((await progress(next.batchId)).contextChanged, true); assert.equal((await progress(next.batchId)).items[0].dispatchState, null);
  const epoch = await prepare(0, { cases: [{ caseId, expectedVersion: 2 }] });
  await withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${eid}`));
  assert.equal((await progress(epoch.batchId)).items[0].status, 'source_changed');
});

test('source effective-time expiry hides a completed batch even without an epoch change', async () => {
  const knowledge = new KnowledgeService({ enterpriseId: eid, adminId: identities[0].id });
  const created = await knowledge.execute('create', { title: '测试专用 · 来源失效', sourceType: 'manual_text', audience: 'customer_public', body: '书房靠窗办公需要核对屏幕眩光和通道尺寸，插座由设计师核对点位图，不能视为已经批准。' }, randomUUID());
  const source = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  const expiresAt = new Date(Date.now() + 120000).toISOString();
  await knowledge.execute('edit', { ...source, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: expiresAt }, randomUUID());
  source.expectedEditVersion = 2;
  const indexed = await knowledge.execute('index', source, randomUUID()), indexLease = await claimKnowledgeJob(); assert.ok(indexLease); assert.equal(indexLease.jobId, indexed.jobId);
  await runKnowledgeJob(indexLease); assert.equal((await knowledge.execute('job', { jobId: indexed.jobId })).status, 'succeeded');
  await knowledge.execute('publish', source, randomUUID());
  const c = await ops.save({ title: '测试专用 · 来源批次', question, expectation: { ...missing, kind: 'grounded', requiredDocumentIds: [source.documentId] } }, randomUUID());
  const prepared = await prepare(0, { cases: [{ caseId: String(c.id), expectedVersion: 1 }] });
  await ops.resume(prepared.items[0].evaluationId);
  const model: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false }, generate: async input => ({ text: JSON.stringify({ selections: (JSON.parse(input.messages[1].content).evidence as Row[]).map(item => item.selectionId) }), attemptId: '', usage: null, finishReason: null, providerRequestId: null }) };
  const lease = await claimJob(); assert.ok(lease); await processAnswer(lease, { model });
  const done = await progress(prepared.batchId); assert.equal(done.items[0].status, 'succeeded'); assert.equal(done.items[0].awaitingReconciliation, true);
  assert.equal((await ops.read(prepared.items[0].evaluationId)).structural!.passed, true);
  // Published validity is immutable. Exercise actual clock expiry, never bypass or disable its trigger.
  const deadline = Date.now() + 150000;
  while (!(await withTenantTransaction(eid, tx => one(tx, sql`select now()>=${expiresAt}::timestamptz expired`)))!.expired) {
    assert.ok(Date.now() < deadline, 'bounded wait for immutable published-source expiry');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const expired = await progress(prepared.batchId); assert.equal(expired.contextChanged, false); assert.equal(expired.items[0].status, 'source_changed'); assert.equal(expired.items[0].runId, null);
  assert.equal((await ops.read(prepared.items[0].evaluationId)).available, false);
});

test('current database status and menu revoke batch history/read despite a still-valid signed session', async () => {
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where id=${identities[0].id}`));
  assert.equal((await request(['batches'])).status, 403); assert.equal((await request(['batches', batch.batchId])).status, 403);
  for (const index of [2, 3]) {
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=true where id=${identities[index].id}`));
    assert.equal((await request(['batches'], undefined, index)).status, 403);
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set must_change_password=false,status='disabled' where id=${identities[index].id}`));
    assert.equal((await request(['batches'], undefined, index)).status, 403);
  }
});
