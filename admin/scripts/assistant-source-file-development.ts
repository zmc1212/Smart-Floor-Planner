/** KB-2 real HTTP/Worker/model/database acceptance; only labelled synthetic originals. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction,withPlatformTransaction } from '@/db/transaction';
import { one,rows,type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText,type ActorContext } from '@/lib/assistant/contracts';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { syntheticDocx,syntheticChinesePdf } from './assistant-file-fixtures';

const native=process.argv.includes('--native'),output=path.resolve('../tmp/xiaok-kb2'),filename=native?'native-driver.json':'live.json';
const report:Row={started:new Date().toISOString(),promptVersion:agentPromptVersion,reality:{model:'real existing configured deepseek-flash',embedding:'real existing embedding service',database:'approved development',http:'real localhost:3006',worker:'real existing worker',data:'labelled synthetic enterprise/users/project/original DOCX/PDF; no customer corpus'},checks:[],runs:[],passed:false};
const save=()=>fs.writeFileSync(path.join(output,filename),JSON.stringify(report,null,2));
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function wait<T>(work:()=>Promise<T|null|false>,label:string):Promise<T>{for(let i=0;i<360;i++){const r=await work();if(r)return r;await pause(500);}throw Error('Timeout: '+label);}
async function main(){
 loadEnvConfig(process.cwd(),true);fs.mkdirSync(output,{recursive:true});const u=new URL(resolvePostgresRuntimeConfig().connectionString);
 assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(u.hostname)&&u.port==='5432'&&u.pathname==='/smart_floor_planner');
 const [{ConversationService},{ConstructionService},{signMiniProgramToken}]=await Promise.all([import('@/lib/assistant/core/conversation'),import('@/lib/construction/service'),import('@/lib/miniprogram-jwt')]);
 const prefix='synthetic-kb2-live-'+randomUUID();let eid='',aid='',uid='',adminToken='',customerToken='',cid='',projectId='';
 const check=(name:string)=>{(report.checks as Row[]).push({name,passed:true});save();};
 const request=async(p:string,method='GET',body?:unknown,expected=200,token=adminToken,key:string=randomUUID())=>{
  const r=await fetch('http://localhost:3006/api/'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
  const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));assert.match(r.headers.get('cache-control')||'',/no-store/);return j.data;
 };
 const admin=(p:string,method='GET',b?:unknown,status=200,key?:string)=>request('assistant/'+p,method,b,status,adminToken,key);
 const mini=(suffix:string,method='GET',body?:unknown,status=200,key?:string)=>request(`miniprogram/assistant/conversations/${cid}${suffix}`,method,body,status,customerToken,key);
 const job=async(id:string)=>wait(async()=>{const r=await admin('knowledge/jobs/'+id);if(['failed','cancelled','indeterminate'].includes(r.status))throw Error('Real worker: '+JSON.stringify(r));return r.status==='succeeded'?r:null;},'real Worker '+id);
 const importFile=async(bytes:Buffer,name:string)=>{
  const key=randomUUID(),input={title:'合成KB2 · '+name,fileName:name,fileBase64:bytes.toString('base64'),authorization:'SYNTHETIC fixture; no real customer material',audience:'customer_public'};
  const first=await admin('knowledge/documents/import','POST',input,200,key),again=await admin('knowledge/documents/import','POST',input,200,key);assert.equal(first.jobId,again.jobId);
  const base=`knowledge/documents/${first.document.id}`,vpath=`${base}/versions/${first.draft.id}`;await job(first.jobId);
  const detail=await admin(base),v=detail.versions[0];assert.ok(v.source_file.parsed&&!v.source_file.review);assert.equal(v.source_file.hash,createHash('sha256').update(new Uint8Array(bytes)).digest('hex'));
  const raw=await fetch('http://localhost:3006/api/assistant/'+vpath+'/original',{headers:{Authorization:'Bearer '+adminToken},signal:AbortSignal.timeout(60000)});assert.equal(raw.status,200);assert.equal(raw.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
  await admin(vpath+'/index','POST',{expectedEditVersion:2},409);
  await admin(vpath+'/review','POST',{expectedEditVersion:2,acknowledgeWarnings:true,excludedBlockIds:[]});
  const indexed=await admin(vpath+'/index','POST',{expectedEditVersion:3});await job(indexed.jobId);await admin(vpath+'/publish','POST',{expectedVersion:1,expectedEditVersion:3});
  check('real upload/idempotent recovery/parse/original/review/index/publish '+name);
  return {documentId:String(first.document.id),versionId:String(v.id),hash:v.source_file.hash,base,vpath,parsed:v.source_file.parsed};
 };
 try{
  await withPlatformTransaction(async tx=>{
   const template=await one(tx,sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=2404`);assert.ok(template);
   const cfg=template.agent_config as Row;assert.equal(cfg.providerKey,'deepseek');assert.equal(cfg.model,'deepseek-flash');assert.equal(cfg.runtime,'langgraph-v1');
   eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · KB2文件资料',${prefix},'active') returning id`))!.id);
   aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
   uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values('合成KB2业主',1) returning id`))!.id);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
   await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config) values(${eid},true,100,12000000,1000000000,30,${JSON.stringify({...cfg,imageInput:false})}::jsonb)`);
  });
  report.fixture={enterpriseId:eid,ownerId:aid,userId:uid};save();
  adminToken=await new SignJWT({id:aid,enterpriseId:eid,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const docx=await importFile(syntheticDocx(),'合成材料核对.docx'),pdf=await importFile(syntheticChinesePdf(),'合成防水说明.pdf');report.documents={docx,pdf};save();
  const leadId=String((await withTenantTransaction(eid,tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(${eid},${uid},'合成KB2客户','13800000000','natural') returning id`)))!.id);
  const construction=new ConstructionService({enterpriseId:eid,adminId:aid}),settings=await construction.execute('stages');
  await construction.execute('saveStages',{expectedVersion:settings.version,stages:[{key:'waterproofing',name:'防水',visitReminder:false,visitReason:'',watchPoints:''}]},randomUUID());
  projectId=String((await construction.execute('create',{leadId,name:'合成KB2防水工地',managerId:aid,rooms:['书房']},randomUUID())).id);
  const detail=await construction.execute('detail',{projectId});await construction.execute('progress',{projectId,expectedVersion:(detail.project as Row).version,stageKey:'waterproofing',note:'合成实际阶段；无检查结果',sendReminder:false},randomUUID());
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:leadId}};
  cid=String((await new ConversationService(actor).create(randomUUID())).id);customerToken=await signMiniProgramToken({sub:uid,id:uid,mode:'customer',role:'user',contextVersion:1,source:'wechat'});
  report.customer={uid,leadId,projectId,cid,stage:'waterproofing'};save();
  const audit=async(runId:string,name:string,started:number,round=1)=>{
   const run=await wait(async()=>{const r=await withTenantTransaction(eid,tx=>one(tx,sql`select id,status,error_code,output_message_id from app.assistant_runs where enterprise_id=${eid} and conversation_id=${cid} and id=${runId}`));return r&&!['queued','running'].includes(String(r.status))?r:null;},'real model completion');
   const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,status,capability_name,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
   const usage=await withTenantTransaction(eid,tx=>rows(tx,sql`select category,quantity,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId}`));
   const messages=await mini('/messages'),message=messages.items.find((m:Row)=>m.id===String(run.output_message_id));
   const entry:Row={name,round,runId,elapsedMs:Date.now()-started,status:run.status,error:run.error_code,outputMessageId:String(run.output_message_id),message,steps,usage,cost:null};(report.runs as Row[]).push(entry);save();
   assert.equal(run.status,'succeeded',JSON.stringify({runId,error:run.error_code}));assert.equal(message?.available,true);
   const text=safeText(message.content),synthesis=steps.find(s=>s.kind==='agent_synthesis_context');assert.ok(synthesis,'Expected synthesis, not only excerpts');
   const refs=synthesis.source_refs as Row;
   // A formal-state follow-up needs actual project evidence. Do not require an
   // irrelevant knowledge citation when the answer makes no enterprise-file claim.
   if(name!=='followup'){
    assert.ok((refs.knowledge as Row[]).some(e=>e.file),'Expected actual parsed original in model context');
    const required=name==='stage'?pdf:docx;assert.ok(message.citations.some((c:Row)=>c.version===required.versionId),'Required file must actually be cited');
   }else assert.ok((refs.snapshots as Row[]).some(s=>(s.query as Row).domain==='construction'),'Formal-state judgment requires fresh authorized project facts');
   const sources=[];for(const c of message.citations)sources.push(await request('miniprogram/assistant/citations/'+c.id,'GET',undefined,200,customerToken));entry.sources=sources;
   for(const source of sources){assert.equal(source.available,true);assert.ok(source.sourceFile?.sourceHash);assert.ok(source.sourceLocation);}
   if(name==='office'){assert.match(text,/2\s*(?:mm|毫米)/i);assert.match(text,/地暖/);assert.match(text,/合成|示例|测试/);assert.match(text,/核对|不能直接|不可直接/);assert.ok(sources.some(s=>s.sourceFile.table===1&&s.sourceFile.row===3));}
   else if(name==='stage'){assert.match(text,/防水/);assert.match(text,/团队/);assert.match(text,/不能|不代表|不足|待|核对/);assert.ok((refs.snapshots as Row[]).some(s=>(s.query as Row).domain==='construction'));assert.ok(sources.some(s=>s.version===pdf.versionId&&s.sourceFile.page===1));}
   else{assert.match(text,/不能|不足|待|核对/);assert.match(text,/验收|检查/);}
   assert.doesNotMatch(text,/已验收|已批准|已经安排铺砖/);entry.semanticAssertions='fixed points passed; independent prose review required';save();return entry;
  };
  const questions={office:'材料表里的TEST-A示例厚度是什么，地暖能直接套用吗？请按原文件解释。',followup:'那能据此认定我家已经验收，直接安排铺砖吗？',stage:'我家现在防水阶段，文件说检查是谁安排？这个阶段标签能证明检查通过吗？'};
  const send=async(name:keyof typeof questions,round:number)=>{const key=randomUUID(),started=Date.now(),sent=await mini('/messages','POST',{clientMessageId:key,content:{version:1,blocks:[{type:'text',text:questions[name]}]}},202,key);return audit(String(sent.runId),name,started,round);};
  if(native){const {run}=await import('./assistant-synthesis-native.mjs');report.native=await run({root:path.resolve('..'),output,customer:{token:customerToken,enterpriseId:eid,cid},question:questions.office,followup:questions.followup,audit,
    citationId:()=>{const runs=report.runs as Row[],sources=runs[runs.length-1].sources as Row[];return sources.find(s=>(s.sourceFile as Row)?.table===1&&(s.sourceFile as Row)?.row===3)?.id;},
    citationCheck:(c:Row)=>{assert.match(String(c.sourceLocation),/合成材料核对.docx/);assert.equal((c.sourceFile as Row)?.table,1);assert.equal((c.sourceFile as Row)?.row,3);},
    withdrawLabel:'file withdrawal invalidates native derived answers and source locators',withdraw:()=>admin(docx.base+'/retire','POST',{expectedVersion:2})});save();}
  else{
   for(let round=1;round<=2;round++){await send('office',round);await send('followup',round);await send('stage',round);}
   const before=await mini('/messages'),dependent=before.items.filter((m:Row)=>m.authorKind==='assistant');await admin(docx.base,'PATCH',{expectedVersion:2,audience:'staff_internal'});
   const after=await mini('/messages');assert.ok(dependent.filter((m:Row)=>(m.citations as Row[]).some(c=>c.version===docx.versionId)).every((m:Row)=>after.items.find((n:Row)=>n.id===m.id)?.available===false));check('real audience revocation invalidates old file citations and dependent answers');
   await admin(docx.vpath,'PATCH',{expectedEditVersion:3,body:'LLM rewrite as original'},409);check('published file text cannot be replaced by generated/manual text');
  }
  const effects=await withTenantTransaction(eid,tx=>rows(tx,sql`select type from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%'`));assert.equal(effects.length,0);check('professional file explanations do not create construction handling effects');report.passed=true;
 }finally{
  if(eid)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);if(uid)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
   report.finalState=await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,(select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs`);});
  report.finished=new Date().toISOString();save();await closePostgresPool();
 }
}
main().catch(e=>{report.error=(e as Error).message;save();console.error((e as Error).message);process.exitCode=1;});
