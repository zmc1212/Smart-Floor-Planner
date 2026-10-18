import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction,withPlatformTransaction } from '@/db/transaction';
import { one,rows,type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob,runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { readOriginal } from '@/lib/assistant/knowledge/file-service';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import type { ActorContext,TextModelGateway } from '@/lib/assistant/contracts';
import { syntheticDocx,syntheticPdf } from '../../../scripts/assistant-file-fixtures';
import { parseSourceFile } from '@/lib/assistant/knowledge/source-file';
import { chunkDocument } from '@/lib/assistant/knowledge/chunk-gateway';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';

const prefix='synthetic-kb2-'+randomUUID(),tenants:string[]=[],admins:string[]=[];
let eid:string,aid:string,uid:string,service:KnowledgeService,customer:ConversationService,cid:string,actor:ActorContext;
let published:Row,citationId:string,messageId:string;
const op=(action:string,input:Row)=>service.execute(action,input,randomUUID());
const epoch=async()=>Number((await withTenantTransaction(eid,tx=>one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`)))!.knowledge_epoch);
const upload=(bytes=syntheticDocx(),fileName='合成材料.docx')=>({title:'合成文件：铺贴材料核对',fileName,fileBase64:bytes.toString('base64'),authorization:'SYNTHETIC ONLY - permitted test fixture',audience:'customer_public'});
async function create(bytes=syntheticDocx(),fileName='合成材料.docx'){
 const result=await op('createFile',upload(bytes,fileName));return{documentId:String((result.document as Row).id),versionId:String((result.draft as Row).id),expectedVersion:1,expectedEditVersion:1,jobId:result.jobId};
}
async function run(jobId:unknown){const lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,jobId);await runKnowledgeJob(lease);return op('job',{jobId:lease.jobId});}
async function latest(d:Row){const detail=await op('detail',{documentId:d.documentId});return(detail.versions as Row[]).find(v=>String(v.id)===d.versionId)!;}
async function ready(d:Row){assert.equal((await run(d.jobId)).status,'succeeded');d.expectedEditVersion=2;await op('reviewFile',{...d,acknowledgeWarnings:true,excludedBlockIds:[]});d.expectedEditVersion=3;const j=await op('index',d);assert.equal((await run(j.jobId)).status,'succeeded');}
before(async()=>{
 const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
 await withPlatformTransaction(async tx=>{
  for(let i=0;i<2;i++)tenants.push(String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));eid=tenants[0];
  await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,1000,12000000,1000000000,30)`);
  aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
  uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
 });
 service=new KnowledgeService({enterpriseId:eid,adminId:aid});actor={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self']};customer=new ConversationService(actor);cid=String((await customer.create(randomUUID())).id);
});
after(async()=>{try{await withPlatformTransaction(async tx=>{for(const t of tenants){await deleteAssistantData(tx,BigInt(t));await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`);await tx.execute(sql`delete from app.enterprises where id=${t}`);}for(const a of admins)await tx.execute(sql`delete from app.admin_users where id=${a}`);if(uid)await tx.execute(sql`delete from app.users where id=${uid}`);});}finally{await closePostgresPool();}});

test('K02 upload/reentry/hash/original-key recovery; parse is not review/publication',async()=>{
 const key=randomUUID(),input=upload(),a=await service.execute('createFile',input,key),b=await service.execute('createFile',input,key);assert.equal((a.document as Row).id,(b.document as Row).id);assert.equal(a.jobId,b.jobId);
 const d={documentId:String((a.document as Row).id),versionId:String((a.draft as Row).id),expectedEditVersion:1,expectedVersion:1,jobId:a.jobId};
 assert.equal((await run(a.jobId)).status,'succeeded');const v=await latest(d);assert.equal(v.edit_version,2);assert.ok((v.source_file as Row).parsed);assert.equal((v.source_file as Row).review,null);
 assert.deepEqual((await readOriginal(service.actor,d.documentId,d.versionId)).data,syntheticDocx());
 await assert.rejects(op('index',{...d,expectedEditVersion:2}),/knowledge_file_review_required/);
 const same=await op('replaceFile',{...d,...input,expectedEditVersion:2});assert.equal(same.jobId,a.jobId);assert.equal((same.draft as Row).edit_version,2);
 published=await create();await ready(published);await op('publish',published);
 await assert.rejects(op('edit',{...published,body:'伪造为原文'}),/version_conflict/);
 await assert.rejects(withTenantTransaction(eid,tx=>tx.execute(sql`update app.assistant_knowledge_versions set source_file=null,source_asset_id=null where enterprise_id=${eid} and id=${String(published.versionId)}`)),e=>/immutable published source file/.test(String((e as Error&{cause?:Error}).cause?.message)));
});
test('K03 real indexing/retrieval keeps headers/units/conditions/footnote and real locations',async()=>{
 const e=await retrieveKnowledge(cid,actor,'TEST-A材料示例厚度和前提地暖',await epoch());const source=e.evidence.find(e=>e.file?.row===3)!;assert.ok(source);assert.match(source.text,/2 mm/);assert.match(source.text,/地暖场景不能直接套用/);assert.match(source.text,/不据此确认验收/);assert.equal(source.file?.page,undefined);assert.equal(source.file?.table,1);
});
test('K07/10 failed parsing retains original, retries/cancels fence late leases and regular staff is forbidden',async()=>{
 const d=await create(Buffer.from('%PDF-corrupt'),'损坏合成.pdf');assert.equal((await run(d.jobId)).status,'failed');assert.equal((await latest(d)).published_at,null);assert.match(String((await op('job',{jobId:d.jobId})).last_error),/knowledge_file_parse_failed/);assert.equal((await readOriginal(service.actor,String(d.documentId),String(d.versionId))).data instanceof Buffer,true);
 const retried=await op('parse',d);assert.equal(retried.jobId,d.jobId);const lease=await claimKnowledgeJob();assert.ok(lease);await op('cancelParse',d);await runKnowledgeJob(lease);assert.equal((await op('job',{jobId:d.jobId})).status,'cancelled');assert.equal((await latest(d)).edit_version,1);
 const staff=String((await withTenantTransaction(eid,tx=>one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix+'staff'},'unusable-synthetic','designer','active',ARRAY[]::text[],false) returning id`)))!.id);
 await assert.rejects(readOriginal({enterpriseId:eid,adminId:staff},String(published.documentId),String(published.versionId)),/assistant_capability_forbidden/);
 assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_assets`))).length,0);
});
test('K06 PDF page citations; failed replacement leaves old publication active',async()=>{
 const d=await create(syntheticPdf(false,2),'合成阶段.pdf');await ready(d);await op('publish',d);const chunks=await withTenantTransaction(eid,tx=>rows(tx,sql`select locator from app.assistant_knowledge_chunks where enterprise_id=${eid} and document_version_id=${String(d.versionId)}`));assert.ok(chunks.some(c=>((c.locator as Row).file as Row).page===2));
 const copied=await op('newVersion',{documentId:d.documentId,fromVersionId:d.versionId,expectedVersion:2});const next={...d,versionId:String(copied.id),expectedVersion:3,expectedEditVersion:1};
 const replace=await op('replaceFile',{...next,...upload(Buffer.from('%PDF-corrupt'),'损坏替换.pdf')});assert.equal((await run(replace.jobId)).status,'failed');assert.equal(((await op('detail',{documentId:d.documentId})).document as Row).published_version_id,d.versionId);
 await op('retire',{documentId:d.documentId,expectedVersion:3});
});
test('K07 managers inherit originals/upload without employment or cross-tenant leakage',async()=>{
 for(const role of ['admin','super_admin']){const aid=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password) values(${prefix+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`)))!.id);admins.push(aid);assert.ok((await readOriginal({enterpriseId:eid,adminId:aid},String(published.documentId),String(published.versionId))).data);
  const created=await new KnowledgeService({enterpriseId:eid,adminId:aid}).execute('createFile',upload(),randomUUID());assert.equal((await run(created.jobId)).status,'succeeded');}
 await assert.rejects(readOriginal({enterpriseId:tenants[1],adminId:aid},String(published.documentId),String(published.versionId)),/assistant_capability_forbidden/);
});
test('K07 internal file publication and unreviewed drafts cannot enter customer evidence',async()=>{
 const d=await create();await op('metadata',{documentId:d.documentId,expectedVersion:1,audience:'staff_internal'});d.expectedVersion=2;await ready(d);await op('publish',d);
 const result=await retrieveKnowledge(cid,actor,'TEST-A材料示例厚度和前提地暖',await epoch());assert.ok(result.evidence.every(e=>e.ref.version!==d.versionId));
 assert.ok(result.diagnostic.candidates.every(c=>c.ref.version!==d.versionId));
});
test('K08 revocation during real local parse discards the late result and fences the attempt',async()=>{
 const d=await create(),lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,d.jobId);
 await runKnowledgeJob(lease,{chunk:chunkDocument,embedding:embeddingGateway(),parse:async(bytes,format)=>{const parsed=await parseSourceFile(bytes,format);await op('retire',{documentId:d.documentId,expectedVersion:1});return parsed;}});
 assert.equal((await op('job',{jobId:d.jobId})).status,'cancelled');assert.equal((await latest(d)).edit_version,1);assert.equal(((await latest(d)).source_file as Row).parsed,null);
 const attempts=await withTenantTransaction(eid,tx=>rows(tx,sql`select status,error_code from app.assistant_knowledge_attempts where enterprise_id=${eid} and job_id=${String(d.jobId)}`));assert.equal(attempts[0].status,'failed');assert.equal(attempts[0].error_code,'context_changed');
});
test('K08 answer and original source projection survive reentry and invalidate on withdrawal',async()=>{
 const sent=await customer.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text:'TEST-A材料示例厚度与地暖前提'}]}),lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);
 const model:TextModelGateway={capabilities:{streaming:false,toolCalling:false,usage:false},generate:async input=>{const e=JSON.parse(input.messages[1].content).evidence;const chosen=e.find((e:{text:string})=>e.text.includes('TEST-A'));assert.ok(chosen);return{text:JSON.stringify({selections:[chosen.selectionId]}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};}};
 await processAnswer(lease,{model});assert.equal((await customer.run(lease.runId)).status,'succeeded');const history=await customer.messages(cid);const answer=(history.items as Row[]).find(m=>m.authorKind==='assistant')!;assert.ok(answer);messageId=String(answer.id);citationId=String((answer.citations as Row[])[0].id);
 const cite=await customer.citation(citationId);assert.equal(cite.available,true);assert.ok('sourceLocation' in cite && 'sourceFile' in cite && 'quote' in cite);assert.match(String(cite.sourceLocation),/合成材料.docx/);assert.ok(cite.sourceFile);assert.match(String(cite.quote),/TEST-A|2 mm/);
 await op('retire',{documentId:published.documentId,expectedVersion:2});assert.equal((await customer.citation(citationId)).available,false);assert.equal(((await customer.messages(cid)).items as Row[]).find(m=>m.id===messageId)?.available,false);
 await assert.rejects(readOriginal(service.actor,String(published.documentId),String(published.versionId)),/assistant_resource_not_found/);
});
