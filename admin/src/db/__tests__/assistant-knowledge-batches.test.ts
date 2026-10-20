import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { advanceKnowledgeBatches } from '@/lib/assistant/knowledge/batch-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { claimJob, markProviderStarted } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import type { TextModelGateway } from '@/lib/assistant/contracts';

const prefix='synthetic-kb4-batches-'+randomUUID(),tenants:string[]=[],admins:string[]=[];
let eid:string,aid:string,other:string,ops:KnowledgeOperations,knowledge:KnowledgeService,documentId:string;
const body='合成批量回归资料：书房靠窗办公先核对屏幕眩光和通道，插座点位由设计师核对；不代表本项目检查或批准。';
const question='书房靠窗办公的眩光、通道和插座点位应核对什么？';
const model:TextModelGateway={capabilities:{streaming:false,toolCalling:false,usage:false},generate:async input=>{
  const evidence=JSON.parse(input.messages[1].content).evidence as Row[];
  return {text:JSON.stringify({selections:evidence.map(e=>e.selectionId)}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};
}};
const op=(action:string,input:Row)=>knowledge.execute(action,input,randomUUID());
const batch=(id:string)=>ops.batches().read(id) as Promise<Row>;
async function cases(n=3) {
  const result:Row[]=[];
  for(let i=0;i<n;i++)result.push(await ops.save({title:'合成批次题 '+i,question,expectation:{kind:'grounded',requiredDocumentIds:[documentId],forbiddenDocumentIds:[]}},randomUUID()));
  return result;
}
const input=(c:Row[],concurrency=1)=>({title:'测试专用 · 批量知识回归',concurrency,cases:c.map(c=>({id:String(c.id),expectedVersion:Number(c.version)}))});
async function create(n=3,concurrency=1) {const c=await cases(n),result=await ops.batches().create(input(c,concurrency),randomUUID());return {id:result.batchId,c};}
async function finish(evaluationId:string) {
  const d=await ops.read(evaluationId),lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,d.run!.id);
  await processAnswer(lease,{model});assert.equal((await ops.read(evaluationId)).structural?.passed,true);
}
async function finishBatch(id:string) {
  for(let i=0;i<12;i++) {
    await ops.batches().advance(id);const d=await batch(id);assert.equal(d.available,true);
    if(d.state==='completed')return d;
    const next=(d.items as Row[]).find(e=>e.status==='queued');assert.ok(next,JSON.stringify(d));await finish(String(next.evaluationId));
  }
  assert.fail('Bounded synthetic batch did not complete');
}
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++)tenants.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));eid=tenants[0];
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,1000,12000000,1000000000,30)`);
    for(let i=0;i<2;i++)admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${eid},${prefix+i},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id));aid=admins[0];other=admins[1];
  });
  ops=new KnowledgeOperations({enterpriseId:eid,adminId:aid});knowledge=new KnowledgeService({enterpriseId:eid,adminId:aid});
  const created=await op('create',{title:'合成批次知识',sourceType:'manual_text',audience:'customer_public',body});
  const d={documentId:String((created.document as Row).id),versionId:String((created.draft as Row).id),expectedVersion:1,expectedEditVersion:1};documentId=d.documentId;
  const indexed=await op('index',d),lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,indexed.jobId);await runKnowledgeJob(lease);await op('publish',d);
});
after(async()=>{try{await withPlatformTransaction(async tx=>{
  for(const t of tenants){await deleteAssistantData(tx,BigInt(t));await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`);await tx.execute(sql`delete from app.enterprises where id=${t}`);}
  for(const a of admins)await tx.execute(sql`delete from app.admin_users where id=${a}`);
});}finally{await closePostgresPool();}});

test('K11 batch freezes all cases atomically, retains original keys on duplicate create and stays private to its manager',async()=>{
  const c=await cases(),data=input(c),key=randomUUID();
  const first=await ops.batches().create(data,key),again=await ops.batches().create(data,key);assert.equal(again.batchId,first.batchId);
  const reopened=await new KnowledgeOperations({enterpriseId:eid,adminId:aid}).batches().read(first.batchId) as Row;
  assert.equal(reopened.available,true);assert.equal((reopened.items as Row[]).length,3);assert.ok(reopened.configuration);
  await assert.rejects(ops.batches().create({...data,title:'different'},key),/idempotency_conflict/);
  const before=await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.assistant_knowledge_evaluations where enterprise_id=${eid}`));
  const invalid=input(c);invalid.cases[1].expectedVersion=99;
  await assert.rejects(ops.batches().create(invalid,randomUUID()),/version_conflict/);
  for(const invalid of [{...data,cases:[]},{...data,cases:Array.from({length:21},()=>data.cases[0])},{...data,cases:[data.cases[0],data.cases[0]]},{...data,concurrency:4}])await assert.rejects(ops.batches().create(invalid,randomUUID()),/invalid_message/);
  assert.equal((await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.assistant_knowledge_evaluations where enterprise_id=${eid}`))).length,before.length);
  await assert.rejects(new KnowledgeOperations({enterpriseId:eid,adminId:other}).batches().read(first.batchId),/assistant_resource_not_found/);
  assert.equal((await new KnowledgeOperations({enterpriseId:eid,adminId:other}).batches().list()).items.length,0);
  await assert.rejects(new KnowledgeOperations({enterpriseId:tenants[1],adminId:aid}).batches().read(first.batchId),/assistant_capability_forbidden/);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_batches`))).length,0);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_batch_items`))).length,0);
  await ops.batches().command(first.batchId,'cancel',{expectedVersion:1},randomUUID());
});

test('K10 bounded concurrent controllers reuse original evaluations/runs/reservations and worker continues without a page',async()=>{
  const {id}=await create(3,2);
  await Promise.all([ops.batches().advance(id),ops.batches().advance(id),ops.batches().advance(id)]);
  const started=await batch(id),items=started.items as Row[];
  assert.equal(items.filter(i=>i.status==='queued').length,2);assert.equal(items.filter(i=>i.status==='pending').length,1);
  await finish(String(items[0].evaluationId));
  await advanceKnowledgeBatches();
  const continued=await batch(id);assert.equal((continued.items as Row[]).filter(i=>i.status==='queued').length,2);
  const done=await finishBatch(id);assert.equal(done.state,'completed');assert.equal(done.costMicros,null);
  assert.ok((done.items as Row[]).every(i=>i.status==='succeeded'));
  const counts=await withTenantTransaction(eid,tx=>one(tx,sql`select count(distinct e.run_id)::int runs,count(distinct q.id)::int reservations
    from app.assistant_knowledge_batch_items i join app.assistant_knowledge_evaluations e on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id
    join app.assistant_quota_reservations q on q.enterprise_id=e.enterprise_id and q.run_id=e.run_id where i.enterprise_id=${eid} and i.batch_id=${id}`));
  assert.deepEqual(counts,{runs:3,reservations:3});
  assert.ok((await batch(id)).usage);assert.equal((await ops.detail(String((await cases(1))[0].id))).gap_status,'open','batch completion never performs semantic review');
});

test('K10 cancellation fences pending and queued work, including direct single-item resume',async()=>{
  const {id}=await create(2);await ops.batches().advance(id);const before=await batch(id),items=before.items as Row[];
  const key=randomUUID();await ops.batches().command(id,'cancel',{expectedVersion:1},key);await ops.batches().command(id,'cancel',{expectedVersion:1},key);
  await ops.batches().advance(id);assert.equal((await batch(id)).state,'cancelled');
  await assert.rejects(ops.batches().command(id,'resume',{expectedVersion:2},randomUUID()),/context_changed/);
  for(const i of items){await assert.rejects(ops.resume(String(i.evaluationId)),/context_changed/);assert.equal((await ops.read(String(i.evaluationId))).status,'cancelled');}
  const reservations=await withTenantTransaction(eid,tx=>rows(tx,sql`select q.status from app.assistant_quota_reservations q
    join app.assistant_knowledge_evaluations e on e.enterprise_id=q.enterprise_id and e.run_id=q.run_id
    join app.assistant_knowledge_batch_items i on i.enterprise_id=e.enterprise_id and i.evaluation_id=e.id where i.enterprise_id=${eid} and i.batch_id=${id}`));
  assert.deepEqual(reservations.map(q=>q.status),['released']);
});

test('K10 local dispatch failure rolls back partial writes and original-key resume submits exactly one run',async()=>{
  const {id}=await create(1),original=ConversationService.prototype.send;let injected=false;
  ConversationService.prototype.send=function(...args:Parameters<typeof original>){return original.apply(this,args).then(value=>{if(!injected){injected=true;throw Error('synthetic failure before the outer dispatch commit');}return value;});};
  try{await ops.batches().advance(id);}finally{ConversationService.prototype.send=original;}
  const blocked=await batch(id);assert.equal(blocked.state,'blocked');assert.equal(blocked.errorCode,'dispatch_unavailable');
  const count=async()=>Number((await withTenantTransaction(eid,tx=>one(tx,sql`select count(*)::int n from app.assistant_runs where enterprise_id=${eid}`)))!.n);
  const before=await count();await ops.batches().command(id,'resume',{expectedVersion:blocked.version},randomUUID());await ops.batches().advance(id);
  assert.equal(await count(),before+1);await ops.batches().advance(id);assert.equal(await count(),before+1);await finishBatch(id);
});

test('K10 cancellation after provider dispatch keeps reconciliation and never retries unknown billed work',async()=>{
  const {id}=await create(1);await ops.batches().advance(id);const lease=await claimJob();assert.ok(lease);
  await markProviderStarted(lease,[]); // Explicit synthetic acceptance state; no external call is made.
  await ops.batches().command(id,'cancel',{expectedVersion:1},randomUUID());
  const d=await batch(id),item=(d.items as Row[])[0];assert.equal(item.status,'cancelled');assert.equal(item.awaitingReconciliation,true);assert.equal(d.costMicros,null);
  await assert.rejects(ops.resume(String(item.evaluationId)),/context_changed/);await ops.batches().advance(id);
  await assert.rejects(new ConversationService(ops.actor).run(lease.runId,'retry',randomUUID()),/context_changed/);
});

test('K08 case revisions hide batch and individual results, stop pending dispatch and cancel queued original jobs',async()=>{
  const {id,c}=await create(2);await ops.batches().advance(id);const started=await batch(id),evaluationId=String((started.items as Row[])[0].evaluationId);
  await ops.save({title:c[1].title,question:question+' 修订',expectation:c[1].expectation,gapNote:'合成修订',expectedVersion:c[1].version},randomUUID(),String(c[1].id));
  const hidden=await batch(id);assert.equal(hidden.available,false);assert.ok(!('items' in hidden));assert.equal((await ops.read(evaluationId)).available,false);
  await ops.batches().advance(id);const blocked=await batch(id);assert.equal(blocked.state,'blocked');
  await assert.rejects(ops.batches().command(id,'resume',{expectedVersion:blocked.version},randomUUID()),/context_changed/);
  const runs=await withTenantTransaction(eid,tx=>rows(tx,sql`select r.status from app.assistant_knowledge_batch_items i
    join app.assistant_knowledge_evaluations e on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id
    join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id where i.enterprise_id=${eid} and i.batch_id=${id}`));
  assert.deepEqual(runs.map(r=>r.status),['cancelled']);await ops.batches().command(id,'cancel',{expectedVersion:blocked.version},randomUUID());
});

test('K07 all management roles create private batches without employee membership; revocation fences worker scheduling',async()=>{
  const c=await cases(1);
  for(const role of ['admin','super_admin']){
    const adminId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password)
      values(${prefix+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`)))!.id);admins.push(adminId);
    const service=new KnowledgeOperations({enterpriseId:eid,adminId});const r=await service.batches().create(input(c),randomUUID());
    assert.equal((await service.batches().read(r.batchId)).available,true);await assert.rejects(ops.batches().read(r.batchId),/assistant_resource_not_found/);
    await service.batches().command(r.batchId,'cancel',{expectedVersion:1},randomUUID());
  }
  const {id}=await create(1);await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${aid}`));
  try{await advanceKnowledgeBatches();const b=await withPlatformTransaction(tx=>one(tx,sql`select state,last_error from app.assistant_knowledge_batches where enterprise_id=${eid} and id=${id}`));assert.equal(b!.state,'blocked');assert.equal(b!.last_error,'assistant_capability_forbidden');}
  finally{await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${aid}`));}
  await ops.batches().command(id,'cancel',{expectedVersion:2},randomUUID());
});

test('K06 configuration changes hide old results and immutable batch provenance cannot be edited',async()=>{
  const {id}=await create(1);const previous=process.env.ASSISTANT_TEXT_MODEL;
  process.env.ASSISTANT_TEXT_MODEL='synthetic-config-change';
  try{assert.equal((await batch(id)).available,false);await ops.batches().advance(id);}
  finally{if(previous===undefined)delete process.env.ASSISTANT_TEXT_MODEL;else process.env.ASSISTANT_TEXT_MODEL=previous;}
  const d=await batch(id);assert.equal(d.state,'blocked');await ops.batches().command(id,'cancel',{expectedVersion:d.version},randomUUID());
  const inactive=await create(1),profile=await withTenantTransaction(eid,tx=>one(tx,sql`select active_index_profile_id from app.assistant_enterprise_settings where enterprise_id=${eid}`));
  await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_index_profiles set status='disabled' where enterprise_id=${eid} and id=${String(profile!.active_index_profile_id)}`));
  try{assert.equal((await batch(inactive.id)).available,false);await assert.rejects(ops.batches().create(input(inactive.c),randomUUID()),/knowledge_not_ready/);await ops.batches().advance(inactive.id);}
  finally{await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_index_profiles set status='active' where enterprise_id=${eid} and id=${String(profile!.active_index_profile_id)}`));}
  await ops.batches().command(inactive.id,'cancel',{expectedVersion:2},randomUUID());
  await assert.rejects(withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_batches set configuration='{}'::jsonb where enterprise_id=${eid} and id=${id}`)),e=>/immutable knowledge batch/.test(String((e as Error&{cause?:Error}).cause?.message)));
  const events=await withTenantTransaction(eid,tx=>rows(tx,sql`select type from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%'`));assert.equal(events.length,0);
});

test('K11 batch history orders numeric identities across digit widths',async()=>{
  const {id}=await create(1);await ops.batches().command(id,'cancel',{expectedVersion:1},randomUUID());
  const lower='900000000000000001',higher='1000000000000000001';
  await withTenantTransaction(eid,async tx=>{for(const target of [lower,higher])await tx.execute(sql`insert into app.assistant_knowledge_batches
    (id,enterprise_id,created_by,title,state,concurrency,configuration,knowledge_epoch,index_profile_id) overriding system value
    select ${target}::bigint,enterprise_id,created_by,title,'cancelled',concurrency,configuration,knowledge_epoch,index_profile_id
    from app.assistant_knowledge_batches where enterprise_id=${eid} and id=${id}`);});
  const h=await ops.batches().list();assert.equal(h.items[0].id,higher);assert.equal(h.items[1].id,lower);
});
