/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated acceptance inspects service receipts and private snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn,execFile,execFileSync} from 'node:child_process';
import {workflowSnapshot} from './platform.mjs';

const require=createRequire(process.cwd()+'/package.json');require('@next/env').loadEnvConfig(process.cwd(),true);
const primary=process.env.DATABASE_URL,root=path.resolve('..'),folder=path.join(root,'tmp/fastgpt-capabilities-20261106');
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||path.join(folder,'trial01'));
fs.mkdirSync(out,{recursive:true});assert.ok(!fs.existsSync(path.join(out,'report.json')),'Never overwrite or resample an earlier attempt');
assert.ok(process.argv.includes('--live'),'Explicit --live required');
const configuration=JSON.parse(fs.readFileSync(path.join(folder,'runtime.private.json'),'utf8'));
const runtimeFile=path.join(out,'runtime.private.json');configuration.auditFile=path.join(out,'workflow-attempts.jsonl');fs.writeFileSync(runtimeFile,JSON.stringify(configuration,null,2));
execFileSync('icacls.exe',[runtimeFile,'/inheritance:r','/grant:r','Administrator:F','SYSTEM:F'],{windowsHide:true,stdio:'ignore'});
process.env.XIAOK_FASTGPT_WORKFLOWS_FILE=runtimeFile;
process.env.DATABASE_URL=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL;
const target=new URL(process.env.DATABASE_URL!);assert.equal(target.port,'55432');assert.equal(target.pathname,'/xiaok_embedding_eval');
const imp=(p:string)=>import(pathToFileURL(path.resolve(p)).href),{sql}=require('drizzle-orm');
const {withTenantTransaction,withPlatformTransaction}=await imp('src/db/transaction.ts');
const {one,rows}=await imp('src/db/repositories/assistant-repository.ts');
const {closePostgresPool}=await imp('src/lib/postgresql.ts');
const {ConstructionService}=await imp('src/lib/construction/service.ts');
const {ensureFollowupBinding}=await imp('src/lib/construction/report-store.ts');
const {advanceConstructionReports,processConstructionReport,deliverConstructionReports}=await imp('src/lib/construction/report-worker.ts');
const {processReportComposition}=await imp('src/lib/construction/report-body-worker.ts');
const {FollowupService}=await imp('src/lib/construction/followup-service.ts');
const {ConversationService}=await imp('src/lib/assistant/core/conversation.ts');
const {cancelRuns}=await imp('src/lib/assistant/core/conversation.ts');
const {processAssistantRun}=await imp('src/lib/assistant/application/worker.ts');
const {claimJob}=await imp('src/lib/assistant/infrastructure/job-queue.ts');
const {safeText}=await imp('src/lib/assistant/contracts/index.ts');
const {minimalDialogueProtocol}=await imp('src/lib/assistant/agent/minimal-dialogue.ts');
const {closeFastGPTWorkflows,fastGPTWorkflows}=await imp('src/lib/assistant/fastgpt/runtime.ts');
const {lockAssistantAcceptance}=await imp('scripts/assistant-acceptance-safety.mjs');
const eid='1454',prefix='synthetic-fastgpt-capabilities-'+randomUUID(),read=(fn:any)=>withTenantTransaction(eid,fn),platform=(fn:any)=>withPlatformTransaction(fn);
const questions=['卧室墙面摸着掉粉，想重新刷漆，通常先处理什么？','补充一下，是住人的老房子，不是空房，想尽量少影响生活。','我刚才说的是什么房间、什么居住情况？处理时该注意什么？','帮我查下立邦官网，旧墙面起粉可以直接刷面漆吗？','结合我家现在的施工进度，接下来有什么要注意的？'];
const knowledgeOnly=process.argv.includes('--scope=knowledge');
const report:any={status:'running',passed:false,enterpriseId:eid,target:'55432/xiaok_embedding_eval',model:'qwen3.7-flash',fixedTrials:2,questions,
  selectedScope:knowledgeOnly?'knowledge; stage first-draft failure retained, not repaired or replayed':'stage and knowledge',
  scope:'Unified original C01, original private stage feeds and persistent knowledge conversations; no per-Agent sessions, real provider gateway/tools/history/source checks, no new prompts or knowledge ingestion.',
  stage:[],trials:[],newRepairIterations:process.argv.includes('--encoding-repair')?1:0,retainedFailures:'../fastgpt-report-pilot-20261106 and original dialogue evidence; not reopened or relabelled'};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
const sourceFiles=new Set<string>(),ts=require('typescript'),cfg=ts.readConfigFile('tsconfig.json',ts.sys.readFile),options=ts.parseJsonConfigFileContent(cfg.config,ts.sys,process.cwd()).options;
function visit(f:string){if(sourceFiles.has(f)||f.includes('node_modules')||!fs.existsSync(f))return;sourceFiles.add(f);for(const i of ts.preProcessFile(fs.readFileSync(f,'utf8'),true,true).importedFiles){const r=ts.resolveModuleName(i.fileName,f,options,ts.sys).resolvedModule?.resolvedFileName;if(r)visit(path.resolve(r));}}
for(const p of ['src/lib/assistant/application/worker.ts','src/lib/assistant/application/http.ts','src/lib/construction/report-body-worker.ts','src/lib/construction/report-worker.ts','src/lib/construction/service.ts','scripts/wechatide-native-client.ts'])visit(path.resolve(p));
visit(path.join(root,'miniprogram/packages/assistant/chat/chat.js'));
visit(path.join(root,'miniprogram/packages/assistant/chat/chat-definition.js'));
for(const p of [fileURLToPath(import.meta.url),'scripts/fastgpt/platform.mjs','scripts/fastgpt/capabilities.mjs','scripts/fastgpt/acceptance-native.cjs','scripts/assistant-acceptance-safety.mjs','package.json','package-lock.json','tsconfig.json','.env.local',runtimeFile,path.join(folder,'platform.json'),path.join(root,'tmp/xiaok-vector/connection.private.json'),
 '../miniprogram/packages/assistant/chat/chat-definition.js','../miniprogram/packages/assistant/chat/chat.wxml','../miniprogram/packages/assistant/chat/chat.less','../miniprogram/utils/assistant.js','../miniprogram/utils/assistant-followups.js']){const full=path.resolve(p);if(fs.existsSync(full))sourceFiles.add(full);}
const binding=()=>Object.fromEntries([...sourceFiles].sort().map(p=>[path.relative(root,p).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const snapshot=async()=>({knowledge:await workflowSnapshot({...configuration,appId:configuration.knowledgeAppId}),stage:await workflowSnapshot({...configuration,appId:configuration.stageAppId})});
const counts=()=>platform(async(tx:any)=>({provider:Number((await one(tx,sql`select count(*)::int n from app.ai_provider_attempts`)).n),queue:Number((await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n),pending:Number((await one(tx,sql`select count(*)::int n from app.construction_report_deliveries where state in ('pending','held')`)).n)}));
let release:any,reverse:any,assistantBefore:any,planBefore:any,platformBefore:any,owner:any,ownerId='',managerId='';
const users:string[]=[],projects:string[]=[],bindings:any[]=[],chatIds:string[]=[];let activeJourney:any;
const actorFor=(uid:string)=>({enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self','assistant.followup.self']});
const chatActor=(uid:string,leadId?:string)=>({...actorFor(uid),capabilities:['assistant.chat.self'],...(leadId?{entry:{kind:'lead',id:leadId}}:{})});
async function trace(runId:string){return read(async(tx:any)=>({run:await one(tx,sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${runId}`),steps:await rows(tx,sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,source_refs,provider_attempt_id::text from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),usage:await rows(tx,sql`select category,input_tokens,output_tokens,measurement_kind,provider_attempt_id::text from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`)}));}
async function consume(question:string,runId:string,cid:string){
 const item:any={question,runId,conversationId:cid};activeJourney.turns.push(item);save();
 const lease=await claimJob();assert.equal(lease?.runId,runId,'Only the owned queued request may be claimed');await processAssistantRun(lease);
 const original=await trace(runId);fs.writeFileSync(path.join(out,'run-'+runId+'.json'),JSON.stringify(original,null,2));
 item.status=original.run.status;item.error=original.run.error_code;save();assert.equal(original.run.status,'succeeded',original.run.error_code);
 const messages=await new ConversationService(chatActor(users[0])).messages(cid);const answer=messages.items.find((m:any)=>String(m.id)===String(original.run.output_message_id));assert.ok(answer);
 item.messageId=String(answer.id);item.answer=safeText(answer.content);item.citations=answer.citations||[];
 assert.ok(item.answer.length>5);assert.equal(original.run.policy_snapshot.knowledgePolicy.enabled,false);
 if(question===questions[2]){assert.match(item.answer,/卧室/);assert.match(item.answer,/住|居住|老房/);}
 if(question===questions[3])assert.ok(original.steps.some((s:any)=>s.kind==='retrieval'&&s.status==='succeeded'&&s.private_checkpoint?.status==='ready'&&s.private_checkpoint?.pages?.length),'The requested web lookup must actually read an original page');
 if(question===questions[4]){const business=original.steps.filter((s:any)=>s.capability_name==='query_business'&&s.status==='succeeded');assert.ok(business.length,'Current progress requires a real authorized business read');
  const expected=projects[activeJourney.trial-1],other=projects[activeJourney.trial===1?1:0];
  assert.ok(business.some((s:any)=>JSON.stringify(s.private_checkpoint).includes('"projectId":"'+expected+'"')||JSON.stringify(s.private_checkpoint).includes('"id":"'+expected+'"')));
  assert.ok(!business.some((s:any)=>JSON.stringify(s.private_checkpoint).includes('"projectId":"'+other+'"')));}
 const detail=await new ConversationService(chatActor(users[0])).detail(cid);assert.equal(String(detail.id),cid);save();return item;
}
try{
 release=await lockAssistantAcceptance(process.env.DATABASE_URL,{waitForLock:true});report.before=await counts();assert.equal(report.before.queue,0);assert.equal(report.before.pending,0);
 assistantBefore=await read((tx:any)=>one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));planBefore=await read((tx:any)=>one(tx,sql`select * from app.construction_report_settings where enterprise_id=1454`));assert.equal(assistantBefore.enabled,false);assert.equal(planBefore.enabled,false);
 const sourceURL=new URL(primary!);assert.equal(sourceURL.port,'5432');assert.equal(sourceURL.pathname,'/smart_floor_planner');const sourceClient=new(require('pg').Client)({connectionString:primary});let source:any;
 try{await sourceClient.connect();await sourceClient.query('begin read only');source=(await sourceClient.query("select llm_config from app.platform_configs where key='default'")).rows[0].llm_config;await sourceClient.query('rollback');}finally{await sourceClient.end();}
 platformBefore=await platform((tx:any)=>one(tx,sql`select llm_config from app.platform_configs where key='default'`));await platform((tx:any)=>tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify({...source,model:report.model})}::jsonb where key='default'`));
 await read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({...assistantBefore.agent_config,runtime:'langgraph-v1',providerKey:'dashscope',model:report.model,imageInput:false,tools:true,probeVersion:minimalDialogueProtocol,enterpriseKnowledgeEnabled:false})}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
 report.bindingBefore=binding();report.workflowsBefore=await snapshot();save();
 await fastGPTWorkflows()!.ready();reverse=spawn('ssh',['-i','C:/Users/Administrator/.ssh/toonflow_remote_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-N','-R','127.0.0.1:18310:127.0.0.1:18310','Administrator@192.168.10.54'],{windowsHide:true,stdio:['ignore','ignore','pipe']});reverse.stderr.on('data',(v:any)=>{report.reverseError=String(v).slice(0,200);});
 const code='fetch("http://host.docker.internal:18310/knowledge-input",{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(2))';
 const command='$ProgressPreference="SilentlyContinue"; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'+Buffer.from(code).toString('base64')+'")); $p | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
 await new Promise(r=>setTimeout(r,700));await new Promise<void>((resolve,reject)=>execFile('ssh',['-i','C:/Users/Administrator/.ssh/toonflow_remote_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','Administrator@192.168.10.54','powershell -NoProfile -EncodedCommand '+Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:12000},e=>e?reject(e):resolve()));
 await platform(async(tx:any)=>{
  for(let i=0;i<2;i++){const uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+':user:'+i},1) returning id`)).id);users.push(uid);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+':openid:'+i})`);}
  for(const [tag,role]of [['owner','enterprise_admin'],['manager','construction_staff']]){const id=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password) values(1454,${prefix+':'+tag},${'合成测试·FastGPT·'+tag},'unusable-local-fixture',${role},'active',false) returning id`)).id);if(tag==='owner')ownerId=id;else managerId=id;}
 });
 owner=new ConstructionService({enterpriseId:eid,adminId:ownerId});
 for(let i=0;i<2;i++){
  const lead=await read((tx:any)=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values(1454,${users[0]},${prefix+':lead:'+i},${'136'+String(Date.now()+i).slice(-8)},'natural') returning id`));
  const pid=String((await owner.execute('create',{leadId:String(lead.id),name:'合成测试·FastGPT·'+(i?'云庭':'星河'),managerId,rooms:['卧室']},randomUUID())).id);projects.push(pid);
  const d=await owner.execute('detail',{projectId:pid});await owner.execute('update',{projectId:pid,expectedVersion:Number(d.project.version),name:d.project.name,status:'active',customerAccess:true},randomUUID());
  bindings.push(await read((tx:any)=>ensureFollowupBinding(tx,eid,{kind:'user',id:users[0],audience:'customer',projectId:pid})));
  chatIds.push(String((await new ConversationService(chatActor(users[0],String(lead.id))).create(randomUUID())).id));
 }
 const cursor=await read((tx:any)=>one(tx,sql`select coalesce(max(id),0)::text id from app.domain_event_outbox where enterprise_id=1454`));
 await read((tx:any)=>tx.execute(sql`update app.construction_report_settings set enabled=true,stage_enabled=${!knowledgeOnly},project_ids=${JSON.stringify(projects)}::jsonb,stage_keys='[]'::jsonb,audiences='["customer"]'::jsonb,stage_cursor=${cursor.id},next_daily_at=now()+interval '2 days',next_weekly_at=now()+interval '8 days',version=version+1 where enterprise_id=1454`));
 report.fixture={prefix,users,projects,ownerId,managerId,chatIds,bindings:bindings.map(b=>({id:String(b.id),conversationId:String(b.conversation_id)}))};save();
 for(let i=0;i<2;i++){
  const d=await owner.execute('detail',{projectId:projects[i]});await owner.execute('progress',{projectId:projects[i],expectedVersion:Number(d.project.version),stageKey:i?'installation':'utilities',note:'合成测试·阶段子流程',sendReminder:false},randomUUID());
  if(knowledgeOnly)continue;
  const now=await read((tx:any)=>one(tx,sql`select clock_timestamp() at`));const queued=await advanceConstructionReports(new Date(now.at),eid);assert.deepEqual(queued.errors,[]);assert.equal(queued.queued,1);assert.equal((await advanceConstructionReports(new Date(now.at),eid)).queued,0);
  const fact=await claimJob();assert.ok(fact);await processConstructionReport(fact);const body=await claimJob();assert.ok(body);await processReportComposition(body);
  const bodyTrace=await trace(body.runId);fs.writeFileSync(path.join(out,'run-'+body.runId+'.json'),JSON.stringify(bodyTrace,null,2));assert.equal(bodyTrace.run.status,'succeeded',bodyTrace.run.error_code);
  assert.equal(await deliverConstructionReports(eid),1);assert.equal(await deliverConstructionReports(eid),0);
  const r=await read((tx:any)=>one(tx,sql`select r.id::text from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id where r.enterprise_id=1454 and v.body_run_id=${body.runId}`));
  const svc=new FollowupService(actorFor(users[0])),opened=await svc.detail(String(bindings[i].id),r.id,1);assert.equal(opened.available,true);assert.equal(opened.kind,'stage');assert.deepEqual(opened.body,(await svc.detail(String(bindings[i].id),r.id,1)).body);
  await assert.rejects(()=>new FollowupService(actorFor(users[1])).detail(String(bindings[i].id),r.id,1));
  await assert.rejects(()=>new FollowupService({...actorFor(users[0]),enterpriseId:'2385'}).detail(String(bindings[i].id),r.id,1));
  report.stage.push({projectId:projects[i],bindingId:String(bindings[i].id),conversationId:String(bindings[i].conversation_id),reportId:r.id,runId:body.runId,body:opened.body,passed:true});save();
 }
 for(let trial=0;trial<2;trial++){
  if(report.trials.some((t:any)=>t.trial===trial+1))continue;
  const cid=chatIds[trial],actor=chatActor(users[0]),service=new ConversationService(actor);activeJourney={trial:trial+1,conversationId:cid,turns:[]};report.trials.push(activeJourney);save();
  if(trial===0&&process.argv.includes('--native')){
   const {SignJWT}=require('jose');const token=await new SignJWT({id:users[0],mode:'customer',role:'user',enterpriseId:eid,contextVersion:1,source:'password'}).setProtectedHeader({alg:'HS256'}).setSubject(users[0]).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET||'fallback_secret_random_123'));
   const {assistantHttp}=await imp('src/lib/assistant/application/http.ts');
   report.native=await require(path.resolve('scripts/fastgpt/acceptance-native.cjs'))({root,output:out,actor:{uid:users[0],token,cid,bid:String(bindings[0].id)},questions,stage:report.stage,assistantHttp,
    onQueued:async(question:string,runId:string,actualCid:string)=>{assert.equal(actualCid,cid);assert.equal(question,questions[activeJourney.turns.length]);return consume(question,runId,cid);},
    onSwitch:async()=>{const nextCid=chatIds[1],svc=new ConversationService(chatActor(users[0]));activeJourney={trial:2,conversationId:nextCid,turns:[]};report.trials.push(activeJourney);save();
      for(const question of questions){const key=randomUUID(),content={version:1,blocks:[{type:'text',text:question}]};const sent=await svc.send(nextCid,key,content);assert.equal((await svc.send(nextCid,key,content)).runId,sent.runId);await consume(question,sent.runId,nextCid);}
      await assert.rejects(()=>new ConversationService(chatActor(users[1])).detail(nextCid));return{conversationId:nextCid,messageId:activeJourney.turns.at(-1).messageId};}});save();assert.equal(report.native.passed,true,report.native.error);
  }else for(const question of questions){const key=randomUUID(),content={version:1,blocks:[{type:'text',text:question}]};const sent=await service.send(cid,key,content);assert.equal((await service.send(cid,key,content)).runId,sent.runId);await consume(question,sent.runId,cid);}
  await assert.rejects(()=>new ConversationService(chatActor(users[1])).detail(cid));
 }
 if(!knowledgeOnly){const first=report.stage[0];const d=await owner.execute('detail',{projectId:projects[0]});await owner.execute('progress',{projectId:projects[0],expectedVersion:Number(d.project.version),stageKey:'demolition',note:'合成测试·更正阶段',sendReminder:false},randomUUID());
 const revoked=await new FollowupService(actorFor(users[0])).detail(first.bindingId,first.reportId,1);assert.equal(revoked.available,false);report.stageCorrection={oldReminderRevoked:true};}
 report.after=await counts();assert.equal(report.after.queue,0);assert.equal(report.after.pending,0);report.passed=true;report.status='passed';
}catch(error){report.passed=false;report.status='failed';report.error=(error as Error).stack||String(error);process.exitCode=1;}
finally{
 const cleanupErrors:string[]=[];
 const clean=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch(error){cleanupErrors.push(String(error));}};
  for(const cid of chatIds)await clean(async()=>{await read((tx:any)=>cancelRuns(tx,chatActor(users[0]),cid));const svc=new ConversationService(chatActor(users[0]));const c=await svc.detail(cid);if(c.status==='open')await svc.archive(cid,c.version,randomUUID());});
  for(const b of bindings)await clean(async()=>{await read((tx:any)=>cancelRuns(tx,actorFor(users[0]),String(b.conversation_id)));
    await read((tx:any)=>tx.execute(sql`update app.construction_followup_bindings set status='stopped',version=version+1 where enterprise_id=1454 and id=${String(b.id)}`));
    await read((tx:any)=>tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=1454 and binding_id=${String(b.id)} and state in ('pending','held')`));});
  for(const pid of projects)if(owner)await clean(async()=>{const d=await owner.execute('detail',{projectId:pid});await owner.execute('update',{projectId:pid,expectedVersion:Number(d.project.version),name:d.project.name,status:'archived',customerAccess:false},randomUUID());});
  await clean(()=>platform((tx:any)=>tx.execute(sql`update app.admin_users set status='disabled' where username like ${prefix+'%'}`)));
  for(const uid of users)await clean(()=>platform((tx:any)=>tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`)));
  if(planBefore)await clean(()=>read((tx:any)=>tx.execute(sql`update app.construction_report_settings set enabled=${planBefore.enabled},stage_enabled=${planBefore.stage_enabled},project_ids=${JSON.stringify(planBefore.project_ids)}::jsonb,stage_keys=${JSON.stringify(planBefore.stage_keys)}::jsonb,audiences=${JSON.stringify(planBefore.audiences)}::jsonb,stage_cursor=${String(planBefore.stage_cursor)},next_daily_at=${planBefore.next_daily_at},next_weekly_at=${planBefore.next_weekly_at},version=version+1 where enterprise_id=1454`)));
  if(assistantBefore)await clean(()=>read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantBefore.enabled},agent_config=${JSON.stringify(assistantBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`)));
  if(platformBefore)await clean(()=>platform((tx:any)=>tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default'`)));
  await clean(async()=>{report.finalCounts=await counts();assert.equal(report.finalCounts.queue,0);assert.equal(report.finalCounts.pending,0);});
  report.cleanup={restored:!cleanupErrors.length,bindingsStopped:bindings.length,projectsArchived:projects.length};
  if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;report.passed=false;process.exitCode=1;}
 try{report.workflowsAfter=await snapshot();assert.deepEqual(report.workflowsAfter,report.workflowsBefore);}catch(error){report.workflowError=String(error);report.passed=false;process.exitCode=1;}
 reverse?.kill();await closeFastGPTWorkflows();delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
 if(report.bindingBefore){report.bindingAfter=binding();report.drift=Object.keys(report.bindingBefore).filter(p=>report.bindingBefore[p]!==report.bindingAfter[p]);if(report.drift.length){report.passed=false;process.exitCode=1;}}
 if(release)await release();save();await closePostgresPool();console.log(JSON.stringify({passed:report.passed,stage:report.stage.length,trials:report.trials.map((t:any)=>t.turns.length),error:report.error,cleanup:report.cleanup,drift:report.drift}));
}
