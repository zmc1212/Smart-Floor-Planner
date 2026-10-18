import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { GET, POST } from '@/app/api/assistant/knowledge/[...path]/route';
import { GET as previewGET, POST as previewPOST } from '@/app/api/assistant/preview/[...path]/route';
import { proxy } from '@/proxy';
import type { ActorContext, TextModelGateway } from '@/lib/assistant/contracts';

const prefix='assistant-platform-'+randomUUID(),tenants:string[]=[],bound:string[]=[],platform:string[]=[];
const roles=['super_admin','admin'];
const published:Row[]=[];
before(async()=>{
  loadEnvConfig(process.cwd());
  const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++) {
      const t=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;
      const eid=String(t.id);tenants.push(eid);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,1200000,100000000,90)`);
      bound.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${eid},${prefix+'bound'+i},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id));
      platform.push(String((await one(tx,sql`insert into app.admin_users(username,password_hash,role,status,must_change_password)
        values(${prefix+roles[i]},'test-only',${roles[i]},'active',false) returning id`))!.id));
    }
  });
});
after(async()=>{
  await withPlatformTransaction(async tx=>{
    for(const eid of tenants) {await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}
    for(const aid of platform)await tx.execute(sql`delete from app.admin_users where id=${aid}`);
  });await closePostgresPool();
});
const context=(path:string[])=>({params:Promise.resolve({path})});
const manager=(i=0,tenant=0)=>new KnowledgeService({enterpriseId:tenants[tenant],adminId:platform[i]});
const actor=(i=0,tenant=0):ActorContext=>({enterpriseId:tenants[tenant],principal:{kind:'admin',adminId:platform[i]},contextVersion:1,capabilities:['assistant.preview.self']});
async function token(i=0) {return new SignJWT({id:platform[i],role:roles[i],enterpriseId:null,permissions:[]}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));}
async function request(i=0,tenant:string|null=tenants[0],body?:Row) {
  return new NextRequest('http://localhost:3006/api/assistant/knowledge/documents',{method:body?'POST':'GET',
    headers:{cookie:`auth_token=${await token(i)}${tenant===null?'':`; global_tenant_id=${tenant}`}`,'Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});
}
const body={title:'施工交底参考',sourceType:'manual_text',audience:'customer_public',body:'水电开工前应确认图纸、施工费用和开关插座点位。'};

test('both platform roles enter the page with old permission claims; knowledge API requires selected enterprise',async()=>{
  for(let i=0;i<2;i++) {
    const page=new NextRequest('http://localhost:3006/assistant-knowledge',{headers:{cookie:`auth_token=${await token(i)}`}});
    assert.equal((await proxy(page)).headers.get('location'),null);
    assert.equal((await GET(await request(i,null),context(['documents']))).status,400);
    assert.equal((await GET(await request(i,'all'),context(['documents']))).status,400);
    assert.equal((await GET(await request(i),context(['documents']))).status,200);
    assert.equal((await POST(await request(i,tenants[0],{...body,enterpriseId:tenants[1]}),context(['documents']))).status,422);
  }
});

test('global operator IDs survive real indexing/publication and tenant RLS is restored after authorization',async()=>{
  for(let i=0;i<2;i++) {
    const created=await POST(await request(i,tenants[0],{...body,title:body.title+roles[i]}),context(['documents']));
    assert.equal(created.status,200);const data=(await created.json()).data;
    const d={documentId:String(data.document.id),versionId:String(data.draft.id),expectedVersion:1,expectedEditVersion:1};published.push(d);
    const service=manager(i);const job=await service.execute('index',d,randomUUID());
    const lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,job.jobId);
    await runKnowledgeJob(lease);assert.equal((await service.execute('job',{jobId:lease.jobId})).status,'succeeded');
    await service.execute('publish',d,randomUUID());
    const detail=await service.execute('detail',{documentId:d.documentId});
    assert.equal(String((detail.document as Row).created_by),platform[i]);
    assert.equal(String((detail.versions as Row[])[0].published_by),platform[i]);
    await withTenantTransaction(tenants[1],async tx=>{
      await authorizeKnowledgeManager(tx,tenants[1],platform[i]);
      assert.equal((await one(tx,sql`select current_setting('app.is_platform_admin') flag`))!.flag,'false');
      assert.equal((await rows(tx,sql`select id from app.assistant_knowledge_documents where id=${d.documentId}`)).length,0);
    });
    await assert.rejects(manager(i,1).execute('detail',{documentId:d.documentId}),/assistant_resource_not_found/);
  }
});

test('platform preview produces a cited answer and remains private to its actor and selected enterprise',async()=>{
  const response=await previewPOST(await request(0,tenants[0],{audience:'customer_public'}),context(['conversations']));
  assert.equal(response.status,200);const cid=(await response.json()).data.id;
  const service=new ConversationService(actor());
  const run=await service.send(cid,randomUUID(),{version:1,blocks:[{type:'text',text:'水电开工前应确认什么？'}]});
  const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,run.runId);
  const model:TextModelGateway={capabilities:{streaming:false,toolCalling:false,usage:false},generate:async input=>{
    const evidence=JSON.parse(input.messages[1].content).evidence;assert.ok(evidence.length);
    return {text:JSON.stringify({selections:[evidence[0].selectionId]}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};
  }};
  await processAnswer(lease,{model});
  assert.equal((await service.run(String(run.runId))).answerKind,'grounded');
  const messages=await service.messages(cid),answer=messages.items.find(m=>m.authorKind==='assistant')!;
  assert.ok(answer.citations.length);assert.equal((await service.citation(answer.citations[0].id)).available,true);
  assert.equal((await previewGET(await request(0),context(['conversations',cid]))).status,200);
  assert.equal((await previewGET(await request(1),context(['conversations',cid]))).status,404);
  assert.equal((await previewGET(await request(0,tenants[1]),context(['conversations',cid]))).status,404);
});

test('current database status, password requirement and role still revoke access with a stale platform token',async()=>{
  for(const update of [sql`status='disabled'`,sql`must_change_password=true`,sql`role='viewer'`]) {
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set ${update} where id=${platform[0]}`));
    assert.equal((await GET(await request(0),context(['documents']))).status,403);
    assert.equal((await previewGET(await request(0),context(['conversations']))).status,403);
    await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active',must_change_password=false,role='super_admin' where id=${platform[0]}`));
  }
  await assert.rejects(new KnowledgeService({enterpriseId:tenants[1],adminId:bound[0]}).execute('list'),/assistant_capability_forbidden/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set menu_permissions='{}' where id=${bound[0]}`));
  await assert.rejects(new KnowledgeService({enterpriseId:tenants[0],adminId:bound[0]}).execute('list'),/assistant_capability_forbidden/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set menu_permissions=ARRAY['assistant-knowledge'] where id=${bound[0]}`));
});

test('database reference guard rejects another enterprise operator and index worker rechecks platform revocation',async()=>{
  await assert.rejects(
    withTenantTransaction(tenants[0],tx=>tx.execute(sql`update app.assistant_knowledge_documents set updated_by=${bound[1]} where id=${String(published[0].documentId)}`)),
    (error: unknown) => error instanceof Error && error.cause instanceof Error && /assistant manager does not have access/.test(error.cause.message),
  );
  const service=manager(),created=await service.execute('create',body,randomUUID());
  const d={documentId:String((created.document as Row).id),versionId:String((created.draft as Row).id),expectedEditVersion:1};
  const job=await service.execute('index',d,randomUUID());
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='disabled' where id=${platform[0]}`));
  assert.equal(await claimKnowledgeJob(),null);
  const state=await withTenantTransaction(tenants[0],tx=>one(tx,sql`select status,last_error from app.assistant_jobs where id=${String(job.jobId)}`));
  assert.equal(state!.status,'failed');assert.equal(state!.last_error,'assistant_capability_forbidden');
  await withPlatformTransaction(tx=>tx.execute(sql`update app.admin_users set status='active' where id=${platform[0]}`));
});
