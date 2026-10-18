import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { documents,unanswerable } from '../../../scripts/xiaok-embedding/recall-fixture';
import { withPlatformTransaction,withTenantTransaction } from '@/db/transaction';
import { one,rows,type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob,runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { conversationKnowledgeRetriever } from '@/lib/assistant/knowledge/retriever';
import { safeText,type ActorContext } from '@/lib/assistant/contracts';

// Synthetic only. Automated source/quotation checks cannot replace business semantic review.
const enabled=process.env.ASSISTANT_LIVE_TEXT==='1';
const prefix='quality-test-'+randomUUID(),tenants:string[]=[],users:string[]=[],versions=new Map<string,string>();
const results:Row[]=[];
let actor:ActorContext;
before(async()=>{
  if(!enabled)return;
  loadEnvConfig(process.cwd());const url=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'55432');assert.equal(url.pathname,'/xiaok_embedding_eval');
  await withPlatformTransaction(async tx=>{
    const role=(await one(tx,sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`))!;assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
    assert.equal(Number((await one(tx,sql`select count(*) n from app.assistant_jobs where status in ('queued','running')`))!.n),0,'Run acceptance serially on an idle isolated queue');
    const e=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!;tenants.push(String(e.id));
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${String(e.id)},true,1000,12000000,1000000000,90)`);
    const a=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${String(e.id)},${prefix},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;
    const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;users.push(String(u.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix})`);
    actor={enterpriseId:String(e.id),principal:{kind:'user',userId:String(u.id)},contextVersion:1,capabilities:['assistant.chat.self']};
    actor.entry={fixtureAdminId:String(a.id)};
  });
  const knowledge=new KnowledgeService({enterpriseId:actor.enterpriseId,adminId:String(actor.entry!.fixtureAdminId)});delete actor.entry;
  for(const [topic,body] of documents) {
    const d=await knowledge.execute('create',{title:topic,sourceType:'manual_text',audience:'customer_public',body},randomUUID());
    const input={documentId:String((d.document as Row).id),versionId:String((d.draft as Row).id),expectedVersion:1,expectedEditVersion:1};
    await knowledge.execute('index',input,randomUUID());const lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.actor.enterpriseId,actor.enterpriseId);await runKnowledgeJob(lease);
    assert.equal((await knowledge.execute('job',{jobId:lease.jobId})).status,'succeeded');
    await knowledge.execute('publish',input,randomUUID());versions.set(topic,input.versionId);
  }
});
after(async()=>{
  if(!enabled)return;
  try {
    const folder=path.resolve(process.cwd(),'../tmp/xiaok-vector');await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'phase1c-quality.json'),JSON.stringify({schemaVersion:1,fixture:'synthetic-renovation-25-documents-v1',createdAt:new Date().toISOString(),
      businessReview:'pending; synthetic fixtures do not satisfy real-enterprise A10',results},null,2));
  } finally {
    await withPlatformTransaction(async tx=>{
      for(const eid of tenants){await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}
      for(const uid of users)await tx.execute(sql`delete from app.users where id=${uid}`);
    });await closePostgresPool();
  }
});
test('60 Chinese questions through production retrieval, model, persistence and citation projection', {skip:!enabled},async()=>{
  const chat=new ConversationService(actor);
  const cases=[...documents.flatMap(([topic,source,...questions])=>questions.map(question=>({topic,source,question,expected:'grounded'}))),
    ...unanswerable.map(question=>({topic:'unsupported',source:'',question,expected:'insufficient_evidence'}))];
  assert.equal(documents.length,25);assert.equal(cases.length,60);assert.equal(unanswerable.length,10);
  // Check the known lexical paraphrase regression against real embeddings before
  // spending model calls on the complete fixture; expected documents stay unchanged.
  const probe=await chat.create(randomUUID());
  const epoch=await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`));
  const candidates=await conversationKnowledgeRetriever(String(probe.id)).retrieve(actor,'签装修合同之前重点看什么？',Number(epoch!.knowledge_epoch));
  assert.ok(candidates.some(e=>e.ref.version===versions.get('contract')),'Signing-policy document missing from authorized top-five recall');
  // Reserve/claim sequentially; only external work overlaps. Never run queue-consuming suites concurrently.
  for(let offset=0;offset<cases.length;offset+=3) {
    // Respect the product's 30 requests/minute guard even when the model is fast.
    if(offset)await delay(6500);
    const batch=[];
    for(const c of cases.slice(offset,offset+3)) {
      const conversation=await chat.create(randomUUID());
      const run=await chat.send(String(conversation.id),randomUUID(),{version:1,blocks:[{type:'text',text:c.question}]});
      const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,run.runId);
      batch.push({c,conversation,run,lease});
    }
    await Promise.all(batch.map(async({c,conversation,run,lease})=>{
    const started=Date.now();
    await processAnswer(lease);
    const terminal=await chat.run(String(run.runId));
    const answer=(await chat.messages(String(conversation.id))).items.find(m=>m.authorKind==='assistant');
    const citations=answer?.citations || [];
    const expectedVersion=versions.get(c.topic);
    const expectedSource=citations.some(cite=>'version' in cite && String(cite.version)===expectedVersion);
    const validQuotes=citations.length>0 && citations.every(cite=>'quote' in cite && 'version' in cite && documents.some(([topic,body])=>versions.get(topic)===String(cite.version) && body.includes(String(cite.quote))));
    const answerText=answer?safeText(answer.content as Parameters<typeof safeText>[0]):null;
    const deliveredText=answer?(answer.content as {blocks:Array<{type:string;text?:string}>}).blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n'):null;
    const extractive=!!deliveredText && deliveredText===citations.map(cite=>'quote' in cite?String(cite.quote):'').join('\n');
    const passed=terminal.status==='succeeded' && terminal.answerKind===c.expected && (c.expected==='grounded' ? expectedSource && validQuotes && extractive : citations.length===0);
    const usage=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select category,quantity::text,input_tokens::text,output_tokens::text,measurement_kind from app.assistant_usage_records where run_id=${String(run.runId)} order by category`));
    const providers=await withTenantTransaction(actor.enterpriseId,tx=>rows(tx,sql`select id::text,provider_key,logical_model_key,remote_model,status from app.ai_provider_attempts where assistant_run_id=${String(run.runId)}`));
    results.push({...c,status:terminal.status,errorCode:terminal.errorCode,answerKind:terminal.answerKind,answer:answerText,citations,expectedSource,validQuotes,extractive,passed,durationMs:Date.now()-started,usage,providers});
    console.log(JSON.stringify({case:results.length,topic:c.topic,status:terminal.status,errorCode:terminal.errorCode,kind:terminal.answerKind,passed,durationMs:Date.now()-started}));
    }));
  }
  const supported=results.filter(r=>r.expected==='grounded'),unsupported=results.filter(r=>r.expected==='insufficient_evidence');
  console.log(JSON.stringify({supported:supported.filter(r=>r.passed).length,total:supported.length,unsupported:unsupported.filter(r=>r.passed).length,unsupportedTotal:unsupported.length}));
  assert.equal(results.filter(r=>r.status!=='succeeded').length,0,'Technical failures are not accepted as quality misses');
  assert.ok(supported.filter(r=>r.passed).length/supported.length>=0.9,'Expected-source citation coverage below 90%; inspect phase1c-quality.json, never treat as semantic business approval');
  assert.equal(unsupported.filter(r=>r.passed).length,unsupported.length,'Unsupported question must not produce a commitment or claim');
});
