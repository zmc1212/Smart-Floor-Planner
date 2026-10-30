/** Real local service checks in the user-designated 微云 enterprise. No model calls. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { type ActorContext, type Evidence } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { SiteChatService, siteActor } from '@/lib/construction/site-chat';
import { ConstructionService } from '@/lib/construction/service';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { reviewBudget } from './assistant-review-budget';

loadEnvConfig(process.cwd(), true);
const root=path.resolve('..'), output=path.resolve(process.argv.find(v=>v.startsWith('--output='))?.slice(9)||path.join(root,'tmp/v1-01-weiyun-jingyi/service-01'));
fs.mkdirSync(output,{recursive:true});
assert.ok(!fs.existsSync(path.join(output,'report.json')),'Keep the original run; choose a fresh --output for a justified repeat');
const eid='1454', pid='237', ownerId='16', observerId='5372';
type Check={name:string;passed:boolean;evidence?:unknown;error?:string};
const report:{startedAt:string;enterpriseId:string;checks:Check[];passed:boolean;configuration?:unknown;fixture?:unknown;error?:string;finishedAt?:string}=
  {startedAt:new Date().toISOString(),enterpriseId:eid,checks:[],passed:false};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
const check=async(name:string,work:()=>Promise<unknown>)=>{try{const evidence=await work();report.checks.push({name,passed:true,evidence});console.log(name+': PASS');}
  catch(error){report.checks.push({name,passed:false,error:(error as Error).message});throw error;}finally{save();}};
const knowledge=new KnowledgeService({enterpriseId:eid,adminId:ownerId});
const owner=new ConstructionService({enterpriseId:eid,adminId:ownerId});
let release:(()=>Promise<void>)|undefined, restoreMember:Row|undefined, cloned:Row|undefined;
async function permissionCheck() {
  await assert.rejects(()=>new SiteChatService({enterpriseId:'2567',adminId:ownerId}).read(pid),/construction_not_found|construction_forbidden|assistant_resource_not_found/);
  await assert.rejects(()=>new SiteChatService({enterpriseId:eid,adminId:observerId}).send(pid,{text:'卫生间防水前要准备哪些？',mediaIds:[],versions:{records:{},issues:{},materials:{},plans:{},resolutions:{}}},randomUUID()),/construction_forbidden/);
  return {crossTenantDenied:true,observerWriteDenied:true};
}
async function waitJob(jobId:string) {
  for(let i=0;i<360;i++) {const job=await knowledge.execute('job',{jobId});if(job.status==='succeeded')return;
    if(['failed','indeterminate','cancelled'].includes(String(job.status)))throw Error(`Retained job ${jobId}: ${job.status}/${job.last_error}`);
    await new Promise(resolve=>setTimeout(resolve,500));}
  throw Error('Knowledge job remains pending; do not resubmit it');
}
async function main(){
  const database=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(database.hostname)&&database.port==='5432'&&database.pathname==='/smart_floor_planner');
  const control=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL;
  console.log('Waiting for the existing acceptance lock; business fixtures remain in 微云/1454.');
  release=await lockAssistantAcceptance(control,{waitForLock:true});
  // The first audit found no active admin-role control. Supply a labelled local
  // account with an unusable login hash; never turn a real account into a role fixture.
  await withPlatformTransaction(async tx=>{
    const existing=await one(tx,sql`select id from app.admin_users where role='admin' and status='active' and not must_change_password limit 1`);
    if(!existing)await tx.execute(sql`insert into app.admin_users(username,display_name,password_hash,role,status,must_change_password,menu_permissions)
      values('synthetic-v1-microcloud-platform-admin','合成测试·微云V1平台管理员','unusable-synthetic-local-fixture','admin','active',false,ARRAY['construction-projects'])`);
  });
  if(process.argv.includes('--permissions-only')) {await check('exact cross-enterprise and observer permission errors',permissionCheck);report.passed=true;return;}
  await check('approved enterprise, labelled fixture and unchanged configured model',async()=>{
    const actual=await withPlatformTransaction(tx=>one(tx,sql`select id,name from app.enterprises where id=${eid}`));assert.equal(actual?.name,'微云');
    const detail=await owner.execute('detail',{projectId:pid});assert.match(String((detail.project as Row).name),/^合成手测/);
    const roles=await withPlatformTransaction(tx=>rows(tx,sql`select distinct on(role) id,role from app.admin_users
      where status='active' and not must_change_password and role in ('enterprise_admin','admin','super_admin')
      and (enterprise_id=${eid} or role in ('admin','super_admin')) order by role,id`));
    report.configuration=await withTenantTransaction(eid,tx=>one(tx,sql`select enabled,agent_config,active_index_profile_id from app.assistant_enterprise_settings where enterprise_id=${eid}`));
    return {enterprise:actual,projectId:pid,managementRoles:roles,budgetBefore:reviewBudget(root).usedMicros};
  });
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-manual-fixture-20261030/manifest.json'),'utf8'));
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:String(fixture.customerId)},contextVersion:Number(fixture.userContextVersions[fixture.customerId]),
    capabilities:['assistant.chat.self'],entry:{kind:'lead',id:'3132'}};
  const customer=new ConversationService(actor), c=await customer.create(randomUUID()), cid=String(c.id);
  const worker=siteActor({enterpriseId:eid,adminId:'5371'}), designer=siteActor({enterpriseId:eid,adminId:'5368'});
  const shared=await new SiteChatService({enterpriseId:eid,adminId:'5371'}).read(pid), sharedId=String(shared.conversationId);
  const epoch=async()=>Number((await withTenantTransaction(eid,tx=>one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`)))!.knowledge_epoch);
  report.fixture={customerConversationId:cid,sharedConversationId:sharedId,projectId:pid};save();
  await check('same 精艺 construction question retrieves real indexed source for customer, worker, designer and management roles',async()=>{
    const managers=await withPlatformTransaction(tx=>rows(tx,sql`select distinct on(role) id,role from app.admin_users where status='active'
      and not must_change_password and role in ('enterprise_admin','admin','super_admin') and (enterprise_id=${eid} or role in ('admin','super_admin')) order by role,id`));
    assert.deepEqual(managers.map(r=>r.role).sort(),['admin','enterprise_admin','super_admin']);
    const results=[];
    for(const [role,a,conversationId] of [['customer',actor,cid],['worker',worker,sharedId],['designer',designer,sharedId],
      ...managers.map(m=>[m.role,siteActor({enterpriseId:eid,adminId:String(m.id)}),sharedId])] as Array<[string,ActorContext,string]>) {
      const result=await retrieveKnowledge(conversationId,a,'防水前基层找平、管根处理和两遍交错涂抹要注意什么？',await epoch());
      assert.ok(result.diagnostic.candidates.some(x=>x.documentId==='405'));
      assert.ok(result.evidence.length);assert.ok(result.diagnostic.candidates.every(x=>!['375',...Array.from({length:28},(_,i)=>String(376+i))].includes(x.documentId)));
      if(role==='customer')assert.ok(result.diagnostic.candidates.every(x=>x.documentId!=='374'));
      if(role!=='customer')assert.equal(result.diagnostic.context.projectId,pid);
      results.push({role,sourceIds:result.diagnostic.candidates.map(x=>x.documentId),stage:result.diagnostic.context.stage});
    }
    return results;
  });
  let savedEvidence:Evidence|undefined;
  await check('published internal original is staff-only; drafts remain excluded',async()=>{
    const source=await withTenantTransaction(eid,tx=>one(tx,sql`select c.text from app.assistant_knowledge_chunks c
      join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
      where c.enterprise_id=${eid} and v.document_id=405 and c.text like '%管道加强%' order by c.ordinal limit 1`));assert.ok(source);
    cloned=await knowledge.execute('create',{sourceType:'manual_text',audience:'staff_internal',title:'合成测试 · 精艺管根原文权限复核',category:'合成测试',body:String(source.text)},randomUUID());
    const documentId=String((cloned.document as Row).id), versionId=String((cloned.draft as Row).id);report.fixture={...report.fixture as Row,temporaryDocumentId:documentId};save();
    const indexed=await knowledge.execute('index',{documentId,versionId,expectedEditVersion:1},randomUUID());await waitJob(String(indexed.jobId));
    await knowledge.execute('publish',{documentId,versionId,expectedVersion:1,expectedEditVersion:1},randomUUID());
    const publicResult=await retrieveKnowledge(cid,actor,String(source.text),await epoch());assert.ok(publicResult.diagnostic.candidates.every(x=>x.documentId!==documentId));
    const internal=await retrieveKnowledge(sharedId,worker,String(source.text),await epoch());
    const match=internal.diagnostic.candidates.find(x=>x.documentId===documentId);assert.ok(match);
    savedEvidence=internal.evidence.find(e=>e.ref.version===versionId);assert.ok(savedEvidence);
    const scoped=await withTenantTransaction(eid,async tx=>{const conversation=await new AssistantRepository(tx,worker).conversation(sharedId);return !!await resolveEvidence(tx,worker,conversation,savedEvidence!);});assert.equal(scoped,true);
    return {temporaryDocumentId:documentId,customerExcluded:true,workerCanRead:true};
  });
  await check('retiring the test source revokes original Evidence without reingestion or model calls',async()=>{
    const documentId=String((cloned!.document as Row).id), detail=await knowledge.execute('detail',{documentId});
    await knowledge.execute('retire',{documentId,expectedVersion:Number((detail.document as Row).version)},randomUUID());
    const available=await withTenantTransaction(eid,async tx=>{const conversation=await new AssistantRepository(tx,worker).conversation(sharedId);return !!await resolveEvidence(tx,worker,conversation,savedEvidence!);});
    assert.equal(available,false);cloned=undefined;return {revoked:true};
  });
  await check('cross-enterprise scope and observer writes are denied',permissionCheck);
  await check('member removal revokes project knowledge immediately and restoration preserves the fixture',async()=>{
    const detail=await owner.execute('detail',{projectId:pid});const member=(detail.members as Row[]).find(m=>String(m.admin_id)===observerId);assert.ok(member?.active);
    assert.ok(!(detail.assignments as Row[]).some(a=>String(a.admin_id)===observerId),'Do not remove a member with retained stage assignments');restoreMember=member;save();
    await owner.execute('member',{projectId:pid,expectedVersion:Number((detail.project as Row).version),adminId:observerId,role:member.role,active:false,workLabel:member.work_label},randomUUID());
    const observer=siteActor({enterpriseId:eid,adminId:observerId});
    const currentEpoch=await epoch();
    await assert.rejects(()=>new SiteChatService({enterpriseId:eid,adminId:observerId}).read(pid),/assistant_resource_not_found|construction_not_found/);
    await assert.rejects(()=>retrieveKnowledge(sharedId,observer,'管根处理',currentEpoch),/assistant_resource_not_found/);
    return {readDenied:true,retrievalDenied:true};
  });
  await check('real HTTP503 retrieval failure stays failed and a later real retrieval recovers',async()=>{
    const server=http.createServer((_request,response)=>{response.writeHead(503);response.end('synthetic unavailable');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {const address=server.address() as {port:number};const gateway=embeddingGateway({url:`http://127.0.0.1:${address.port}`,apiKey:'synthetic-local-test'}),currentEpoch=await epoch();
      await assert.rejects(()=>retrieveKnowledge(cid,actor,'防水前需要核对什么？',currentEpoch,gateway),/retrieval_unavailable/);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
    const result=await retrieveKnowledge(cid,actor,'防水前需要核对什么？',await epoch());assert.ok(result.evidence.length);return {real503:true,recovered:true};
  });
  report.passed=true;
  // Keep both the full observed run result and original failure evidence outside user prompts.
}
main().catch(error=>{report.error=(error as Error).message;process.exitCode=1;console.error(report.error);}).finally(async()=>{
  try {
    if(restoreMember) {const detail=await owner.execute('detail',{projectId:pid});await owner.execute('member',{projectId:pid,expectedVersion:Number((detail.project as Row).version),
      adminId:observerId,role:restoreMember.role,active:restoreMember.active,workLabel:restoreMember.work_label},randomUUID());}
    if(cloned) {const documentId=String((cloned.document as Row).id),detail=await knowledge.execute('detail',{documentId});if((detail.document as Row).status!=='retired')await knowledge.execute('retire',{documentId,expectedVersion:Number((detail.document as Row).version)},randomUUID());}
  }catch(error){report.passed=false;report.error='Cleanup: '+(error as Error).message;process.exitCode=1;}
  finally{if(release)await release();report.finishedAt=new Date().toISOString();save();await closePostgresPool();}
});
