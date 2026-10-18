import assert from 'node:assert/strict';
import { before, after, test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { resolvePostgresRuntimeConfig, closePostgresPool } from '@/lib/postgresql';
import { AssistantError, principalKey, type ActorContext } from '@/lib/assistant/contracts';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
import { activeProfile } from '@/lib/assistant/knowledge/service';
import { answerMessages } from '@/lib/assistant/knowledge/answer';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { createKnowledgeBatchSharedPort } from '@/lib/assistant/core/evaluation-execution';
import { executionCancelOperation } from '@/lib/assistant/knowledge/batch-execution-adapter';
import { retrievalConfiguration } from '@/lib/assistant/knowledge/retrieval';
import { claimJob, failRun } from '@/lib/assistant/infrastructure/job-queue';
import { textGateway } from '@/lib/assistant/infrastructure/model-gateway';
import type { EvaluationBatchManifest } from '@/lib/assistant/knowledge/evaluation-batch';

const prefix='synthetic-execution-fence-'+randomUUID(),tenants:string[]=[],admins:string[]=[];
const evidence=process.env.ASSISTANT_EXECUTION_EVIDENCE;
let enterpriseId:string;
const actor=(index=0,tenant=enterpriseId):ActorContext=>({enterpriseId:tenant,principal:{kind:'admin',adminId:admins[index]},contextVersion:1,capabilities:['assistant.preview.self']});
const changed=(error:unknown)=>error instanceof AssistantError&&error.code==='context_changed';
const cancelled=(error:unknown)=>error instanceof AssistantError&&error.code==='batch_cancelled';
const missing={kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]};
type Prepared={actor:ActorContext;manifest:EvaluationBatchManifest;createKey:string;sendKey:string;question:string};
const service=(p:Prepared)=>new KnowledgeOperations({enterpriseId:p.actor.enterpriseId,adminId:p.actor.principal.kind==='admin'?p.actor.principal.adminId:''},createKnowledgeBatchSharedPort());
const content=(p:Prepared)=>({version:1 as const,blocks:[{type:'text' as const,text:p.question}]});
const dispatchInput=(p:Prepared):Parameters<ReturnType<typeof createKnowledgeBatchSharedPort>['dispatch']>[2]=>({createKey:p.createKey,sendKey:p.sendKey,conversationId:null,content:content(p),expectedExecutionRevision:p.manifest.executionRevision,
  context:{mode:'knowledge_preview' as const,profile:{id:p.manifest.profileId,hash:p.manifest.profileHash},retrievalConfiguration},
  batch:{batchId:p.manifest.batchId,evaluationId:p.manifest.items[0].evaluationId,manifestHash:p.manifest.hash,
    cancellation:{operation:executionCancelOperation,key:p.manifest.batchId,principalKey:principalKey(p.actor),manifestHash:p.manifest.hash}}});
async function prepared(index=0):Promise<Prepared>{
  const a=actor(index),ops=new KnowledgeOperations({enterpriseId,adminId:admins[index]},createKnowledgeBatchSharedPort());
  const question='合成测试专用：核对书房使用要求。';
  const saved=await ops.save({title:'测试专用 · '+randomUUID(),question,expectation:missing},randomUUID());
  const receipt=await ops.prepareExecutionBatch({cases:[{caseId:String(saved.id),expectedVersion:1}]},randomUUID());
  return withTenantTransaction(enterpriseId,async tx=>{
    const manifest=receipt.manifest;
    const item=await one(tx,sql`select create_key,send_key from app.assistant_knowledge_evaluations where enterprise_id=${enterpriseId} and id=${manifest.items[0].evaluationId}`);
    return {actor:a,manifest,createKey:String(item!.create_key),sendKey:String(item!.send_key),question};
  });
}
async function submit(p:Prepared){await service(p).executionBatchAdapter().resume(p.manifest,p.manifest.items[0]);
  const original=await withTenantTransaction(enterpriseId,tx=>createKnowledgeBatchSharedPort().lookupReceipt(tx,p.actor,{...dispatchInput(p),conversationId:null}));
  assert.ok(original);return original;
}
async function counts(){return withTenantTransaction(enterpriseId,async tx=>{
  const result:Record<string,number>={};
  for(const name of ['conversations','messages','runs','jobs','quota_reservations'])result[name]=Number((await one(tx,sql`select count(*)::int n from ${sql.identifier('app')}.${sql.identifier('assistant_'+name)} where enterprise_id=${enterpriseId}`))!.n);
  result.attempts=Number((await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${enterpriseId}`))!.n);
  return result;
});}
async function cleanupRun(p:Prepared,runId:string){await new ConversationService(p.actor).run(runId,'cancel','test-cleanup:'+runId);}
function finishRun(t:TestContext,p:Prepared,runId:string){t.after(()=>cleanupRun(p,runId));}
async function state(runId:string){return withTenantTransaction(enterpriseId,async tx=>({
  run:await one(tx,sql`select status,error_code from app.assistant_runs where enterprise_id=${enterpriseId} and id=${runId}`),
  job:await one(tx,sql`select status,provider_started_at from app.assistant_jobs where enterprise_id=${enterpriseId} and run_id=${runId}`),
  quota:await one(tx,sql`select status,settled_cost_micros from app.assistant_quota_reservations where enterprise_id=${enterpriseId} and run_id=${runId}`),
  attempts:await rows(tx,sql`select status,actual_cost from app.ai_provider_attempts where enterprise_id=${enterpriseId} and assistant_run_id=${runId}`),
}));}

before(async()=>{
  assert.equal(process.env.ASSISTANT_EXECUTION_LOCKED,'1','Use the canonical lock-holding execution acceptance runner');
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    const active=await one(tx,sql`select count(*)::int n from app.assistant_jobs where kind='chat_turn' and status in ('queued','running')`);
    assert.equal(Number(active!.n),0,'Do not compete with an existing isolated Worker/run');
    for(let i=0;i<2;i++)tenants.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
    enterpriseId=tenants[0];
    for(const tenant of tenants)await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${tenant},true,1000,12000000,1000000000,30)`);
    for(const role of ['enterprise_admin','enterprise_admin','admin','super_admin'])admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${role==='enterprise_admin'?enterpriseId:null},${prefix+admins.length},'unusable-synthetic',${role},'active',ARRAY['assistant-knowledge']::text[],false) returning id`))!.id));
  });
  for(const tenant of tenants)await withTenantTransaction(tenant,async tx=>activeProfile(tx,tenant,(await one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=${tenant} for update`))!,true));
});
after(async()=>{
  try{
    if(enterpriseId){const audit=await withTenantTransaction(enterpriseId,async tx=>({fixturePrefix:prefix,enterpriseIds:tenants,adminIds:admins,
      runs:await rows(tx,sql`select status,count(*)::int count from app.assistant_runs where enterprise_id=${enterpriseId} group by status`),
      attempts:await rows(tx,sql`select status,count(*)::int count from app.ai_provider_attempts where enterprise_id=${enterpriseId} group by status`),
      reservations:await rows(tx,sql`select status,count(*)::int count from app.assistant_quota_reservations where enterprise_id=${enterpriseId} group by status`),
      mode:'real isolated transactions, mocked provider HTTP only; no paid text/Embedding; unknown cost is not zero'}));
      if(evidence)fs.writeFileSync(path.join(evidence,'transaction-audit.json'),JSON.stringify(audit,null,2));}
    await withPlatformTransaction(async tx=>{for(const tenant of tenants){await deleteAssistantData(tx,BigInt(tenant));await tx.execute(sql`delete from app.admin_users where enterprise_id=${tenant}`);await tx.execute(sql`delete from app.enterprises where id=${tenant}`);}for(const admin of admins)await tx.execute(sql`delete from app.admin_users where id=${admin}`);});
  }finally{await closePostgresPool();}
});

test('enterprise owner and both platform management roles bind their own actual preview configuration without employee membership',async()=>{
  for(const index of [0,2,3]){const p=await prepared(index);const first=await service(p).prepareExecutionBatch({cases:[{caseId:p.manifest.items[0].caseId,expectedVersion:1}]},p.manifest.batchId);assert.deepEqual(first.manifest,p.manifest);assert.match(first.manifest.executionRevision,/^[a-f0-9]{64}$/);}
});
test('a bound transaction rollback removes conversation, message, run, job, reservation and original receipts together',async()=>{
  const p=await prepared(),before=await counts();
  await assert.rejects(withTenantTransaction(enterpriseId,async tx=>{
    await createKnowledgeBatchSharedPort().dispatch(tx,p.actor,dispatchInput(p));
    throw Error('synthetic rollback after send');
  }),/synthetic rollback/);
  assert.deepEqual(await counts(),before);
  assert.equal((await new ConversationService(p.actor).originalSubmission(p)).submission,'not_created');
});
test('a committed original send with no evaluation run link recovers through read-only receipts',async t=>{
  const p=await prepared(),sent=await withTenantTransaction(enterpriseId,tx=>createKnowledgeBatchSharedPort().dispatch(tx,p.actor,dispatchInput(p)));finishRun(t,p,String(sent.runId));const before=await counts();
  const evaluation=await withTenantTransaction(enterpriseId,tx=>one(tx,sql`select run_id from app.assistant_knowledge_evaluations where enterprise_id=${enterpriseId} and id=${p.manifest.items[0].evaluationId}`));
  assert.equal(evaluation!.run_id,null);
  for(let i=0;i<3;i++){const original=await new ConversationService(p.actor).originalSubmission(p);assert.equal(original.submission,'sent');assert.equal(original.runId,String(sent.runId));}
  await service(p).executionBatchAdapter().resume(p.manifest,p.manifest.items[0]);
  assert.equal(String((await withTenantTransaction(enterpriseId,tx=>one(tx,sql`select run_id from app.assistant_knowledge_evaluations where enterprise_id=${enterpriseId} and id=${p.manifest.items[0].evaluationId}`)))!.run_id),sent.runId);
  assert.deepEqual(await counts(),before);
});
test('persisted whole-batch cancellation rejects all-pending dispatch and remains available after configuration/source drift',async()=>{
  const p=await prepared(),before=await counts();
  await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${enterpriseId}`));
  await service(p).cancelExecutionBatch(p.manifest.batchId,randomUUID());
  const intent=await withTenantTransaction(enterpriseId,tx=>one(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${enterpriseId}
    and principal_key=${principalKey(p.actor)} and operation=${executionCancelOperation} and key=${p.manifest.batchId}`));assert.equal((intent!.result as Row).cancelled,true);
  await assert.rejects(submit(p),cancelled);assert.deepEqual(await counts(),before);
});
test('other owner, selected tenant and revoked participant cannot use a frozen batch or original receipt',async()=>{
  const p=await prepared();
  for(const a of [actor(1),actor(2,tenants[1])])await assert.rejects(withTenantTransaction(a.enterpriseId,tx=>createKnowledgeBatchSharedPort().dispatch(tx,a,dispatchInput(p))),error=>error instanceof AssistantError&&[403,404].includes(error.status));
  const sent=await submit(p);await cleanupRun(p,String(sent.runId));
  await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_participants set status='revoked' where enterprise_id=${enterpriseId} and conversation_id=${String(sent.conversationId)}`));
  await assert.rejects(new ConversationService(p.actor).originalSubmission(p),error=>error instanceof AssistantError&&error.status===404);
});
test('actual deployment model drift fails before attempt, marker and provider HTTP',async t=>{
  const p=await prepared(),sent=await submit(p),runId=String(sent.runId);finishRun(t,p,runId);
  const lease=await claimJob();assert.equal(lease?.runId,runId);
  const prior=process.env.ASSISTANT_TEXT_MODEL;t.after(()=>{if(prior===undefined)delete process.env.ASSISTANT_TEXT_MODEL;else process.env.ASSISTANT_TEXT_MODEL=prior;});
  process.env.ASSISTANT_TEXT_MODEL='synthetic-different-effective-model';let http=0;
  t.mock.method(globalThis,'fetch',async()=>{http++;throw Error('should not dispatch');});
  await assert.rejects(textGateway(lease!).generate({enterpriseId,owner:{kind:'assistant_run',runId:BigInt(runId)},messages:answerMessages(p.question,[],[]),maxTokens:2048}),changed);
  assert.equal(http,0);const result=await state(runId);assert.equal(result.attempts.length,0);assert.equal(result.job!.provider_started_at,null);
  await failRun(lease!,'context_changed',true);
});
test('cancel intent after claim wins atomically before provider attempt/start',async t=>{
  const p=await prepared(),sent=await submit(p),runId=String(sent.runId);finishRun(t,p,runId);const lease=await claimJob();assert.equal(lease?.runId,runId);
  const interrupted={...createKnowledgeBatchSharedPort(),cancelRun:async()=>{throw Error('synthetic cancellation receipt interruption');}};
  await new KnowledgeOperations({enterpriseId,adminId:admins[0]},interrupted).cancelExecutionBatch(p.manifest.batchId,randomUUID());let http=0;
  t.mock.method(globalThis,'fetch',async()=>{http++;throw Error('should not dispatch');});
  await assert.rejects(textGateway(lease!).generate({enterpriseId,owner:{kind:'assistant_run',runId:BigInt(runId)},messages:answerMessages(p.question,[],[]),maxTokens:2048}),cancelled);
  assert.equal(http,0);const result=await state(runId);assert.equal(result.attempts.length,0);assert.equal(result.job!.provider_started_at,null);
  await cleanupRun(p,runId);
  assert.equal((await new ConversationService(p.actor).run(runId)).retryable,false);
  await assert.rejects(new ConversationService(p.actor).run(runId,'retry',randomUUID()),changed);
});
test('ordinary non-batch known pre-provider cancellation keeps the existing explicit retry path',async t=>{
  const p=await prepared(),chat=new ConversationService(p.actor),c=await chat.create(randomUUID());
  const sent=await chat.send(String(c.id),randomUUID(),{version:1,blocks:[{type:'text',text:p.question}]});
  await chat.run(String(sent.runId),'cancel',randomUUID());
  const next=await chat.run(String(sent.runId),'retry',randomUUID()) as Row;assert.notEqual(next.runId,sent.runId);finishRun(t,p,String(next.runId));
});
test('provider-start wins before cancellation: original unknown attempt and reconciling costs stay unresolved',async t=>{
  const p=await prepared(),sent=await submit(p),runId=String(sent.runId);finishRun(t,p,runId);const lease=await claimJob();assert.equal(lease?.runId,runId);
  let entered!:()=>void,finish!:()=>void;const dispatch=new Promise<void>(resolve=>{entered=resolve;}),complete=new Promise<void>(resolve=>{finish=resolve;});let http=0;
  t.mock.method(globalThis,'fetch',async()=>{http++;entered();await complete;return new Response('synthetic unknown 504',{status:504});});
  const pending=textGateway(lease!).generate({enterpriseId,owner:{kind:'assistant_run',runId:BigInt(runId)},messages:answerMessages(p.question,[],[]),maxTokens:2048});
  t.after(async()=>{finish();await pending.catch(()=>{});});
  const rejection=assert.rejects(pending);await Promise.race([dispatch,pending.then(()=>{throw Error('Expected provider HTTP barrier');},error=>{throw error;})]);
  await service(p).cancelExecutionBatch(p.manifest.batchId,randomUUID());
  finish();await rejection;assert.equal(http,1);
  const result=await state(runId);assert.equal(result.run!.status,'cancelled');assert.ok(result.job!.provider_started_at);assert.equal(result.attempts[0].status,'unknown');assert.deepEqual(result.attempts[0].actual_cost,{});assert.equal(result.quota!.status,'reconciling');assert.equal(result.quota!.settled_cost_micros,null);
  await assert.rejects(new ConversationService(p.actor).run(runId,'retry',randomUUID()),changed);assert.equal(http,1);
});

test('knowledge cancellation marks only authoritative not-dispatched items without inventing a run ID',async()=>{
  const p=await prepared(),before=await counts();await service(p).cancelExecutionBatch(p.manifest.batchId,randomUUID());
  const observed=await service(p).executionBatchAdapter().observe(p.manifest,p.manifest.items[0]);
  assert.equal(observed.status,'cancelled');assert.equal(observed.runId,null);assert.equal(observed.cancelledBeforeDispatch,true);
  assert.deepEqual(await counts(),before);
});
test('case revision drift after enqueue rejects the provider start before a new attempt or HTTP',async t=>{
  const p=await prepared(),sent=await submit(p),runId=sent.runId;finishRun(t,p,runId);const lease=await claimJob();assert.equal(lease?.runId,runId);
  await withTenantTransaction(enterpriseId,tx=>tx.execute(sql`update app.assistant_knowledge_cases set revision=revision+1 where enterprise_id=${enterpriseId} and id=${p.manifest.items[0].caseId}`));let http=0;
  t.mock.method(globalThis,'fetch',async()=>{http++;throw Error('should not dispatch');});
  await assert.rejects(textGateway(lease!).generate({enterpriseId,owner:{kind:'assistant_run',runId:BigInt(runId)},messages:answerMessages(p.question,[],[]),maxTokens:2048}),changed);
  assert.equal(http,0);const result=await state(runId);assert.equal(result.attempts.length,0);assert.equal(result.job!.provider_started_at,null);
  await failRun(lease!,'context_changed',true);
});
