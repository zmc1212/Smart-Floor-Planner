import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { UsageService } from '@/lib/assistant/core/usage';
import { claimJob, markProviderStarted, failRun } from '@/lib/assistant/infrastructure/job-queue';
import { consultationBudgetSnapshot, reserveConsultationDispatch } from '@/lib/assistant/agent/consultation-usage';
import { consultationScenarioPreflight, type MeteredConsultationBinding } from '@/lib/assistant/agent/consultation-profile';
import { consultationLongProfile, consultationCashAuthorization, consultationTariffVersion } from '@/lib/assistant/contracts/consultation';
import type { ActorContext } from '@/lib/assistant/contracts';

// Protocol/accounting fixtures only. No provider adapter, inference or bill lookup.
const prefix = 'synthetic-consultation-recovery-' + randomUUID();
const fixtures: Array<{ enterpriseId: string; userId: string }> = [];
const binding: MeteredConsultationBinding = { profile: consultationLongProfile.id, stage: 'R1', budgetGroup: prefix,
  metered: { authorization: consultationCashAuthorization, cashLimitMicros: 5000000, tariff: consultationTariffVersion } };
const content = (text: string) => ({ version: 1 as const, blocks: [{ type: 'text' as const, text }] });
before(() => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const f of fixtures) {
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null
          where enterprise_id=${f.enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='cancelled' where enterprise_id=${f.enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
        assert.equal((await one(tx, sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f.enterpriseId}`))!.n, 0);
      }
    });
  } finally { await closePostgresPool(); }
});
async function fixture() {
  const label = prefix + fixtures.length;
  const f = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${label},${label},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${label},1) returning id`))!.id);
    fixtures.push({ enterpriseId, userId });
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${label})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,3000000,100000000,30,${JSON.stringify({runtime:'langgraph-v1',providerKey:'bailian',model:consultationLongProfile.model,
        tools:true,imageInput:false,probeVersion:'synthetic-no-provider',consultation:binding})}::jsonb)`);
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${label},'synthetic-only','enterprise_admin','active',ARRAY['assistant-usage','assistant-usage-reconcile'],false) returning id`))!.id);
    return { enterpriseId, userId, adminId };
  });
  const actor: ActorContext = { enterpriseId:f.enterpriseId,principal:{kind:'user',userId:f.userId},contextVersion:1,capabilities:['assistant.chat.self'] };
  const chat = new ConversationService(actor), usage = new UsageService({...actor,principal:{kind:'admin',adminId:f.adminId},capabilities:[]});
  const conversationId = String((await chat.create(randomUUID())).id);
  console.log('SYNTHETIC_RECOVERY_FIXTURE '+JSON.stringify({...f,conversationId}));
  return {...f,actor,chat,usage,conversationId};
}
async function unknown(f: Awaited<ReturnType<typeof fixture>>, observed = 100, alreadyDispatched = false) {
  const key = randomUUID(), body = content('合成协议测试：模拟已知用量之后连接中断，不调用模型。');
  const sent = await f.chat.send(f.conversationId,key,body), runId = String(sent.runId);
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId,runId);
  await withTenantTransaction(f.enterpriseId,async tx => {
    const run = (await one(tx,sql`select created_at from app.assistant_runs where id=${runId} and enterprise_id=${f.enterpriseId}`))!;
    if (alreadyDispatched) {
      // Labelled historical fixture for two outcomes already unknown before
      // review; the live dispatcher must continue to reject a second dispatch.
      await tx.execute(sql`update app.assistant_quota_reservations set reserved_tokens=1000,reserved_cost_micros=4800
        where enterprise_id=${f.enterpriseId} and run_id=${runId}`);
    } else await reserveConsultationDispatch(tx,{enterpriseId:f.enterpriseId,runId,binding,createdAt:String(run.created_at),estimatedRequestTokens:1000,purpose:'answer'});
    if (observed) await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${f.enterpriseId},${runId},${'synthetic-known:'+runId},'tokens',${observed},'observed',${observed-20},20)`);
  });
  // Records the queue boundary, without dispatching a provider request. No null
  // usage row: reproduces a transport failure before the adapter reports usage.
  await markProviderStarted(lease); await failRun(lease,'synthetic-transport-unknown');
  const q = await withTenantTransaction(f.enterpriseId,async tx => {
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now()-interval '5 minutes' where id=${lease.jobId} and enterprise_id=${f.enterpriseId}`);
    return (await one(tx,sql`select id::text,version from app.assistant_quota_reservations where enterprise_id=${f.enterpriseId} and run_id=${runId}`))!;
  });
  return {runId,key,body,q};
}
const snapshot = (f: Awaited<ReturnType<typeof fixture>>, b = binding) => withTenantTransaction(f.enterpriseId,tx => consultationBudgetSnapshot(tx,{enterpriseId:f.enterpriseId,binding:b}));
const review = (version: unknown, tokens = '175', costMicros = '1700') => ({expectedVersion:Number(version),tokens,costMicros,currency:'CNY',
  evidenceReference:'synthetic-fixture:verified-total-not-a-real-bill',reason:'Synthetic external evidence confirms both total tokens and total cost'});
const preflight = (s: Awaited<ReturnType<typeof snapshot>>, b = binding) => consultationScenarioPreflight({...s,binding:b,now:Date.now(),requestReservations:[1000]});

test('mixed known/unknown review restores new-question budget while preserving observations, original run and idempotency',async () => {
  const f=await fixture(), u=await unknown(f), before=await snapshot(f);
  assert.equal(before.observedTokens,100); assert.equal(before.heldTokens,900); assert.equal(before.unknownUsage,true);
  assert.throws(()=>preflight(before),/provider_outcome_unknown/);
  assert.equal((await f.chat.detail(f.conversationId)).latestRun?.usageReconciled,false);
  const original=await withTenantTransaction(f.enterpriseId,tx=>rows(tx,sql`select * from app.assistant_usage_records where enterprise_id=${f.enterpriseId} and run_id=${u.runId}`));
  const key=randomUUID(), body=review(u.q.version);
  const [a,b]=await Promise.all([f.usage.reconcile(String(u.q.id),body,key),f.usage.reconcile(String(u.q.id),body,key)]); assert.deepEqual(a,b);
  const settled=await snapshot(f);
  assert.equal(settled.observedTokens,100); assert.equal(settled.accountedTokens,175); assert.equal(settled.heldTokens,0);
  assert.equal(settled.knownCostMicros,1700); assert.equal(settled.heldCostMicros,0); assert.equal(settled.unknownUsage,false);
  assert.equal(preflight(settled).totalTokens,1175);
  const run=await f.chat.run(u.runId); assert.equal(run.status,'indeterminate'); assert.equal(run.errorCode,'provider_outcome_unknown');
  assert.equal(run.usageReconciled,true); assert.equal(run.retryable,false);
  assert.equal((await f.chat.detail(f.conversationId)).latestRun?.usageReconciled,true);
  await assert.rejects(f.chat.run(u.runId,'retry',randomUUID()),/context_changed/);
  assert.equal((await f.chat.send(f.conversationId,u.key,u.body)).runId,u.runId);
  const next=await f.chat.send(f.conversationId,randomUUID(),content('核账后新问题，合成服务写入验收。')); assert.notEqual(next.runId,u.runId);
  await withTenantTransaction(f.enterpriseId,async tx=>{
    const r=(await one(tx,sql`select created_at from app.assistant_runs where enterprise_id=${f.enterpriseId} and id=${String(next.runId)}`))!;
    await reserveConsultationDispatch(tx,{enterpriseId:f.enterpriseId,runId:String(next.runId),binding,createdAt:String(r.created_at),estimatedRequestTokens:1000,purpose:'answer'});
    assert.deepEqual(await rows(tx,sql`select * from app.assistant_usage_records where enterprise_id=${f.enterpriseId} and run_id=${u.runId}`),original);
    assert.equal((await one(tx,sql`select count(*)::int n from app.assistant_cost_reviews where enterprise_id=${f.enterpriseId} and reservation_id=${String(u.q.id)}`))!.n,1);
  });
  await f.chat.run(String(next.runId),'cancel',randomUUID());
});

test('zero confirmed consumption clears only audited hold, never rewrites unknown history as observed zero',async()=>{
  const f=await fixture(), u=await unknown(f,0);
  await f.usage.reconcile(String(u.q.id),review(u.q.version,'0','0'),randomUUID());
  const s=await snapshot(f); assert.equal(s.observedTokens,0); assert.equal(s.accountedTokens,0); assert.equal(s.heldTokens,0); assert.equal(s.unknownUsage,false);
  assert.equal(preflight(s).totalTokens,1000); assert.equal((await f.chat.run(u.runId)).status,'indeterminate');
});

test('settled status without matching immutable review remains blocked',async()=>{
  const f=await fixture(), u=await unknown(f);
  await withTenantTransaction(f.enterpriseId,tx=>tx.execute(sql`update app.assistant_quota_reservations set status='settled',settled_tokens=100,settled_cost_micros=0
    where enterprise_id=${f.enterpriseId} and id=${String(u.q.id)}`));
  const s=await snapshot(f); assert.equal(s.unknownUsage,true); assert.equal(s.heldTokens,900);
  assert.equal((await f.chat.run(u.runId)).usageReconciled,false); assert.throws(()=>preflight(s),/provider_outcome_unknown/);
});

test('reviewed totals persist across budget dates, stages and groups, above-reservation tokens still enforce campaign cap',async()=>{
  const f=await fixture(), u=await unknown(f);
  await f.usage.reconcile(String(u.q.id),review(u.q.version,'1000000','5000000'),randomUUID());
  await withTenantTransaction(f.enterpriseId,tx=>tx.execute(sql`update app.assistant_quota_reservations set budget_date=(now() at time zone 'UTC')::date-1
    where enterprise_id=${f.enterpriseId} and id=${String(u.q.id)}`));
  const other={...binding,stage:'R4' as const,budgetGroup:prefix+'-other'};
  const s=await snapshot(f,other); assert.equal(s.accountedTokens,1000000); assert.equal(s.knownCostMicros,5000000); assert.equal(s.unknownUsage,false);
  assert.throws(()=>preflight(s,other),/assistant_quota_exceeded/);
});

test('one reviewed run does not clear another unresolved run or permit totals below observed usage',async()=>{
  const f=await fixture(), a=await unknown(f), b=await unknown(f,100,true);
  await assert.rejects(f.usage.reconcile(String(a.q.id),review(a.q.version,'99'),randomUUID()),/observed_tokens_conflict/);
  await f.usage.reconcile(String(a.q.id),review(a.q.version),randomUUID());
  assert.equal((await snapshot(f)).unknownUsage,true); assert.equal((await f.chat.run(b.runId)).usageReconciled,false);
  await f.usage.reconcile(String(b.q.id),review(b.q.version),randomUUID()); assert.equal((await snapshot(f)).accountedTokens,350);
  assert.equal((await snapshot(f)).unknownUsage,false);
});

test('fully known usage still requires exact total and audit mismatch fails closed',async()=>{
  const f=await fixture(), u=await unknown(f);
  await withTenantTransaction(f.enterpriseId,tx=>tx.execute(sql`update app.assistant_runs set status='failed',error_code='synthetic-known-failure'
    where enterprise_id=${f.enterpriseId} and id=${u.runId}`));
  await assert.rejects(f.usage.reconcile(String(u.q.id),review(u.q.version,'175'),randomUUID()),/observed_tokens_conflict/);
  await f.usage.reconcile(String(u.q.id),review(u.q.version,'100'),randomUUID());
  await withTenantTransaction(f.enterpriseId,tx=>tx.execute(sql`update app.assistant_quota_reservations set settled_tokens=101
    where enterprise_id=${f.enterpriseId} and id=${String(u.q.id)}`));
  assert.equal((await f.chat.run(u.runId)).usageReconciled,false);
});
