import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { chunkDocument } from '@/lib/assistant/knowledge/chunk-gateway';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { conversationKnowledgeRetriever } from '@/lib/assistant/knowledge/retriever';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { GET, POST } from '@/app/api/assistant/knowledge/[...path]/route';

const tenants:string[]=[],admins:string[]=[],users:string[]=[],services:KnowledgeService[]=[],actors:ActorContext[]=[],conversations:string[]=[];
const prefix='knowledge-test-'+randomUUID();
before(async()=>{
  loadEnvConfig(process.cwd());
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.equal(url.pathname,'/xiaok_embedding_eval','Knowledge acceptance must use the isolated vector clone');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++) {
      const t=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;
      const eid=String(t.id);tenants.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,1200000,100000000,90)`);
      const admin=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${eid},${prefix+i},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;
      admins.push(String(admin.id));services.push(new KnowledgeService({enterpriseId:eid,adminId:String(admin.id)}));
      const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!;
      users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix+i})`);
      actors.push({enterpriseId:eid,principal:{kind:'user',userId:String(u.id)},contextVersion:1,capabilities:['assistant.chat.self']});
    }
  });
  for(const a of actors) conversations.push(String((await new ConversationService(a).create(randomUUID())).id));
});
after(async()=>{
  await withPlatformTransaction(async tx=>{
    for(const eid of tenants) {await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}
    for(const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`);
  });
  await closePostgresPool();
});
const exec=(action:string,input:Row={},tenant=0)=>services[tenant].execute(action,input,randomUUID());
async function create(body='防水施工完成后必须进行48小时闭水试验，楼下确认没有渗漏后才能铺砖。',tenant=0,audience='customer_public') {
  const r=await exec('create',{title:'卫生间防水验收',sourceType:'manual_text',audience,body},tenant);
  return {documentId:String((r.document as Row).id),versionId:String((r.draft as Row).id),expectedVersion:1,expectedEditVersion:1};
}
async function epoch(tenant=0) {return Number((await withTenantTransaction(tenants[tenant],tx=>one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${tenants[tenant]}`)))!.knowledge_epoch);}
async function indexed(d:Row,tenant=0) {
  const job=await exec('index',d,tenant);const lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,job.jobId);
  await runKnowledgeJob(lease);
  assert.equal((await exec('job',{jobId:job.jobId},tenant)).status,'succeeded');
  return job;
}
async function retrieve(tenant=0,gateway=embeddingGateway()) {return conversationKnowledgeRetriever(conversations[tenant],gateway).retrieve(actors[tenant],'卫生间防水要闭水测试多长时间？',await epoch(tenant));}

test('real tokenizer preserves Chinese/emoji Unicode and bounds every chunk; draft cannot publish',async()=>{
  const value=('中文防水验收与装修材料😀。'.repeat(100));
  const chunks=await chunkDocument(value);assert.ok(chunks.length>1);
  assert.ok(chunks.every(c=>c.tokens<=512 && !c.text.includes('\ufffd')));
  const d=await create();await assert.rejects(exec('publish',d),/knowledge_not_ready/);
  await exec('retire',d);
});
let published:Row;
test('real Qwen index, deduplication, publish and Chinese recall; published content is immutable',async()=>{
  published=await create();
  const job=await indexed(published);
  assert.equal((await exec('index',published)).jobId,job.jobId);
  await exec('publish',published);
  assert.ok((await retrieve()).some(e=>e.text.includes('48小时')));
  await assert.rejects(exec('edit',{...published,body:'篡改已发布内容'}),/version_conflict/);
  await assert.rejects(withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_knowledge_versions set body='tampered' where id=${String(published.versionId)}`)));
  await assert.rejects(exec('publish',published),/version_conflict/);
  const attempts=await withTenantTransaction(tenants[0],tx=>rows(tx,sql`select operation,status,input_tokens from app.assistant_knowledge_attempts where job_id=${String(job.jobId)}`));
  assert.ok(attempts.some(a=>a.operation==='embed' && a.status==='succeeded' && Number(a.input_tokens)>0));
});
test('RLS and authorization exclude other tenant, staff-only, future and retired sources',async()=>{
  const other=await create('另一企业的防水测试为999小时。',1);await indexed(other,1);await exec('publish',other,1);
  assert.equal((await withTenantTransaction(tenants[1],tx=>rows(tx,sql`select id from app.assistant_knowledge_documents where id=${String(published.documentId)}`))).length,0);
  await assert.rejects(exec('detail',{documentId:published.documentId},1),/assistant_resource_not_found/);
  const internal=await create('内部防水成本888元。',0,'staff_internal');await indexed(internal);await exec('publish',internal);
  const future=await create('未来防水新规777小时。');await exec('edit',{...future,effectiveFrom:'2099-01-01T00:00:00Z'});future.expectedEditVersion=2;
  await indexed(future);await exec('publish',future);
  const results=await retrieve();assert.ok(results.every(e=>!/[987]{3}/.test(e.text)));
  const oldEpoch=await epoch();await exec('retire',{...published,expectedVersion:2});
  await assert.rejects(conversationKnowledgeRetriever(conversations[0]).retrieve(actors[0],'防水',oldEpoch),/context_changed/);
  assert.equal((await retrieve()).length,0);
});
test('same-body edit cancels running index and fences late completion',async()=>{
  const d=await create();const j=await exec('index',d);const lease=await claimKnowledgeJob();assert.ok(lease);
  await runKnowledgeJob(lease,{chunk:async value=>{
    await exec('edit',d);return chunkDocument(value);
  },embedding:embeddingGateway()});
  assert.equal((await exec('job',{jobId:j.jobId})).status,'cancelled');
  const detail=await exec('detail',{documentId:d.documentId});assert.equal((detail.versions as Row[])[0].index_status,'pending');
  d.expectedEditVersion=2;await indexed(d);await exec('publish',d);
});
test('unknown dispatch is durable and not automatically replayed; old published version stays available',async()=>{
  const d=await create();await indexed(d);await exec('publish',d);
  const next=await exec('newVersion',{documentId:d.documentId,fromVersionId:d.versionId,expectedVersion:2});
  const v={documentId:d.documentId,versionId:String(next.id),expectedEditVersion:1,expectedVersion:3};
  const j=await exec('index',v), lease=await claimKnowledgeJob();assert.ok(lease);
  await runKnowledgeJob(lease,{chunk:async()=>{throw new Error('ambiguous timeout');},embedding:embeddingGateway()});
  assert.equal((await exec('job',{jobId:j.jobId})).status,'indeterminate');
  assert.equal((await exec('index',v)).jobId,j.jobId);
  assert.equal(await claimKnowledgeJob(),null);
  assert.ok((await retrieve()).some(e=>e.ref.version===d.versionId));
  await assert.rejects(exec('publish',v),/knowledge_not_ready/);
});
test('permission and membership are rechecked after remote I/O',async()=>{
  const gateway=embeddingGateway();
  const wrapped={profile:gateway.profile,embed:async(...args:Parameters<typeof gateway.embed>)=>{
    const result=await gateway.embed(...args);
    await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now() where conversation_id=${conversations[0]}`));
    return result;
  }};
  await assert.rejects(retrieve(0,wrapped),/assistant_resource_not_found/);
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.admin_users set menu_permissions='{}' where id=${admins[0]}`));
  await assert.rejects(exec('list'),/assistant_capability_forbidden/);
});

test('HTTP role boundary, strict input and idempotent FAQ creation without UI',async()=>{
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${admins[0]}`));
  const token=async(role='enterprise_admin',aud?:string)=>{
    let jwt=new SignJWT({id:admins[0],enterpriseId:tenants[0],role,username:prefix}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m');
    if(aud) jwt=jwt.setAudience(aud);
    return jwt.sign(new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123'));
  };
  const context={params:Promise.resolve({path:['documents']})};
  const request=(auth:string,body?:Row,key=randomUUID())=>new NextRequest('http://localhost:3006/api/assistant/knowledge/documents',{
    method:body?'POST':'GET',headers:{authorization:'Bearer '+auth,'idempotency-key':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal((await GET(request(await token('designer')),context)).status,403);
  assert.equal((await GET(request(await token('enterprise_admin','miniprogram')),context)).status,401);
  const auth=await token(),key=randomUUID(),body={title:'费用说明',sourceType:'faq',audience:'customer_public',faq:[{question:'量房收费吗？',answer:'在本企业服务区域内首次量房免费。'}]};
  assert.equal((await POST(request(auth,{...body,enterpriseId:tenants[1]}),context)).status,422);
  const first=await POST(request(auth,body,key),context),second=await POST(request(auth,body,key),context);
  assert.equal(first.status,200);assert.deepEqual(await first.json(),await second.json());
  assert.equal((await POST(request(auth,{...body,title:'改写请求'},key),context)).status,409);
});

test('expired lease is fenced and revoked manager cannot complete a dispatched index',async()=>{
  const d=await create(),job=await exec('index',d),old=await claimKnowledgeJob();assert.ok(old);
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()-interval '1 second' where id=${old.jobId}`));
  const replacement=await claimKnowledgeJob();assert.ok(replacement);assert.notEqual(old.token,replacement.token);
  await runKnowledgeJob(old);assert.equal((await exec('job',{jobId:job.jobId})).status,'running');
  await runKnowledgeJob(replacement,{chunk:async value=>{
    const chunks=await chunkDocument(value);
    await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${admins[0]}`));
    return chunks;
  },embedding:embeddingGateway()});
  const state=await withTenantTransaction(tenants[0],tx=>one(tx,sql`select status from app.assistant_jobs where id=${old.jobId}`));
  assert.equal(state!.status,'failed');
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.admin_users set status='active' where id=${admins[0]}`));
  const detail=await exec('detail',{documentId:d.documentId});assert.equal((detail.versions as Row[])[0].index_status,'failed');
});

test('audience, effective time, profile and current version are enforced before ranking',async()=>{
  await withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_participants set status='active',revoked_at=null where conversation_id=${conversations[0]}`));
  const d=await create('本公司防水验收必须闭水测试48小时。');await indexed(d);await exec('publish',d);
  await exec('metadata',{documentId:d.documentId,expectedVersion:2,audience:'staff_internal'});
  assert.ok((await retrieve()).every(e=>e.ref.version!==d.versionId));
  await exec('metadata',{documentId:d.documentId,expectedVersion:3,audience:'customer_public'});
  assert.ok((await retrieve()).some(e=>e.ref.version===d.versionId));
  const v=await exec('newVersion',{documentId:d.documentId,expectedVersion:4,fromVersionId:d.versionId});
  const next={documentId:d.documentId,versionId:String(v.id),expectedEditVersion:1,expectedVersion:5};
  await indexed(next);
  // Validity is a database fact, independent of an application host clock lag.
  const applicationNow=Date.now;Date.now=()=>applicationNow()-60000;
  try{await exec('publish',next);}finally{Date.now=applicationNow;}
  assert.ok((await retrieve()).every(e=>e.ref.version!==d.versionId));
  assert.ok((await retrieve()).some(e=>e.ref.version===next.versionId));
  const expired=await create('过期防水政策。');
  await exec('edit',{...expired,effectiveFrom:'2020-01-01T00:00:00Z',effectiveTo:'2021-01-01T00:00:00Z'});expired.expectedEditVersion=2;
  await indexed(expired);await assert.rejects(exec('publish',expired),/knowledge_not_ready/);
  await withTenantTransaction(tenants[0],async tx=>{
    const profile=(await one(tx,sql`select * from app.assistant_knowledge_index_profiles where enterprise_id=${tenants[0]} limit 1`))!;
    const other=(await one(tx,sql`insert into app.assistant_knowledge_index_profiles(enterprise_id,profile_key,configuration)
      values(${tenants[0]},'other-1024','{"dimensions":1024}') returning id`))!;
    await tx.execute(sql`update app.assistant_knowledge_chunks set index_profile_id=${String(other.id)} where document_version_id=${next.versionId}`);
    assert.notEqual(String(profile.id),String(other.id));
  });
  assert.ok((await retrieve()).every(e=>e.ref.version!==next.versionId));
});
