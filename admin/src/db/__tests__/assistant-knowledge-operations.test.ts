import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one,rows,type Row} from '@/db/repositories/assistant-repository';
import {deleteAssistantData} from '@/db/repositories/assistant-cleanup';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {KnowledgeOperations} from '@/lib/assistant/knowledge/operations';
import {KnowledgeService} from '@/lib/assistant/knowledge/service';
import {appendMessage,ConversationService} from '@/lib/assistant/core/conversation';
import {claimKnowledgeJob,runKnowledgeJob} from '@/lib/assistant/knowledge/index-worker';
import {claimJob} from '@/lib/assistant/infrastructure/job-queue';
import {processAnswer} from '@/lib/assistant/infrastructure/answer-worker';
import type {TextModelGateway} from '@/lib/assistant/contracts';
import {fingerprint} from '@/lib/assistant/contracts';
const prefix='synthetic-kb4-'+randomUUID(),tenants:string[]=[],admins:string[]=[];
let eid:string,aid:string,other:string,ops:KnowledgeOperations,knowledge:KnowledgeService,published:Row,internal:Row,saved:Row,firstId:string;
const body='合成运营样例：书房靠窗办公先核对屏幕眩光和通道，插座位置需要设计师核对点位图，不能据此认定已批准。';
const question='书房靠窗办公的屏幕眩光、通道和插座点位应核对什么？';
const op=(action:string,input:Row)=>knowledge.execute(action,input,randomUUID());
const manager=()=>({enterpriseId:eid,adminId:aid});
const model:TextModelGateway={capabilities:{streaming:false,toolCalling:false,usage:false},generate:async input=>{
  const e=JSON.parse(input.messages[1].content).evidence as Row[];
  return{text:JSON.stringify({selections:e.map(x=>x.selectionId)}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};
}};
async function index(d:Row){const q=await op('index',d),lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,q.jobId);await runKnowledgeJob(lease);assert.equal((await op('job',{jobId:q.jobId})).status,'succeeded');}
async function publish(audience:string){const d=await op('create',{title:'测试专用KB4 '+audience,sourceType:'manual_text',audience,body});const target={documentId:String((d.document as Row).id),versionId:String((d.draft as Row).id),expectedVersion:1,expectedEditVersion:1};await index(target);await op('publish',target);return target;}
async function finish(evaluationId:string){const d=await ops.read(evaluationId);assert.equal(d.available,true);const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,d.run!.id);await processAnswer(lease,{model});return ops.read(evaluationId);}
before(async()=>{
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++)tenants.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));eid=tenants[0];
    for(const t of tenants)await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${t},true,1000,12000000,1000000000,30)`);
    for(let i=0;i<2;i++)admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix+i},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id));aid=admins[0];other=admins[1];
  });ops=new KnowledgeOperations(manager());knowledge=new KnowledgeService(manager());published=await publish('customer_public');internal=await publish('staff_internal');
});
after(async()=>{
  try{
    try{
      const audit=await withPlatformTransaction(async tx=>{
        const items=[];
        for(const t of tenants)items.push({enterpriseId:t,
          indexAttempts:await rows(tx,sql`select operation,status,count(*)::int calls,sum(input_tokens)::text known_input_tokens,
            count(*) filter(where input_tokens is null)::int unknown_input_calls from app.assistant_knowledge_attempts
            where enterprise_id=${t} group by operation,status order by operation,status`),
          queryEmbedding:await rows(tx,sql`select measurement_kind,count(*)::int calls,sum(input_tokens)::text known_input_tokens,
            count(*) filter(where input_tokens is null)::int unknown_input_calls from app.assistant_usage_records
            where enterprise_id=${t} and category='query_embedding' group by measurement_kind order by measurement_kind`),
          reservations:await rows(tx,sql`select status,count(*)::int count from app.assistant_quota_reservations
            where enterprise_id=${t} group by status order by status`),
        });
        return items;
      });
      // Complete persisted call accounting before fixture cleanup; chunk/tokenization is not Embedding.
      console.log('KB4_SERVICE_AUDIT '+JSON.stringify({fixturePrefix:prefix,tenantIds:tenants,adminIds:admins,items:audit,costMicros:null}));
    }finally{
      await withPlatformTransaction(async tx=>{for(const t of tenants){await deleteAssistantData(tx,BigInt(t));await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`);await tx.execute(sql`delete from app.enterprises where id=${t}`);}for(const a of admins)await tx.execute(sql`delete from app.admin_users where id=${a}`);});
    }
  }finally{await closePostgresPool();}
});
test('K11 curated question persists with predeclared required/forbidden sources, conflict and tenant guards',async()=>{
  const input={title:'测试专用 · 办公同题',question,expectation:{kind:'grounded',requiredDocumentIds:[published.documentId],forbiddenDocumentIds:[internal.documentId]},gapNote:'核对屏幕与通道；不自动批准点位'},key=randomUUID();
  saved=await ops.save(input,key);assert.deepEqual(JSON.parse(JSON.stringify(await ops.save(input,key))),JSON.parse(JSON.stringify(saved)));assert.equal((await ops.detail(String(saved.id))).revision,1);
  assert.equal((await new KnowledgeOperations({enterpriseId:eid,adminId:other}).list()).items.length,1);
  await assert.rejects(ops.save({...input,expectedVersion:2},randomUUID(),String(saved.id)),/version_conflict/);
  await assert.rejects(ops.save({...input,expectation:{...input.expectation,tenantId:tenants[1]}},randomUUID()),/invalid_message/);
  await assert.rejects(new KnowledgeOperations({enterpriseId:tenants[1],adminId:aid}).detail(String(saved.id)),/assistant_capability_forbidden/);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_cases where id=${String(saved.id)}`))).length,0);
});
test('K10/11 original-key duplicate and concurrent resume reuse one preview, run and reservation',async()=>{
  const key=randomUUID(),input={expectedVersion:saved.version};const a=await ops.start(String(saved.id),input,key);firstId=a.evaluationId;
  const results=await Promise.all([ops.start(String(saved.id),input,key),ops.resume(firstId),ops.resume(firstId)]);assert.equal(results[0].evaluationId,firstId);
  const d=await ops.read(firstId);assert.equal(d.status,'queued');const counts=await withTenantTransaction(eid,async tx=>({runs:await rows(tx,sql`select id from app.assistant_runs where enterprise_id=${eid}`),quota:await rows(tx,sql`select id from app.assistant_quota_reservations where enterprise_id=${eid}`)}));assert.equal(counts.runs.length,1);assert.equal(counts.quota.length,1);
  await assert.rejects(new KnowledgeOperations({enterpriseId:eid,adminId:other}).read(firstId),/assistant_resource_not_found/);
  assert.equal((await new KnowledgeOperations({enterpriseId:eid,adminId:other}).history(String(saved.id))).items.length,0);
  const completed=await finish(firstId);assert.equal(completed.status,'succeeded');assert.equal(completed.structural!.passed,true);assert.equal(completed.structural!.semanticCorrectness,'requires_review');assert.equal(completed.costMicros,null);assert.deepEqual(completed.structural!.forbidden,[]);assert.equal(completed.snapshot!.required[0].versionId,published.versionId);
  const actor={enterpriseId:eid,principal:{kind:'admin' as const,adminId:aid},contextVersion:1,capabilities:['assistant.preview.self']};
  await withTenantTransaction(eid,async tx=>{for(let i=0;i<21;i++)await appendMessage(tx,actor,String(completed.conversationId),{author:'admin',clientMessageId:randomUUID(),content:{version:1,blocks:[{type:'text',text:'合成后续试问文字，不创建模型任务'}]}});});
  const reopened=await ops.read(firstId);assert.equal(reopened.structural!.passed,true);assert.ok(reopened.answer?.available,'evaluation projects its exact output even beyond the latest transcript page');
});
test('K11 semantic rejection keeps a knowledge gap, accepted review requires evidence and explicit note',async()=>{
  await assert.rejects(ops.review(firstId,{expectedVersion:saved.version,outcome:'accepted',note:'好'},randomUUID()),/invalid_message/);
  saved=await ops.review(firstId,{expectedVersion:saved.version,outcome:'rejected',note:'合成语义核对：条目未解释通道核对对象，先补充条件'},randomUUID());assert.equal(saved.gap_status,'open');
  const key=randomUUID(),input={expectedVersion:saved.version,outcome:'accepted',note:'合成运营测试人工核对记录：只解释条件，没有批准点位或承诺工期'};
  saved=await ops.review(firstId,input,key);assert.equal(saved.gap_status,'verified');assert.deepEqual(JSON.parse(JSON.stringify(await ops.review(firstId,input,key))),JSON.parse(JSON.stringify(saved)));
  assert.equal((await ops.read(firstId)).review?.semanticCorrectness,'manager_reviewed');
});
test('K06/08 failed new draft preserves effective answer, replacement invalidates old evaluation and gap status',async()=>{
  const draft=await op('newVersion',{documentId:published.documentId,expectedVersion:2,fromVersionId:published.versionId});
  const vid=String(draft.id);await op('edit',{documentId:published.documentId,versionId:vid,expectedEditVersion:1,body:body+' 修订补充：通道需结合实际家具尺寸，由设计师核对。'});
  await assert.rejects(op('publish',{documentId:published.documentId,versionId:vid,expectedVersion:3,expectedEditVersion:2}),/knowledge_not_ready/);
  assert.equal((await ops.read(firstId)).available,true);
  const target={documentId:published.documentId,versionId:vid,expectedVersion:3,expectedEditVersion:2};await index(target);await op('publish',target);published=target;
  const stale=await ops.read(firstId);assert.equal(stale.available,false);assert.ok(!('answer' in stale));assert.ok(!('diagnostic' in stale));assert.equal((await ops.detail(String(saved.id))).gap_status,'needs_recheck');
  await assert.rejects(ops.review(firstId,{expectedVersion:saved.version,outcome:'accepted',note:'不得关闭旧资料缺口'},randomUUID()),/context_changed/);
  const rerun=await ops.start(String(saved.id),{expectedVersion:saved.version},randomUUID());const result=await finish(rerun.evaluationId);assert.equal(result.structural!.passed,true);assert.equal(result.snapshot!.required[0].versionId,vid);
});
test('K10 dispatch crash after actual send recovers the original run without duplicate model work',async()=>{
  const original=ConversationService.prototype.send;let injected=false;
  ConversationService.prototype.send=function(...args:Parameters<typeof original>){const r=original.apply(this,args);return r.then(value=>{if(!injected){injected=true;throw Error('synthetic lost receipt after send');}return value;});};
  try{await assert.rejects(ops.start(String(saved.id),{expectedVersion:saved.version},randomUUID()),/synthetic lost receipt/);}finally{ConversationService.prototype.send=original;}
  const h=await ops.history(String(saved.id)),pendingId=String(h.items[0].id);const before=await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.assistant_runs where enterprise_id=${eid}`));
  assert.equal((await ops.read(pendingId)).status,'dispatch_pending');await ops.resume(pendingId);const after=await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.assistant_runs where enterprise_id=${eid}`));assert.equal(after.length,before.length);assert.equal((await finish(pendingId)).structural!.passed,true);
});
test('K11 altered expectations fail without closing a gap, and source removal hides stored answer/notes',async()=>{
  const id=String(saved.id);const updated=await ops.save({title:saved.title,question,expectation:{kind:'grounded',requiredDocumentIds:[published.documentId],forbiddenDocumentIds:[]},gapNote:'新问法修订',expectedVersion:saved.version},randomUUID(),id);saved=updated;
  assert.equal((await ops.read(firstId)).available,false);
  const e=await ops.start(id,{expectedVersion:saved.version},randomUUID());await finish(e.evaluationId);
  const metadata=await op('metadata',{documentId:published.documentId,expectedVersion:4,audience:'staff_internal'});assert.ok(metadata);
  const hidden=await ops.read(e.evaluationId);assert.equal(hidden.available,false);assert.ok(!('snapshot' in hidden));assert.ok(!('review' in hidden));
  await assert.rejects(ops.start(id,{expectedVersion:saved.version},randomUUID()),/knowledge_not_ready/);
});
test('K07 owner/platform role inheritance, disabled identity and password boundaries apply to operations',async()=>{
  for(const role of ['admin','super_admin']){
    const a=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password) values(${prefix+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`)))!.id);admins.push(a);
    const service=new KnowledgeOperations({enterpriseId:eid,adminId:a});assert.ok((await service.list()).items.length);await service.save({title:'平台继承测试',question,expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID());
    await assert.rejects(service.read(firstId),/assistant_resource_not_found/);
  }
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=true where id=${other}`));await assert.rejects(new KnowledgeOperations({enterpriseId:eid,adminId:other}).health(),/assistant_capability_forbidden/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='disabled',must_change_password=false where id=${other}`));await assert.rejects(new KnowledgeOperations({enterpriseId:eid,adminId:other}).list(),/assistant_capability_forbidden/);
});
test('K10 health reports actual indexing attempts, unknown quantities and active profile without chat leakage',async()=>{
  const h=await ops.health();assert.ok(h.profile);assert.ok(h.attempts.some(a=>Number(a.calls)>0));assert.equal(h.costMicros,null);assert.equal(h.parser.ocr,false);assert.ok(!('conversations' in h));assert.ok(!JSON.stringify(h).includes('unusable-synthetic'));
  await assert.rejects(withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_evaluations set snapshot='{}'::jsonb where enterprise_id=${eid} and id=${firstId}`)),e=>/immutable knowledge evaluation/.test(String((e as Error&{cause?:Error}).cause?.message)));
});
test('K11 an unready index is an operational failure, never a verified expected knowledge gap',async()=>{
  const globalId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password)
    values(${prefix+'unready'},'unusable-synthetic','super_admin','active',ARRAY[]::text[],false) returning id`)))!.id);admins.push(globalId);
  const service=new KnowledgeOperations({enterpriseId:tenants[1],adminId:globalId});
  const c=await service.save({title:'合成未建索引反例',question,expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID());
  const e=await service.start(String(c.id),{expectedVersion:c.version},randomUUID()),pending=await service.read(e.evaluationId),lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,pending.run!.id);
  await processAnswer(lease,{model});const result=await service.read(e.evaluationId);assert.equal(result.available,true);assert.equal(result.structural!.passed,false);
  const diagnostic=result.diagnostic;assert.ok(diagnostic&&diagnostic.available);assert.equal(result.run!.errorCode,'retrieval_unavailable',JSON.stringify(diagnostic));
  await assert.rejects(service.review(e.evaluationId,{expectedVersion:c.version,outcome:'accepted',note:'没有索引不能当作专业知识缺口通过'},randomUUID()),/knowledge_evaluation_not_passed/);
});
test('K10/11 history sorts numeric identities across digit widths and keeps the cursor exact',async()=>{
  const lower='900000000000000001',higher='1000000000000000001';
  await withTenantTransaction(eid,async tx=>{for(const target of [lower,higher])await tx.execute(sql`insert into app.assistant_knowledge_evaluations
    (id,enterprise_id,case_id,case_revision,snapshot,knowledge_epoch,created_by,create_key,send_key) overriding system value
    select ${target}::bigint,enterprise_id,case_id,case_revision,snapshot,knowledge_epoch,created_by,${randomUUID()}::uuid,${randomUUID()}::uuid
    from app.assistant_knowledge_evaluations where enterprise_id=${eid} and id=${firstId}`);});
  const first=await ops.history(String(saved.id),{limit:1});assert.equal(first.items[0].id,higher);assert.equal(first.nextCursor,higher);
  const next=await ops.history(String(saved.id),{limit:1,beforeId:first.nextCursor});assert.equal(next.items[0].id,lower);
});

test('KB4 batch preparation persists ordered private item identities atomically without dispatching',async()=>{
  const cases=[];
  for(let i=0;i<2;i++)cases.push(await ops.save({title:'测试专用批量准备 '+i,question:question+' 合成批量 '+i,
    expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID()));
  const input={cases:cases.map(c=>({caseId:String(c.id),expectedVersion:Number(c.version)}))},key=randomUUID();
  const counts=()=>withTenantTransaction(eid,async tx=>({
    evaluations:(await one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${eid}`))!.n,
    runs:(await one(tx,sql`select count(*)::int n from app.assistant_runs where enterprise_id=${eid}`))!.n,
    jobs:(await one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${eid}`))!.n,
    reservations:(await one(tx,sql`select count(*)::int n from app.assistant_quota_reservations where enterprise_id=${eid}`))!.n,
  }));
  const before=await counts();const a=await ops.prepareBatch(input,key);
  const duplicates=await Promise.all([ops.prepareBatch(input,key),ops.prepareBatch(input,key)]);
  assert.deepEqual(duplicates,[a,a]);assert.deepEqual(a.items.map(i=>i.caseId),input.cases.map(c=>c.caseId));
  assert.equal(a.adminId,aid);assert.equal(a.enterpriseId,eid);assert.ok(a.profileId);assert.match(a.profileHash,/^[a-f0-9]{64}$/);
  const after=await counts();assert.equal(Number(after.evaluations),Number(before.evaluations)+2);
  for(const k of ['runs','jobs','reservations'] as const)assert.equal(after[k],before[k]);
  for(const item of a.items){
    const detail=await ops.read(item.evaluationId);assert.equal(detail.status,'dispatch_pending');assert.equal(detail.available,true);
    assert.equal(item.snapshotHash,fingerprint(detail.snapshot));assert.equal(item.caseRevision,1);
    await assert.rejects(new KnowledgeOperations({enterpriseId:eid,adminId:other}).read(item.evaluationId),/assistant_capability_forbidden/);
  }
  await assert.rejects(ops.prepareBatch({cases:input.cases.slice(0,1)},key),/idempotency_conflict/);
});

test('KB4 batch version/source failures roll back the complete receipt and every prepared item',async()=>{
  const c=await ops.save({title:'测试专用批量原子性',question,expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID());
  const second=await ops.save({title:'测试专用批量未发布反例',question,expectation:{kind:'grounded',requiredDocumentIds:[internal.documentId],forbiddenDocumentIds:[]}},randomUUID());
  const count=()=>withTenantTransaction(eid,tx=>one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${eid}`));
  const before=Number((await count())!.n),key=randomUUID();
  await assert.rejects(ops.prepareBatch({cases:[{caseId:String(c.id),expectedVersion:1},{caseId:String(second.id),expectedVersion:2}]},key),/version_conflict/);
  assert.equal(Number((await count())!.n),before);
  await assert.rejects(ops.prepareBatch({cases:[{caseId:String(c.id),expectedVersion:1},{caseId:String(second.id),expectedVersion:1}]},key),/knowledge_not_ready/);
  assert.equal(Number((await count())!.n),before);
  const receipts=await withTenantTransaction(eid,tx=>rows(tx,sql`select id from app.assistant_idempotency_records where enterprise_id=${eid} and operation='knowledge-batch-prepare' and key=${key}`));
  assert.equal(receipts.length,0);
  for(const input of [{cases:[]},{cases:Array(51).fill({caseId:String(c.id),expectedVersion:1})},
    {cases:[{caseId:String(c.id),expectedVersion:1},{caseId:String(c.id),expectedVersion:1}]},
    {cases:[{caseId:String(c.id),expectedVersion:1}],tenantId:tenants[1]},
    {cases:[{caseId:String(c.id),expectedVersion:1,question:'不能替换已保存问题'}]}])await assert.rejects(ops.prepareBatch(input,randomUUID()),/invalid_message/);
  assert.equal(Number((await count())!.n),before);
});

test('KB4 original preparation survives reentry while revised cases and epochs invalidate dispatch',async()=>{
  let c=await ops.save({title:'测试专用批量重进',question,expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID());
  const input={cases:[{caseId:String(c.id),expectedVersion:Number(c.version)}]},key=randomUUID(),first=await ops.prepareBatch(input,key);
  c=await ops.save({title:c.title,question:question+' 修改问法',expectation:c.expectation,expectedVersion:c.version},randomUUID(),String(c.id));
  assert.deepEqual(await ops.prepareBatch(input,key),first);
  const hidden=await ops.read(first.items[0].evaluationId);assert.equal(hidden.available,false);assert.ok(!('snapshot' in hidden));
  await assert.rejects(ops.resume(first.items[0].evaluationId),/context_changed/);
  await withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${eid}`));
  const next=await ops.prepareBatch({cases:[{caseId:String(c.id),expectedVersion:Number(c.version)}]},randomUUID());
  assert.notEqual(next.items[0].evaluationId,first.items[0].evaluationId);assert.equal(next.items[0].caseRevision,2);
  assert.ok(next.knowledgeEpoch>first.knowledgeEpoch);assert.notEqual(next.items[0].snapshotHash,first.items[0].snapshotHash);
});

test('KB4 batch selected-enterprise and private-owner boundaries preserve all three manager roles',async()=>{
  const c=await ops.save({title:'测试专用批量权限',question,expectation:{kind:'missing',requiredDocumentIds:[],forbiddenDocumentIds:[]}},randomUUID());
  const input={cases:[{caseId:String(c.id),expectedVersion:Number(c.version)}]};
  for(const role of ['enterprise_admin','admin','super_admin']){
    const permissions=role==='enterprise_admin'?sql`ARRAY['assistant-knowledge']::text[]`:sql`ARRAY[]::text[]`;
    const a=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${role==='enterprise_admin'?eid:null},${prefix+'batch-'+role},'unusable-synthetic',${role},'active',${permissions},false) returning id`)))!.id);admins.push(a);
    const service=new KnowledgeOperations({enterpriseId:eid,adminId:a}),batch=await service.prepareBatch(input,randomUUID());assert.equal(batch.items.length,1);
    await assert.rejects(ops.read(batch.items[0].evaluationId),/assistant_resource_not_found/);
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=true where id=${a}`));
    await assert.rejects(service.prepareBatch(input,randomUUID()),/assistant_capability_forbidden/);
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set must_change_password=false,status='disabled' where id=${a}`));
    await assert.rejects(service.prepareBatch(input,randomUUID()),/assistant_capability_forbidden/);
  }
  await assert.rejects(new KnowledgeOperations({enterpriseId:tenants[1],adminId:aid}).prepareBatch(input,randomUUID()),/assistant_capability_forbidden/);
});
