// Loaded only by the explicit, locked, SHA/factory-verified service driver.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '../../src/db/transaction';
import { one, rows } from '../../src/db/repositories/assistant-repository';
import { deleteAssistantData } from '../../src/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '../../src/lib/postgresql';
import { KnowledgeOperations } from '../../src/lib/assistant/knowledge/operations';
import { activeProfile } from '../../src/lib/assistant/knowledge/service';
import { claimJob, failRun } from '../../src/lib/assistant/infrastructure/job-queue';
import type { KnowledgeBatchSharedPort, BatchCancellationIntent } from '../../src/lib/assistant/knowledge/batch-execution-adapter';
import type { PostgresTransaction } from '../../src/db/transaction';
import type { AcceptanceSnapshot } from './types';

export async function assertIsolatedRuntime() {
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  if(!['localhost','127.0.0.1'].includes(target.hostname)||target.port!=='55432'||target.pathname!=='/xiaok_embedding_eval')throw Error('SEAM_ISOLATED_DATABASE_REQUIRED');
  const application=process.env.XIAOK_SEAM_LOCK_APPLICATION;
  if(!application||!process.env.XIAOK_SEAM_LOCK_OWNER)throw Error('SEAM_LOCK_REQUIRED');
  await withPlatformTransaction(async tx=>{
    const role=await one(tx,sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
    if(!role||role.rolsuper||role.rolbypassrls)throw Error('SEAM_APPLICATION_ROLE_REQUIRED');
    const owner=await one(tx,sql`select count(*)::int n from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where l.locktype='advisory' and l.granted and a.application_name=${application}
      and a.datname=current_database() and a.pid<>pg_backend_pid()`);
    if(Number(owner?.n)!==1)throw Error('SEAM_LOCK_OWNER_MISSING');
  });
}

export async function createPostgresFixture(factoryModule: string, factoryExport: string, saveIdentity: (value: unknown) => void) {
  if (!process.env.XIAOK_SEAM_LOCK_OWNER) throw Error('SEAM_LOCK_REQUIRED');
  await assertIsolatedRuntime();
  const factory = (await import(factoryModule))[factoryExport];
  if (typeof factory !== 'function') throw Error('SEAM_FACTORY_NOT_READY');
  const shared: KnowledgeBatchSharedPort<PostgresTransaction> = await factory();
  for (const name of ['executionRevision', 'lookupReceipt', 'dispatch', 'observeRun', 'cancelRun'] as const)
    if (typeof shared?.[name] !== 'function') throw Error('SEAM_FACTORY_NOT_READY');
  const prefix = 'synthetic-kb-seam-' + randomUUID();
  let enterpriseId = '', adminId = '';
  const known = new Map<string, { runId: string; conversationId: string }>();
  const save = () => saveIdentity({ prefix, enterpriseIds: enterpriseId ? [enterpriseId] : [], adminIds: adminId ? [adminId] : [] });
  let operations: KnowledgeOperations;
  const caseIds: string[] = [];
  async function cleanup() {
    if (!enterpriseId) { await closePostgresPool(); return { audited: [], remaining: [] }; }
    try {
      const audited = await withPlatformTransaction(async tx => ({
        runs: await rows(tx, sql`select r.id::text,r.status,exists(select 1 from app.assistant_quota_reservations q
          where q.enterprise_id=r.enterprise_id and q.run_id=r.id and q.status='reconciling') awaiting_reconciliation
          from app.assistant_runs r where r.enterprise_id=${enterpriseId} order by r.id`),
        providerAttempts: await rows(tx, sql`select id::text,status,actual_cost from app.ai_provider_attempts where enterprise_id=${enterpriseId} order by id`),
        reservations: await rows(tx, sql`select run_id::text,status,settled_tokens::text,settled_cost_micros::text from app.assistant_quota_reservations where enterprise_id=${enterpriseId} order by id`),
      }));
      // Audit is returned/saved before exact fixture deletion, even on a failed assertion.
      saveIdentity({ prefix, enterpriseIds: [enterpriseId], adminIds: adminId ? [adminId] : [], beforeCleanup: audited, costMicros: null });
      await withPlatformTransaction(async tx => {
        await deleteAssistantData(tx, BigInt(enterpriseId));
        if (adminId) await tx.execute(sql`delete from app.admin_users where id=${adminId} and username like ${prefix + '%'}`);
        await tx.execute(sql`delete from app.enterprises where id=${enterpriseId} and code=${prefix}`);
      });
      const remaining = await withPlatformTransaction(async tx => {
        const tables = await rows(tx, sql`select c.table_name from information_schema.columns c
          join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
          where c.table_schema='app' and c.column_name='enterprise_id' and t.table_type='BASE TABLE' order by c.table_name`);
        const result = [];
        for (const table of tables) result.push({ table: String(table.table_name), count: Number((await one(tx,
          sql`select count(*)::int n from ${sql.identifier('app')}.${sql.identifier(String(table.table_name))} where enterprise_id=${enterpriseId}`))!.n) });
        result.push({ table: 'enterprises', count: Number((await one(tx, sql`select count(*)::int n from app.enterprises where id=${enterpriseId}`))!.n) });
        if (adminId) result.push({ table: 'admin_users_id', count: Number((await one(tx, sql`select count(*)::int n from app.admin_users where id=${adminId}`))!.n) });
        return result;
      });
      assert.ok(remaining.every(row => row.count === 0), 'SEAM_FIXTURE_CLEANUP_INCOMPLETE');
      return { audited, remaining };
    } finally { await closePostgresPool(); }
  }
  try {
    await withPlatformTransaction(async tx => {
      enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id); save();
      adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${enterpriseId},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge']::text[],false) returning id`))!.id); save();
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${enterpriseId},true,100,12000000,1000000000,30)`);
    });
    await withTenantTransaction(enterpriseId, async tx => activeProfile(tx, enterpriseId,
      (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${enterpriseId} for update`))!, true));
    operations = new KnowledgeOperations({ enterpriseId, adminId }, shared);
    for (let i = 0; i < 2; i++) caseIds.push(String((await operations.save({ title: '测试专用 · 接缝 ' + i,
      question: '合成接缝验收，没有企业资料时明确待核实，不调用实际模型。',
      expectation: { kind: 'missing', requiredDocumentIds: [], forbiddenDocumentIds: [] } }, randomUUID())).id));
  } catch (error) { await cleanup(); throw error; }
  async function prepare() {
    return (await operations.prepareExecutionBatch({ cases: caseIds.map(caseId => ({ caseId, expectedVersion: 1 })), concurrency: 1 }, randomUUID())).manifest;
  }
  async function snapshot(batchId: string, events: Array<{ name: string }>):Promise<AcceptanceSnapshot> {
    const { manifest } = await operations.executionBatchAdapter().receipt(batchId), first = manifest.items[0];
    return withTenantTransaction(enterpriseId, async tx => {
      const e = (await one(tx, sql`select * from app.assistant_knowledge_evaluations where enterprise_id=${enterpriseId} and id=${first.evaluationId}`))!;
      if (e.run_id && e.conversation_id) known.set(batchId, { runId: String(e.run_id), conversationId: String(e.conversation_id) });
      const runId = known.get(batchId)?.runId;
      const run = runId ? await one(tx, sql`select status from app.assistant_runs where enterprise_id=${enterpriseId} and id=${runId}`) : null;
      const reservation = runId ? await one(tx, sql`select status from app.assistant_quota_reservations where enterprise_id=${enterpriseId} and run_id=${runId}`) : null;
      const counts: Record<string, number> = {};
      for (const [name, table] of [['runs', 'assistant_runs'], ['jobs', 'assistant_jobs'], ['reservations', 'assistant_quota_reservations'], ['providerAttempts', 'ai_provider_attempts']])
        counts[name] = Number((await one(tx, sql`select count(*)::int n from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`))!.n);
      counts.providerMarkers = Number((await one(tx, sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${enterpriseId} and provider_started_at is not null`))!.n);
      const intents = await rows(tx, sql`select result from app.assistant_idempotency_records where enterprise_id=${enterpriseId}
        and principal_key=${'admin:' + adminId} and operation='knowledge-batch-execution-cancel' and key=${batchId}`);
      const intent=intents[0]?.result as BatchCancellationIntent|undefined;
      if(intent){assert.equal(intent.cancelled,true);assert.equal(intent.batchId,batchId);assert.equal(intent.manifestHash,manifest.hash);}
      return { counts, intent: intent ?? null, intentCount: intents.length, dispatchCalls: events.filter(e => e.name === 'dispatch').length,
        providerFetches: 0, runId: e.run_id ? String(e.run_id) : null, conversationId: e.conversation_id ? String(e.conversation_id) : null,
        createKey: String(e.create_key), sendKey: String(e.send_key), runStatus: run?.status?String(run.status):undefined,
        reservationStatus: reservation?.status?String(reservation.status):undefined, costMicros: null };
    });
  }
  async function loseAssociation(batchId: string) {
    const { manifest } = await operations.executionBatchAdapter().receipt(batchId), item = manifest.items[0], original = known.get(batchId);
    assert.ok(original);
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.enterpriseId, enterpriseId); assert.equal(lease.runId, original.runId);
    // Clearly synthetic provider-boundary marker, matching the existing approved cancellation fixture. No HTTP took place.
    await withTenantTransaction(enterpriseId, tx => tx.execute(sql`update app.assistant_jobs set provider_started_at=now() where enterprise_id=${enterpriseId} and id=${lease.jobId}`));
    await failRun(lease, 'synthetic_seam_no_http_boundary', false);
    await withTenantTransaction(enterpriseId, tx => tx.execute(sql`update app.assistant_knowledge_evaluations set conversation_id=null,run_id=null
      where enterprise_id=${enterpriseId} and created_by=${adminId} and id=${item.evaluationId} and run_id=${original.runId}`));
  }
  async function leaseFor(batchId: string) {
    const expected = known.get(batchId); assert.ok(expected);
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.enterpriseId, enterpriseId); assert.equal(lease.runId, expected.runId);
    return lease;
  }
  async function routeAfterCancellation(batchId:string){
    if(!process.env.JWT_SECRET)throw Error('SEAM_AUTH_SECRET_REQUIRED');
    const {SignJWT}=await import('jose'),{NextRequest}=await import('next/server');
    const {POST}=await import('../../src/app/api/assistant/knowledge/operations/[...path]/route');
    const {manifest}=await operations.executionBatchAdapter().receipt(batchId),evaluationId=manifest.items[0].evaluationId;
    const token=await new SignJWT({id:adminId,role:'enterprise_admin',enterpriseId,permissions:[]}).setProtectedHeader({alg:'HS256'})
      .setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const request=new NextRequest('http://localhost:3007/api/assistant/knowledge/operations/evaluations/'+evaluationId+'/resume',{
      method:'POST',headers:{cookie:`auth_token=${token}; global_tenant_id=${enterpriseId}`,'idempotency-key':randomUUID()},body:'{}'});
    const response=await POST(request,{params:Promise.resolve({path:['evaluations',evaluationId,'resume']})});
    const body=await response.json();assert.equal(response.status,409);assert.equal(body.error,'batch_cancelled');
    assert.equal(response.headers.get('cache-control'),'no-store');
    return{status:response.status,error:String(body.error)};
  }
  return { actor: operations.actor, prepare, snapshot, loseAssociation, leaseFor, routeAfterCancellation, cleanup };
}
