import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { consultationLongProfile, consultationCashAuthorization, consultationTariffVersion, consultationUnknownIsolation } from '@/lib/assistant/contracts/consultation';
import type { MeteredConsultationBinding } from '@/lib/assistant/agent/consultation-profile';
import { consultationBudgetSnapshot, reserveConsultationDispatch } from '@/lib/assistant/agent/consultation-usage';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const prefix='synthetic-consult-allocation-'+randomUUID();
let enterpriseId='',userId='';
const binding: MeteredConsultationBinding={profile:consultationLongProfile.id,stage:'R1',budgetGroup:prefix,
  metered:{authorization:consultationCashAuthorization,cashLimitMicros:5000000,tariff:consultationTariffVersion,
    scenarioTokenLimit:60000,isolatedUnknownAuthorization:consultationUnknownIsolation.authorization}};
const actor=():ActorContext=>({enterpriseId,principal:{kind:'user',userId},contextVersion:1,capabilities:['assistant.chat.self']});
const code=(expected:string)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'code'in error&&error.code===expected);
const settings=(consultation:MeteredConsultationBinding)=>({runtime:'langgraph-v1',providerKey:'bailian',model:consultationLongProfile.model,
  tools:true,imageInput:false,probeVersion:'synthetic-allocation-no-provider',consultation});
async function pending(consultation:MeteredConsultationBinding){
  await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(settings(consultation))}::jsonb where enterprise_id=${enterpriseId}`));
  const chat=new ConversationService(actor()),conversation=await chat.create(randomUUID());
  const sent=await chat.send(String(conversation.id),randomUUID(),{version:1,blocks:[{type:'text',text:'合成预算协议检查，不进行模型调用。'}]});
  const run=await withTenantTransaction(enterpriseId,tx=>one(tx,sql`select created_at from app.assistant_runs where enterprise_id=${enterpriseId} and id=${String(sent.runId)}`));
  return {enterpriseId,runId:String(sent.runId),binding:consultation,createdAt:String(run!.created_at),purpose:'answer' as const};
}
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    userId=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
      values(${enterpriseId},true,100,1000000,5000000,30,${JSON.stringify(settings(binding))}::jsonb)`);
  });
});
after(async()=>{
  if(enterpriseId)await withTenantTransaction(enterpriseId,async tx=>{
    await tx.execute(sql`update app.assistant_jobs set status='cancelled' where enterprise_id=${enterpriseId} and status in ('queued','running')`);
    await tx.execute(sql`update app.assistant_runs set status='cancelled' where enterprise_id=${enterpriseId} and status in ('queued','running')`);
    await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
    assert.equal(Number((await one(tx,sql`select count(*) count from app.ai_provider_attempts where enterprise_id=${enterpriseId}`))!.count),0);
  });
  await closePostgresPool();
});

test('real reservations share a chain envelope across runs while another chain keeps its own allocation',async()=>{
  const first=await pending(binding);
  await withTenantTransaction(enterpriseId,tx=>reserveConsultationDispatch(tx,{...first,estimatedRequestTokens:60000}));
  const same=await pending(binding);
  await withTenantTransaction(enterpriseId,async tx=>{
    await assert.rejects(reserveConsultationDispatch(tx,{...same,estimatedRequestTokens:1}),code('assistant_quota_exceeded'));
    const snapshot=await consultationBudgetSnapshot(tx,{enterpriseId,binding});
    assert.equal(snapshot.scenarioHeldTokens,60000);assert.equal(snapshot.heldTokens,60000);
  });
  const otherBinding={...binding,budgetGroup:prefix+'-second'},other=await pending(otherBinding);
  await withTenantTransaction(enterpriseId,async tx=>{
    await reserveConsultationDispatch(tx,{...other,estimatedRequestTokens:60000});
    const snapshot=await consultationBudgetSnapshot(tx,{enterpriseId,binding:otherBinding});
    assert.equal(snapshot.scenarioHeldTokens,60000);assert.equal(snapshot.heldTokens,120000);
    assert.equal(snapshot.heldCostMicros,576000);
  });
});

test('a new unknown stops dispatch despite the configured isolation flag and spare campaign budget',async()=>{
  const freshBinding={...binding,budgetGroup:prefix+'-new-unknown'},unknown=await pending(freshBinding);
  await withTenantTransaction(enterpriseId,async tx=>{
    await reserveConsultationDispatch(tx,{...unknown,estimatedRequestTokens:10000});
    await tx.execute(sql`update app.assistant_runs set status='indeterminate',error_code='provider_outcome_unknown' where enterprise_id=${enterpriseId} and id=${unknown.runId}`);
    await tx.execute(sql`update app.assistant_quota_reservations set status='reconciling' where enterprise_id=${enterpriseId} and run_id=${unknown.runId}`);
  });
  const next=await pending({...binding,budgetGroup:prefix+'-after-unknown'});
  await withTenantTransaction(enterpriseId,async tx=>{
    const snapshot=await consultationBudgetSnapshot(tx,{enterpriseId,binding:next.binding});
    assert.equal(snapshot.unknownUsage,true);assert.equal(snapshot.isolatedUnknownAuthorization,undefined);
    await assert.rejects(reserveConsultationDispatch(tx,{...next,estimatedRequestTokens:1}),code('provider_outcome_unknown'));
    assert.equal(Number((await one(tx,sql`select reserved_tokens from app.assistant_quota_reservations where enterprise_id=${enterpriseId} and run_id=${next.runId}`))!.reserved_tokens),0);
  });
});
