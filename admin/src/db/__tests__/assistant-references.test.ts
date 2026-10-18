import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAgentAnswer } from '@/lib/assistant/agent/worker';
import { recommendReferences } from '@/lib/assistant/knowledge/reference-service';
import { HandoffService } from '@/lib/assistant/handoff/service';
import type { ActorContext } from '@/lib/assistant/contracts';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { entryContext, fromEntry } from '@/lib/assistant/application/auth';
import { readContentEntry } from '@/lib/assistant/knowledge/content-entry';
import { SignJWT } from 'jose';
import { createStaffActivityToken, hashReferrerNetworkToken } from '@/db/repositories/referrer-network-repository';

const prefix='reference-'+randomUUID(), tenants:string[]=[], admins:string[]=[], users:string[]=[];
const channelCodes:string[]=[];
let actor:ActorContext, other:ActorContext, manager:KnowledgeService, imageBase64:string;
let priorProvider:Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>|undefined;
const live=process.env.ASSISTANT_P2M_LIVE==='1';
before(async()=>{
  const url=new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port,'55432'); assert.equal(url.pathname,'/xiaok_embedding_eval');
  if(live){
    const primary=new URL(process.env.ASSISTANT_P2M_PRIMARY_DATABASE_URL||''); assert.ok(['localhost','127.0.0.1'].includes(primary.hostname)); assert.equal(primary.port,'5432'); assert.equal(primary.pathname,'/smart_floor_planner');
    const evalUrl=process.env.DATABASE_URL; await closePostgresPool();
    let provider:Awaited<ReturnType<typeof getPlatformLlmRuntimeConfig>>;
    try{process.env.DATABASE_URL=primary.toString();provider=await getPlatformLlmRuntimeConfig();}finally{await closePostgresPool();process.env.DATABASE_URL=evalUrl;}
    assert.equal(provider.providerKey,'deepseek');assert.equal(new URL(provider.baseUrl).origin,'https://api.deepseek.com');
    priorProvider=await getPlatformLlmRuntimeConfig();await savePlatformLlmConfig({...provider,model:'deepseek-flash'});
  }
  await withPlatformTransaction(async tx=>{
    for(let i=0;i<2;i++){
      const e=(await one(tx,sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!;tenants.push(String(e.id));
      const config={runtime:'langgraph-v1',providerKey:live?'deepseek':'siliconflow',model:live?'deepseek-flash':'Qwen/Qwen3.5-4B',imageInput:true,tools:true,probeVersion:'p2a3-ppt-v1'};
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${tenants[i]},true,1000,12000000,1000000000,30,${JSON.stringify(config)}::jsonb)`);
      const a=(await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${tenants[i]},${prefix+i},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!; admins.push(String(a.id));
      const u=(await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+i},1) returning id`))!;users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix+i})`);
      const code=createStaffActivityToken(BigInt(admins[i]),1);channelCodes.push(code);
      await tx.execute(sql`insert into app.staff_activity_codes(enterprise_id,staff_id,token_hash,status,version) values(${tenants[i]},${admins[i]},${hashReferrerNetworkToken(code)},'active',1)`);
    }
  });
  actor={enterpriseId:tenants[0],principal:{kind:'user',userId:users[0]},contextVersion:1,capabilities:['assistant.chat.self']};
  other={...actor,enterpriseId:tenants[1],principal:{kind:'user',userId:users[1]}};
  manager=new KnowledgeService({enterpriseId:tenants[0],adminId:admins[0]});
  imageBase64=(await sharp({create:{width:300,height:200,channels:3,background:'#adc2a4'}}).png().toBuffer()).toString('base64');
});
after(async()=>{
  try{await withPlatformTransaction(async tx=>{for(const eid of tenants){await deleteAssistantData(tx,BigInt(eid));await tx.execute(sql`delete from app.promotion_scan_audits where enterprise_id=${eid}`);await tx.execute(sql`delete from app.staff_activity_codes where enterprise_id=${eid}`);await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`);await tx.execute(sql`delete from app.enterprises where id=${eid}`);}for(const uid of users)await tx.execute(sql`delete from app.users where id=${uid}`);});}
  finally{try{if(priorProvider)await savePlatformLlmConfig(priorProvider);}finally{await closePostgresPool();}}
});
const exec=(action:string,input:Row={},key=randomUUID())=>manager.execute(action,input,key);
async function create(tag='原木',audience='customer_public'){
  const input={title:tag+'方向参考（自制测试图）',sourceType:'reference_case',audience,body:tag+'收纳参考：可讨论封闭柜与开放格组合。',referenceCase:{source:'隔离测试自制图片，不是实际装修作品',authorization:'测试作者授权，仅供隔离回归',tags:[tag,'收纳'],imageBase64}};
  const key=randomUUID(),r=await exec('create',input,key); assert.deepEqual(JSON.parse(JSON.stringify(await exec('create',input,key))),JSON.parse(JSON.stringify(r)));
  return {documentId:String((r.document as Row).id),versionId:String((r.draft as Row).id),expectedVersion:1,expectedEditVersion:1};
}
async function publish(d:Row){
  const job=await exec('index',d),lease=await claimKnowledgeJob();assert.ok(lease);assert.equal(lease.jobId,job.jobId);
  await runKnowledgeJob(lease,{chunk:async text=>[{text,start:0,end:[...text].length,tokens:40}],embedding:{profile:{model:'test',revision:'test',dimensions:1024},embed:async texts=>({vectors:texts.map(()=>[1,...Array(1023).fill(0)]),usage:{inputTokens:40}})}});
  assert.equal((await exec('job',{jobId:job.jobId})).status,'succeeded');await exec('publish',d);d.expectedVersion=2;
}
async function start(text:string,c?:string){const chat=new ConversationService(actor),id=c||String((await chat.create(randomUUID())).id);const sent=await chat.send(id,randomUUID(),{version:1,blocks:[{type:'text',text}]});const lease=await claimJob();assert.ok(lease);assert.equal(lease.runId,sent.runId);return {chat,c:id,sent,lease};}
const response=(value:unknown):ModelTurnOutput=>({text:JSON.stringify(value),toolCalls:[],usage:{inputTokens:40,outputTokens:20},finishReason:'stop',providerRequestId:null});
const tool=(name:string,args:unknown)=>({...response({}),text:'',toolCalls:[{id:randomUUID(),name,arguments:JSON.stringify(args)}]});
async function recommend(c?:string,query='原木'){
  const a=await start('给我看看'+query+'参考案例',c);await processAgentAnswer(a.lease,{model:async(_m,_t,turn)=>turn===0?tool('recommend_references',{query}):response({kind:'references',resultKey:a.lease.runId+':0:0'})});
  assert.equal((await a.chat.run(String(a.sent.runId))).status,'succeeded');return a;
}
async function preferences(c:string){return withTenantTransaction(actor.enterpriseId,async tx=>(await one(tx,sql`select entry_snapshot from app.assistant_conversations where id=${c}`))?.entry_snapshot as Row);}

test('PPT4-6/14: curator publishes licensed references; customer chat/reentry/source image work without a summary',async()=>{
  const d=await create();await publish(d);
  await assert.rejects(exec('edit',{...d,referenceCase:{source:'x',authorization:'x',tags:['x'],imageBase64}}),/version_conflict/);
  await assert.rejects(withTenantTransaction(actor.enterpriseId,tx=>tx.execute(sql`update app.assistant_knowledge_versions set reference_case=jsonb_set(reference_case,'{source}','"tamper"') where id=${d.versionId}`)),error=>/immutable published reference case/.test(String((error as Error & {cause?:Error}).cause?.message)));
  const a=await recommend();const messages=await a.chat.messages(a.c),answer=messages.items.find(m=>m.authorKind==='assistant')!;
  assert.equal(Number((await withTenantTransaction(actor.enterpriseId,tx=>one(tx,sql`select count(*) n from app.assistant_requirement_summaries where enterprise_id=${actor.enterpriseId} and conversation_id=${a.c}`)))!.n),0,'browsing must not create a style summary');
  assert.match(JSON.stringify(answer),/不是你家的正式施工方案/);assert.equal(answer.citations.length,1);
  const citation=await a.chat.citation(answer.citations[0].id);assert.equal(citation.available,true);assert.ok('reference' in citation);assert.match(JSON.stringify(citation),/测试作者授权/);
  const mini=await signMiniProgramToken({sub:users[0],id:users[0],contextVersion:1,mode:'customer',role:'user',source:'wechat'});
  const { ChatController }=createRequire(import.meta.url)(path.resolve(process.cwd(),'../miniprogram/packages/assistant/lib/chat.js'));
  const controller=new ChatController({emit:()=>{},identity:()=>mini,client:{read:async(target:string)=>{
    const r=await assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant'+target,{headers:{authorization:'Bearer '+mini}}),target.slice(1).split('/'));
    assert.equal(r.status,200);return (await r.json()).data;
  }}});controller.session=mini;controller.conversationId=a.c;
  await controller.openCitation(answer.citations[0].id);assert.equal(controller.state.citation.available,true);assert.equal(controller.state.citation.reference.mimeType,'image/jpeg');
  assert.equal((await new ConversationService(actor).messages(a.c)).items.length,2);
  assert.deepEqual((await preferences(a.c)).referencePreferences,undefined);
  await assert.rejects(new ConversationService(other).citation(answer.citations[0].id),/assistant_resource_not_found/);
  await assert.rejects(new KnowledgeService({enterpriseId:tenants[1],adminId:admins[1]}).execute('detail',{documentId:d.documentId}),/assistant_resource_not_found/);
  await withTenantTransaction(actor.enterpriseId,async tx=>{
    const c=(await one(tx,sql`select * from app.assistant_conversations where id=${a.c}`))!;
    assert.equal((await recommendReferences(tx,actor,c,'不存在的地中海')).length,0);
  });
  await exec('retire',d);
  assert.equal((await a.chat.citation(answer.citations[0].id)).available,false);
  assert.equal((await a.chat.messages(a.c)).items.find(m=>m.authorKind==='assistant')!.available,false);
  await controller.openCitation(answer.citations[0].id);assert.equal(controller.state.citation.available,false);
});
test('explicit preference/correction is durable; browsing and unclear multi-case references do not become a selection',async()=>{
  const d1=await create('简约'),d2=await create('简约');await publish(d1);await publish(d2);
  const a=await recommend(undefined,'简约');
  const browse=await start('我先看看',a.c);await processAgentAnswer(browse.lease,{model:async()=>response({kind:'general',text:'可以慢慢看，也可以直接说想法。'})});assert.equal((await preferences(a.c)).referencePreferences,undefined);
  const unclear=await start('这个喜欢',a.c);await processAgentAnswer(unclear.lease,{model:async(_m,_t,turn)=>turn===0?tool('record_reference_preference',{ordinal:1,quote:'这个喜欢',sentiment:'like'}):response({kind:'general',text:'你说的是第几个参考案例？'})});assert.equal((await preferences(a.c)).referencePreferences,undefined);
  for(const sentiment of ['like','dislike']){
    const quote=sentiment==='like'?'第一个喜欢':'第一个不合适';const b=await start(quote,a.c);
    await processAgentAnswer(b.lease,{model:async(_m,_t,turn)=>turn===0?tool('record_reference_preference',{ordinal:1,quote,sentiment}):response({kind:'general',text:'记下了你的参考偏好，可以继续聊。'})});assert.equal((await b.chat.run(String(b.sent.runId))).status,'succeeded');
  }
  const stored=(await preferences(a.c)).referencePreferences as Row[];assert.equal(stored.length,2);assert.equal(stored[1].supersedes,stored[0].operationId);assert.equal(stored[1].sentiment,'dislike');
  await exec('retire',d2);
  const reentry=await a.chat.messages(a.c);assert.ok(reentry.items.filter(m=>m.authorKind==='assistant').some(m=>!m.available));
  await new HandoffService(actor).customerWrite(a.c,randomUUID(),{action:'request'});
  const staffActor:ActorContext={enterpriseId:actor.enterpriseId,principal:{kind:'admin',adminId:admins[0]},contextVersion:1,capabilities:['assistant.handoff.staff']};
  const staff=new HandoffService(staffActor);await staff.staffWrite(a.c,randomUUID(),{action:'claim'});
  const staffView=await staff.staffRead(a.c);assert.ok((staffView.messages as Row[]).some(m=>String(m.text).includes('所依据的资料已不可用')));
});
test('unmatched, staff-only, future and withdrawn cases are not invented or leaked',async()=>{
  const internal=await create('内部','staff_internal');await publish(internal);
  const future=await create('未来');await exec('edit',{...future,effectiveFrom:'2099-01-01T00:00:00Z'});future.expectedEditVersion=2;await publish(future);
  for(const query of ['内部','未来','不存在的地中海']){const a=await recommend(undefined,query);assert.match(JSON.stringify((await a.chat.messages(a.c)).items),/目前没有匹配且可用的授权参考案例/);}
  const denied=new KnowledgeService({enterpriseId:tenants[0],adminId:admins[1]});await assert.rejects(denied.execute('list'),/assistant_capability_forbidden/);
});
test('source withdrawal and human takeover during generation fence late recommendations',async()=>{
  const d=await create('撤回测试');await publish(d);const a=await start('看看撤回测试参考案例');
  await processAgentAnswer(a.lease,{model:async(_m,_t,turn)=>{if(turn===0)return tool('recommend_references',{query:'撤回测试'});await exec('retire',d);return response({kind:'references',resultKey:a.lease.runId+':0:0'});}});
  assert.equal((await a.chat.messages(a.c)).items.filter(m=>m.authorKind==='assistant').length,0);
  const b=await start('看看参考案例');await processAgentAnswer(b.lease,{model:async()=>{await new HandoffService(actor).customerWrite(b.c,randomUUID(),{action:'request'});return tool('recommend_references',{query:''});}});
  assert.equal((await b.chat.detail(b.c)).mode,'handoff_requested');assert.equal((await b.chat.messages(b.c)).items.filter(m=>m.authorKind==='assistant').length,0);
});
test('official configured model: PPT direction recommendation, explicit preference and no-match', {skip:!live},async()=>{
  const d=await create('原木');await publish(d);
  const a=await start('给我看看原木风格的参考案例');await processAgentAnswer(a.lease);assert.equal((await a.chat.run(String(a.sent.runId))).status,'succeeded');
  const answer=(await a.chat.messages(a.c)).items.find(m=>m.authorKind==='assistant')!;assert.ok(answer.citations.length>0,JSON.stringify(answer));
  const b=await start('第一个案例我喜欢',a.c);await processAgentAnswer(b.lease);assert.equal((await b.chat.run(String(b.sent.runId))).status,'succeeded');assert.equal(((await preferences(a.c)).referencePreferences as Row[]).length,1);
  const c=await start('给我看看地中海参考案例');await processAgentAnswer(c.lease);assert.equal((await c.chat.run(String(c.sent.runId))).status,'succeeded');assert.match(JSON.stringify((await c.chat.messages(c.c)).items),/目前没有匹配且可用的授权参考案例/);
});

test('P2C foundation: signed case entry persists source, native chat reentry and handoff without customer or lead creation in the share',async()=>{
  const d=await create('入口');await publish(d);
  const shared=await exec('share',{documentId:d.documentId,expectedVersion:2});assert.match(String(shared.path),/^\/packages\/assistant\/chat\/chat\?referenceEntry=/);
  const token=new URL('https://local'+shared.path).searchParams.get('referenceEntry')!;
  const payload=await readContentEntry(token);assert.equal(payload.enterpriseId,actor.enterpriseId);assert.equal(payload.documentId,d.documentId);assert.ok(!('userId' in payload));
  const identity={userId:users[0],contextVersion:1,enterpriseId:tenants[1]};
  const entry=await entryContext(identity,{referenceEntry:token});assert.equal(entry.enterprise.id,actor.enterpriseId);assert.match(String(entry.guidanceOpening),/入口/);assert.equal(entry.guidanceEnabled,false);
  const bound=await fromEntry(identity,entry.entryToken),chat=new ConversationService(bound),c=String((await chat.create(randomUUID())).id);
  const snapshot=await preferences(c);assert.equal(snapshot.kind,'reference_content');assert.equal(snapshot.documentId,d.documentId);assert.equal((snapshot.channel as Row).kind,'company');assert.equal(snapshot.referencePreferences,undefined);
  assert.match(String((await new ConversationService(actor).detail(c)).guidanceOpening),/入口/);
  await new HandoffService(actor).customerWrite(c,randomUUID(),{action:'request'});
  const handoff=await new HandoffService(actor).customerRead(c);assert.equal((handoff.handoff!.source as Row).documentId,d.documentId);assert.equal(handoff.handoff!.leadId,null);
  await assert.rejects(new ConversationService(other).detail(c),/assistant_resource_not_found/);
  await assert.rejects(entryContext(identity,{referenceEntry:token,leadId:'1'}),/entry_context_invalid/);
  await assert.rejects(readContentEntry(token.slice(0,-8)+'tampered'),/entry_context_invalid/);
  await exec('retire',d);
  const fallback=await entryContext(identity,{referenceEntry:token});assert.match(String(fallback.guidanceOpening),/分享已失效/);assert.equal(fallback.referenceEntry,undefined);
  assert.match(String((await new ConversationService(actor).detail(c)).guidanceOpening),/分享已失效/);
  const late=await fromEntry(identity,entry.entryToken);assert.equal(late.entry!.kind,'reference_unavailable');
});
test('P2C foundation: expired signed content falls back; unpublished/internal cases cannot mint entries and foreign channel is rejected',async()=>{
  const d=await create('分享边界');await assert.rejects(exec('share',{documentId:d.documentId,expectedVersion:1}),/reference_unavailable/);await publish(d);
  await assert.rejects(exec('share',{documentId:d.documentId,expectedVersion:2,entryCode:'sa_'+'x'.repeat(32)}),/entry_context_invalid/);
  await assert.rejects(exec('share',{documentId:d.documentId,expectedVersion:2,entryCode:channelCodes[1]}),/entry_context_invalid/);
  const shared=await exec('share',{documentId:d.documentId,expectedVersion:2}),token=new URL('https://local'+shared.path).searchParams.get('referenceEntry')!;
  const payload=await readContentEntry(token),now=Math.floor(Date.now()/1000);
  const expired=await new SignJWT({enterpriseId:payload.enterpriseId,documentId:payload.documentId,versionId:payload.versionId,hash:payload.hash}).setProtectedHeader({alg:'HS256'}).setAudience('assistant-reference-share').setIssuedAt(now-7200).setExpirationTime(now-3600).sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const entry=await entryContext({userId:users[0],contextVersion:1,enterpriseId:undefined},{referenceEntry:expired});assert.match(String(entry.guidanceOpening),/分享已失效/);assert.equal(entry.enterprise.id,actor.enterpriseId);
  await exec('metadata',{documentId:d.documentId,expectedVersion:2,audience:'staff_internal'});
  await assert.rejects(exec('share',{documentId:d.documentId,expectedVersion:3}),/reference_unavailable/);
});

test('P2C channel: valid existing activity source persists separately from ownership; disabled channel cannot authorize a new entry',async()=>{
  const d=await create('渠道');await publish(d);
  const shared=await exec('share',{documentId:d.documentId,expectedVersion:2,entryCode:channelCodes[0]});
  const token=new URL('https://local'+shared.path).searchParams.get('referenceEntry')!,identity={userId:users[0],contextVersion:1,enterpriseId:actor.enterpriseId};
  const entry=await entryContext(identity,{referenceEntry:token}),bound=await fromEntry(identity,entry.entryToken),c=String((await new ConversationService(bound).create(randomUUID())).id);
  const snapshot=await preferences(c);assert.equal((snapshot.channel as Row).kind,'staff_activity_code');assert.equal(snapshot.channelCode,undefined);
  await withTenantTransaction(actor.enterpriseId,async tx=>{assert.equal(Number((await one(tx,sql`select count(*) n from app.leads where enterprise_id=${actor.enterpriseId}`))!.n),0);await tx.execute(sql`update app.staff_activity_codes set status='disabled' where enterprise_id=${actor.enterpriseId} and staff_id=${admins[0]}`);});
  const fallback=await entryContext(identity,{referenceEntry:token});assert.match(String(fallback.guidanceOpening),/分享已失效/);
  const late=await fromEntry(identity,entry.entryToken);assert.equal(late.entry!.kind,'reference_unavailable');
});
