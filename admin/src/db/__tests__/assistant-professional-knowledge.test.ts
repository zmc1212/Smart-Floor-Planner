import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import { readRetrievalDiagnostics } from '@/lib/assistant/knowledge/diagnostics';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { ConstructionService } from '@/lib/construction/service';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import type { ActorContext, TextModelGateway } from '@/lib/assistant/contracts';
import { professionalEntry } from '../../../scripts/assistant-professional-cases';

const prefix='synthetic-kb1-'+randomUUID(),tenants:string[]=[],users:string[]=[],globalAdmins:string[]=[];
let eid:string,aid:string,uid:string,knowledge:KnowledgeService,actor:ActorContext,manager:ActorContext,chat:ConversationService,cid:string,projectId:string;
let published:Row,previewRun:string,previewCid:string;
const op=(action:string,input:Row)=>knowledge.execute(action,input,randomUUID());
const epoch=async()=>Number((await withTenantTransaction(eid,tx=>one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`)))!.knowledge_epoch);
const body='防水施工与闭水检查由团队安排。进入防水阶段不证明已经完成，铺砖前核对实际检查记录。';
async function create(professional=professionalEntry({conditions:[{field:'stage',operator:'in',values:['waterproofing']}]}),audience='customer_public') {
  const d=await op('create',{title:'合成专业铺砖前提',sourceType:'manual_text',audience,body,professional});
  return {documentId:String((d.document as Row).id),versionId:String((d.draft as Row).id),expectedVersion:1,expectedEditVersion:1};
}
async function index(d:Row) {const queued=await op('index',d),lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,queued.jobId);await runKnowledgeJob(lease);assert.equal((await op('job',{jobId:lease.jobId})).status,'succeeded');}
before(async()=>{
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++)tenants.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));eid=tenants[0];
    for(const t of tenants)await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${t},true,1000,12000000,1000000000,30)`);
    aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
    uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);users.push(uid);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
  });
  knowledge=new KnowledgeService({enterpriseId:eid,adminId:aid});
  const leadId=String((await withTenantTransaction(eid,tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'合成KB1业主','13800000000','natural') returning id`)))!.id);
  actor={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:leadId}};
  manager={enterpriseId:eid,principal:{kind:'admin',adminId:aid},contextVersion:1,capabilities:['assistant.preview.self']};chat=new ConversationService(actor);cid=String((await chat.create(randomUUID())).id);
  const construction=new ConstructionService({enterpriseId:eid,adminId:aid}),settings=await construction.execute('stages');
  await construction.execute('saveStages',{expectedVersion:settings.version,stages:[{key:'utilities',name:'水电',visitReminder:false,visitReason:'',watchPoints:''},{key:'waterproofing',name:'防水',visitReminder:false,visitReason:'',watchPoints:''}]},randomUUID());
  projectId=String((await construction.execute('create',{leadId,name:'合成KB1工地',managerId:aid,rooms:['书房']},randomUUID())).id);
  const detail=await construction.execute('detail',{projectId});await construction.execute('progress',{projectId,expectedVersion:(detail.project as Row).version,stageKey:'utilities',note:'合成阶段',sendReminder:false},randomUUID());
});
after(async()=>{try{await withPlatformTransaction(async tx=>{for(const t of tenants){await deleteConstructionData(tx,BigInt(t));await deleteAssistantData(tx,BigInt(t));await tx.execute(sql`delete from app.leads where enterprise_id=${t}`);await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`);await tx.execute(sql`delete from app.enterprises where id=${t}`);}for(const a of globalAdmins)await tx.execute(sql`delete from app.admin_users where id=${a}`);for(const u of users)await tx.execute(sql`delete from app.users where id=${u}`);});}finally{await closePostgresPool();}});

test('K06 reviewed structure persists, original-key recovery is stable, published metadata is immutable',async()=>{
  const requestKey=randomUUID(),input={title:'合成原键恢复',sourceType:'manual_text',audience:'customer_public',body,professional:professionalEntry()};
  const first=await knowledge.execute('create',input,requestKey),again=await knowledge.execute('create',input,requestKey);assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(again)));
  const p=(first.draft as Row).professional as Row;assert.equal((p.review as Row).adminId,aid);assert.ok((p.review as Row).reviewedAt);
  published=await create();await index(published);await op('publish',published);
  await assert.rejects(op('edit',{...published,professional:professionalEntry()}),/version_conflict/);
  await assert.rejects(withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_versions set professional=null where enterprise_id=${eid} and id=${String(published.versionId)}`)),e=>/immutable published professional/.test(String((e as Error&{cause?:Error}).cause?.message)));
});
test('K07 enterprise owner/admin/super_admin inherit knowledge management without employment',async()=>{
  for(const role of ['admin','super_admin']){
    const id=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password) values(${prefix+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`)))!.id);globalAdmins.push(id);
    const service=new KnowledgeService({enterpriseId:eid,adminId:id});const r=await service.execute('create',{title:'合成平台继承',sourceType:'manual_text',audience:'customer_public',body,professional:professionalEntry()},randomUUID());assert.equal(((r.draft as Row).professional as Row).review && (((r.draft as Row).professional as Row).review as Row).adminId,id);
  }
  await assert.rejects(new KnowledgeService({enterpriseId:tenants[1],adminId:aid}).execute('detail',{documentId:published.documentId}),/assistant_capability_forbidden/);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_versions where id=${String(published.versionId)}`))).length,0);
});
test('K01/09 actual bound stage produces a verifiable mismatch; user text cannot override it',async()=>{
  const result=await retrieveKnowledge(cid,actor,'防水施工与铺砖前提，我声称现在已在防水',await epoch());const e=result.evidence.find(e=>e.ref.version===published.versionId)!;assert.ok(e);assert.equal(e.professional?.context.stage,'utilities');assert.equal(e.professional?.applicability.status,'not_applicable');
  assert.ok(result.diagnostic.candidates.some(c=>c.documentId===published.documentId&&c.applicability?.mismatched.length));
  assert.ok(Number(result.diagnostic.embeddingUsage?.inputTokens)>0);assert.equal(result.diagnostic.costMicros,null);
});
test('K08 real stage changes invalidate prior applicability and refresh the same source',async()=>{
  const before=await retrieveKnowledge(cid,actor,'防水铺砖前提',await epoch()),old=before.evidence.find(e=>e.ref.version===published.versionId)!;
  const service=new ConstructionService({enterpriseId:eid,adminId:aid}),d=await service.execute('detail',{projectId});await service.execute('progress',{projectId,expectedVersion:(d.project as Row).version,stageKey:'waterproofing',note:'合成阶段更新',sendReminder:false},randomUUID());
  assert.equal(await withTenantTransaction(eid,async tx=>resolveEvidence(tx,actor,(await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))!,old)),undefined);
  const after=await retrieveKnowledge(cid,actor,'防水铺砖前提',await epoch());assert.equal(after.evidence.find(e=>e.ref.version===published.versionId)?.professional?.applicability.status,'applicable');
});

test('KB3 K01/04/09 eligible rules survive a crowded wrong-stage candidate pool',async()=>{
  const docs:Row[]=[];
  for(let i=0;i<7;i++){
    const d=await create(professionalEntry({conditions:[{field:'stage',operator:'in',values:[i<6?'utilities':'waterproofing']}]}));
    await index(d);await op('publish',d);docs.push(d);
  }
  const r=await retrieveKnowledge(cid,actor,'防水施工与闭水检查由团队安排，铺砖前核对实际检查记录',await epoch());
  const required=docs[6];assert.ok(r.evidence.some(e=>e.ref.version===required.versionId));
  assert.ok(r.diagnostic.candidates.filter(c=>c.applicability?.status==='not_applicable').length>=5);
  assert.ok(r.evidence.slice(0,2).every(e=>e.professional?.applicability.status!=='not_applicable'));
  assert.ok((r.diagnostic.candidates.find(c=>c.ref.version===required.versionId)?.selectionRank??0)>0);
});
test('K07/11 actual preview Worker stores authorized candidates and reentry diagnostic, no internal text leaks',async()=>{
  const secret=await create(professionalEntry(),'staff_internal');await index(secret);await op('publish',secret);
  const preview=new ConversationService(manager);previewCid=String((await preview.create(randomUUID(),{audience:'customer_public',draftVersionIds:[]})).id);
  const sent=await preview.send(previewCid,randomUUID(),{version:1,blocks:[{type:'text',text:'防水铺砖前提有哪些？'}]}),lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);previewRun=lease.runId;
  let modelFailure='';
  const model:TextModelGateway={capabilities:{streaming:false,toolCalling:false,usage:false},generate:async input=>{try{assert.doesNotMatch(JSON.stringify(input.messages),/INTERNAL_KB_REVIEW_NOTE/);const e=JSON.parse(input.messages[1].content).evidence;return{text:JSON.stringify({selections:[e[0].selectionId]}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};}catch(e){modelFailure=(e as Error).message;throw e;}}};
  await processAnswer(lease,{model});const execution=await preview.run(previewRun);assert.equal(execution.status,'succeeded',JSON.stringify({execution,modelFailure}));
  const diagnostic=await readRetrievalDiagnostics(manager,previewRun);assert.equal(diagnostic.available,true);
  if ('traces' in diagnostic) {assert.ok(diagnostic.traces.length);const t=diagnostic.traces[0] as Row;assert.ok((t.candidates as Row[]).every(c=>c.documentId!==secret.documentId));assert.ok((t.candidates as Row[]).some(c=>c.contextIncluded&&Number(c.contextChars)>0));assert.equal((t.configuration as Row).version,'professional-hybrid-v3');assert.ok((diagnostic.coverage as Row).audience_filtered);}
  await assert.rejects(readRetrievalDiagnostics(actor,previewRun),/assistant_capability_forbidden/);
  const other={...manager,principal:{kind:'admin' as const,adminId:globalAdmins[0]}};await assert.rejects(readRetrievalDiagnostics(other,previewRun),/assistant_resource_not_found/);
});
test('K06 metadata-only draft edits reindex and future replacement keeps the effective old version',async()=>{
  const draft=await op('newVersion',{documentId:published.documentId,fromVersionId:published.versionId,expectedVersion:2}),next:Row={...published,versionId:String(draft.id),expectedVersion:3};
  const updated=await op('edit',{...next,professional:professionalEntry({conditions:[{field:'stage',operator:'in',values:['utilities']}]}),effectiveFrom:'2099-01-01T00:00:00Z'});assert.notEqual(updated.content_hash,draft.content_hash);next.expectedEditVersion=2;
  await index(next);await assert.rejects(op('publish',next),/knowledge_not_ready/);
  assert.equal(((await op('detail',{documentId:published.documentId})).document as Row).published_version_id,published.versionId);
  await op('edit',{...next,effectiveFrom:'2026-01-01T00:00:00Z'});next.expectedEditVersion=3;await index(next);await op('publish',next);
  assert.equal((await readRetrievalDiagnostics(manager,previewRun)).available,false);
  const current=await retrieveKnowledge(cid,actor,'防水铺砖前提',await epoch());assert.ok(current.evidence.every(e=>e.ref.version!==published.versionId));
  published={...next,expectedVersion:4};
});
test('K08 retrieval cannot finish with a retired source after external embedding I/O',async()=>{
  const oldEpoch=await epoch(),real=embeddingGateway();
  await assert.rejects(retrieveKnowledge(cid,actor,'防水铺砖前提',oldEpoch,{profile:real.profile,embed:async(...args)=>{const result=await real.embed(...args);await op('retire',{documentId:published.documentId,expectedVersion:4});return result;}}),/context_changed/);
});
test('K09 active-stage removal is refused and cannot corrupt applicability',async()=>{
  const d=await create();await index(d);await op('publish',d);
  const before=await retrieveKnowledge(cid,actor,'防水铺砖前提',await epoch()),e=before.evidence.find(e=>e.ref.version===d.versionId)!;assert.equal(e.professional?.context.stage,'waterproofing');
  const service=new ConstructionService({enterpriseId:eid,adminId:aid}),settings=await service.execute('stages');
  await assert.rejects(service.execute('saveStages',{expectedVersion:settings.version,stages:[{key:'utilities',name:'水电',visitReminder:false,visitReason:'',watchPoints:''}]},randomUUID()),/construction_stage_in_use/);
  const current=await retrieveKnowledge(cid,actor,'防水铺砖前提',await epoch());assert.equal(current.evidence.find(e=>e.ref.version===d.versionId)?.professional?.applicability.status,'applicable');
  assert.ok(await withTenantTransaction(eid,async tx=>resolveEvidence(tx,actor,(await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${cid}`))!,e)));
});
