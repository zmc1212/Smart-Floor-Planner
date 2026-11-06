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
const nativeKnowledge=process.argv.includes('--native-knowledge');
const nativeModel=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||'qwen3.7-flash';
assert.ok(['qwen3.7-flash','deepseek-v4.1-flash-1017','deepseek-v4.1-flash'].includes(nativeModel),'Only the fixed original or user-requested model is allowed');
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||path.join(folder,'trial01'));
fs.mkdirSync(out,{recursive:true});assert.ok(!fs.existsSync(path.join(out,'report.json')),'Never overwrite or resample an earlier attempt');
assert.ok(process.argv.includes('--live'),'Explicit --live required');
const configuration=JSON.parse(fs.readFileSync(path.join(root,nativeKnowledge?'tmp/fastgpt-native-qa-20261106/runtime'+(nativeModel==='qwen3.7-flash'?'':nativeModel==='deepseek-v4.1-flash'?'-deepseek-mainline':'-deepseek')+'.private.json':'tmp/fastgpt-capabilities-20261106/runtime.private.json'),'utf8'));
if(nativeKnowledge)assert.ok(configuration.nativeKnowledgeAppId&&process.argv.includes('--scope=knowledge'),'Native QA uses its isolated configuration and the fixed knowledge scope');
if(nativeKnowledge)assert.equal(configuration.nativeModel,nativeModel,'The named test model must match the configured native application');
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
const stageFixtureArg=process.argv.find(a=>a.startsWith('--stage-fixture='))?.slice('--stage-fixture='.length);
const stageFixtureDir=stageFixtureArg?path.resolve(stageFixtureArg):undefined;
let stageFixtureModels:any[]=[];
const stageServiceOnly=process.argv.includes('--stage-service-only');
if(stageServiceOnly)assert.ok(stageFixtureDir&&process.argv.includes('--native'),'Stage engineering checks require saved stage bodies and Stable native validation; no new model calls');
if(stageFixtureDir){
 assert.ok(stageFixtureDir.toLowerCase().startsWith(folder.toLowerCase()+path.sep),'Stage fixture must remain in this retained pilot evidence');
 const source=JSON.parse(fs.readFileSync(path.join(stageFixtureDir,'report.json'),'utf8'));
 const audits=fs.readFileSync(path.join(stageFixtureDir,'workflow-attempts.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(source.stage.length,2);stageFixtureModels=source.stage.map((s:any)=>{assert.equal(s.passed,true);const a=audits.find(a=>a.kind==='stage'&&a.value.runId===s.runId);assert.ok(a);const raw=a.value.response.choices[0].message.content.trim();assert.ok(JSON.parse(raw).P1);return{sourceRunId:s.runId,raw};});
}
const report:any={status:'running',passed:false,enterpriseId:eid,target:'55432/xiaok_embedding_eval',model:nativeKnowledge?nativeModel:'qwen3.7-flash',fixedTrials:stageServiceOnly?0:2,questions:stageServiceOnly?[]:questions,
  selectedScope:stageServiceOnly?'Stage saved-body engineering regression only; knowledge semantic failures remain; new model calls zero':knowledgeOnly?'knowledge; stage first-draft failure retained, not repaired or replayed':'stage and knowledge',
  scope:'Unified original C01, original private stage feeds and persistent knowledge conversations; no per-Agent sessions, real provider gateway/tools/history/source checks, no new prompts or knowledge ingestion.',
  stage:[],trials:[],newRepairIterations:process.argv.includes('--capability-repair')?2:process.argv.includes('--encoding-repair')?1:0,
  ...(process.argv.includes('--capability-repair')?{repairIterationByDomain:{stage:1,knowledge:2,webSource:1},changedMechanism:'Revalidated stage authority reaches the existing scope validator; ordinary model-knowledge uses one complete final-response repair; first drafts/source guards unchanged.'}:{}),
  retainedFailures:'../fastgpt-report-pilot-20261106 and original dialogue evidence; not reopened or relabelled'};
if(nativeKnowledge){report.scope='One native FastGPT ToolCall controller; explicitly bound '+nativeModel+' through original guarded model/accounting ports, original authorized tools and final validation/storage; no LangGraph Q&A loop or second persistent session.';
  report.nativeKnowledge={newMechanism:true,retainedFailedRepairIterations:2,semanticRepairs:0,comparison:'Same original two five-turn journeys; current question, actual sources, first draft and validation outcome retained separately; first blocking failure or unknown stops the batch.'};}
if(process.argv.includes('--knowledge-mechanism-repair'))report.knowledgeMechanism={
  retainedFailedRepairIterations:2,
  changedMechanism:'Validated reference ordinals and selected catalog-marker namespace; current-question tail; no proactive history selector; domain hints without suppressing broader discovery; explicit single-original reads; actually cited whole public originals restored; original four-call loop and one final repair when a call remains; failed reads keep other registered candidates; ordinary final-only replies reuse the named final_response function carrier and unchanged application schema/citation validation.',
  retainedMechanismFailure:'journey01/10844 lost its read slot; journey02/10849 lost a correct domain hint, expanded into unrelated pages and exceeded input; journey03/10851 selected another valid candidate after a large page but the old reader-exhaustion flag rejected it. All remain failed. Zero-model input/source comparisons plus a real four-call failure-to-next-candidate service regression justify this mechanism change without increasing quota/input limits.',
  retainedUnknown:'journey04/10897 attempt3222 returned malformed function arguments despite JSON-Schema-only dispatch. Provider diagnostic/requestId/2074 input and479 output tokens retained; status remains unknown, not settled or replayed. Existing function carrier is a new transport mechanism, not a repair of that original attempt.',
  navigationBoundary:'journey05/10898 retained two unread oversized-page failures but116 navigation links leaked into its final-only input before any Evidence existed. Saved zero-model comparison:42768 bytes/17072 estimated tokens to7770/5406, failure receipts and private checkpoint unchanged. Reuse the original eight-candidate planning frontier and remove unused final navigation even when no source could be read; no original is clipped or quota increased.',
  hintBoundary:'journey06/10903 guessed the wrong niigao.com and then1688.com; a hint error bypassed fallback and a third-party hit erased broader discovery. The current service preserves actual unconstrained directory candidates after either condition. The real Sogou AttributeError remains; actual directory/product reads and saved12472-byte full-original replay prove an existing18KB total source allowance is sufficient, without adding primary calls or enlarging48KB input. Prior failures and unknown3222 are not reset.',
  withdrawnRepairExperiment:'journey08 used one fifth terminal repair within the original hold but still failed. It repeated the same catalog-ID markers whose digits were misclassified as quantities. The added-call experiment is withdrawn; its five actual attempts, first draft and sole repair remain failed in evidence. Current runtime retains four calls.',
  stoppedForConsolidation:'After journey01–08 no new real-model batch is scheduled. Saved10907 drafts now parse unchanged through the existing selected catalog resolver; adding7days still fails and10905 remains rejected. This zero-model discriminator is engineering evidence, not a whole semantic/native journey. Official selection and current-progress acceptance remain incomplete; the user screenshot called out the repeated patch/retest loop.',
  qualityAcceptance:'Both fixed five-turn journeys, actual manufacturer original/citation, current stage relevance, original C01 sends/reentry/project switch and actual503 recovery. First blocking failure or unknown stops this batch.',
};
if(stageFixtureDir)report.stageAdviceFixture={sourceDirectory:path.relative(root,stageFixtureDir),sourceRunIds:stageFixtureModels.map(m=>m.sourceRunId),newStageModelCalls:0,purpose:'Engineering reuse of both already successful natural native-stage drafts for client binding/reentry; no new semantic stage trial or duplicated provider usage.'};
if(process.argv.includes('--context-repair'))report.contextPreflightRepair={iteration:1,previousFailure:'10797 agent_input_limit before any model dispatch',change:'Summary preflight reuses the existing dispatch source projection; no source clipping, token-limit increase or new prompt.'};
if(process.argv.includes('--read-repair-reserve'))report.finalRepairReserve={iteration:1,previousFailure:'10802 used all four primary slots, so its final validation never dispatched a repair',change:'Existing four-call read budget includes ordinary web/history reads: up to three primary calls plus its existing sole final repair; total/model limits unchanged, writes excluded.'};
if(process.argv.includes('--citation-carrier'))report.citationCarrierCompatibility={iteration:1,previousFailure:'10807 selected real catalog IDs in a string array; old ordinary path accepted object arrays only',change:'Reuse existing exact-ID carrier in ordinary model-knowledge final tool/text channels; raw provider observation, content and catalog membership unchanged.'};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
const sourceFiles=new Set<string>(),ts=require('typescript'),cfg=ts.readConfigFile('tsconfig.json',ts.sys.readFile),options=ts.parseJsonConfigFileContent(cfg.config,ts.sys,process.cwd()).options;
function visit(f:string){if(sourceFiles.has(f)||f.includes('node_modules')||!fs.existsSync(f))return;sourceFiles.add(f);for(const i of ts.preProcessFile(fs.readFileSync(f,'utf8'),true,true).importedFiles){const r=ts.resolveModuleName(i.fileName,f,options,ts.sys).resolvedModule?.resolvedFileName;if(r)visit(path.resolve(r));}}
for(const p of ['src/lib/assistant/application/worker.ts','src/lib/assistant/application/http.ts','src/lib/construction/report-body-worker.ts','src/lib/construction/report-worker.ts','src/lib/construction/service.ts','scripts/wechatide-native-client.ts'])visit(path.resolve(p));
visit(path.join(root,'miniprogram/packages/assistant/chat/chat.js'));
visit(path.join(root,'miniprogram/packages/assistant/chat/chat-definition.js'));
for(const name of fs.readdirSync(path.join(root,'miniprogram/packages/assistant/chat')).filter(n=>/\.(wxml|less|json)$/.test(n)))sourceFiles.add(path.join(root,'miniprogram/packages/assistant/chat',name));
if(stageFixtureDir)for(const name of ['report.json','workflow-attempts.jsonl'])sourceFiles.add(path.join(stageFixtureDir,name));
for(const p of [fileURLToPath(import.meta.url),'scripts/fastgpt/platform.mjs','scripts/fastgpt/capabilities.mjs','scripts/fastgpt/native-knowledge-workflow.mjs','scripts/fastgpt/setup-native-knowledge.mts','src/lib/assistant/__tests__/fastgpt-native-knowledge.test.ts','scripts/fastgpt/acceptance-native.cjs','scripts/assistant-acceptance-safety.mjs','package.json','package-lock.json','tsconfig.json','.env.local',runtimeFile,path.join(folder,'platform.json'),path.join(root,'tmp/xiaok-vector/connection.private.json'),
 '../miniprogram/packages/assistant/chat/chat-definition.js','../miniprogram/packages/assistant/chat/chat.wxml','../miniprogram/packages/assistant/chat/chat.less','../miniprogram/utils/assistant.js','../miniprogram/utils/assistant-followups.js',
 '../scripts/assistant-public-reader.py','../scripts/openwebui-comparison/upstream.manifest.json','../scripts/openwebui-comparison/egress_proxy_server.py',
 '../tmp/fastgpt-knowledge-repair-20261106/run.mts','../tmp/fastgpt-knowledge-repair-20261106/resources.mjs',
 '../tmp/fastgpt-knowledge-repair-20261106/reader-requirements-lock.txt',
  '../tmp/fastgpt-native-qa-20261106/run.mts','../tmp/fastgpt-native-qa-20261106/resources.mjs',
 'src/lib/assistant/__tests__/public-selection.test.ts','src/lib/assistant/__tests__/knowledge-dialogue-boundaries.test.ts',
 'src/lib/assistant/__tests__/home-source-budget.test.ts','src/db/__tests__/assistant-history.test.ts']){const full=path.resolve(p);if(fs.existsSync(full))sourceFiles.add(full);}
const binding=()=>Object.fromEntries([...sourceFiles].sort().map(p=>[path.relative(root,p).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const snapshot=async()=>({knowledge:await workflowSnapshot({...configuration,appId:configuration.knowledgeAppId}),stage:await workflowSnapshot({...configuration,appId:configuration.stageAppId}),
  ...(nativeKnowledge?{nativeKnowledge:await workflowSnapshot({...configuration,appId:configuration.nativeKnowledgeAppId,nodeCount:configuration.nativeNodeCount})}:{})});
const counts=()=>platform(async(tx:any)=>({provider:Number((await one(tx,sql`select count(*)::int n from app.ai_provider_attempts`)).n),queue:Number((await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n),pending:Number((await one(tx,sql`select count(*)::int n from app.construction_report_deliveries where state in ('pending','held')`)).n)}));
let release:any,reverse:any,assistantBefore:any,planBefore:any,platformBefore:any,owner:any,ownerId='',managerId='';
const users:string[]=[],projects:string[]=[],bindings:any[]=[],chatIds:string[]=[];let activeJourney:any;
const actorFor=(uid:string)=>({enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self','assistant.followup.self']});
const chatActor=(uid:string,leadId?:string)=>({...actorFor(uid),capabilities:['assistant.chat.self'],...(leadId?{entry:{kind:'lead',id:leadId}}:{})});
async function trace(runId:string){return read(async(tx:any)=>({run:await one(tx,sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${runId}`),steps:await rows(tx,sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,source_refs,provider_attempt_id::text from app.assistant_run_steps where enterprise_id=1454 and run_id=${runId} order by step_seq`),usage:await rows(tx,sql`select category,input_tokens,output_tokens,measurement_kind,provider_attempt_id::text from app.assistant_usage_records where enterprise_id=1454 and run_id=${runId}`)}));}
async function consume(question:string,runId:string,cid:string){
 const item:any={question,runId,conversationId:cid};activeJourney.turns.push(item);save();
 let lease:any=null;const claimUntil=Date.now()+10000;item.claimWait={emptyClaims:0};
 while(!lease&&Date.now()<claimUntil){
  lease=await claimJob();if(lease)break;
  item.claimWait.emptyClaims++;const pending=await read((tx:any)=>one(tx,sql`select status,error_code from app.assistant_runs where enterprise_id=1454 and id=${runId}`));
  assert.equal(pending?.status,'queued',pending?.error_code||'Only an undispatched queued run may wait for a skipped claim lock');
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 save();assert.equal(lease?.runId,runId,'Only the owned queued request may be claimed');await processAssistantRun(lease);
 const original=await trace(runId);fs.writeFileSync(path.join(out,'run-'+runId+'.json'),JSON.stringify(original,null,2));
 item.status=original.run.status;item.error=original.run.error_code;save();assert.equal(original.run.status,'succeeded',original.run.error_code);
  if(nativeKnowledge){const models=original.steps.filter((s:any)=>s.kind==='agent_model');assert.ok(models.length>0&&models.every((s:any)=>s.input_summary?.nativeProtocol==='fastgpt-native-knowledge-v1'),'Every Q&A turn must be generated inside the native FastGPT loop');
    assert.ok(models.every((s:any)=>s.provider_attempt_id&&s.private_checkpoint?.usage),'Each original model dispatch must retain its attempt and usage');}
 const messages=await new ConversationService(chatActor(users[0])).messages(cid);const answer=messages.items.find((m:any)=>String(m.id)===String(original.run.output_message_id));assert.ok(answer);
 item.messageId=String(answer.id);item.answer=safeText(answer.content);item.citations=answer.citations||[];
 item.citationReadback=[];
 for(const citation of item.citations){
  const opened=await new ConversationService(chatActor(users[0])).citation(String(citation.id),false,cid);assert.equal(opened.available,true);
  await assert.rejects(()=>new ConversationService(chatActor(users[1])).citation(String(citation.id),false,cid));
  await assert.rejects(()=>new ConversationService({...chatActor(users[0]),enterpriseId:'2385'}).citation(String(citation.id),false,cid));
  item.citationReadback.push({id:opened.id,available:opened.available,sourceUrl:opened.sourceUrl,quote:opened.quote});
 }
 assert.ok(item.answer.length>5);assert.equal(original.run.policy_snapshot.knowledgePolicy.enabled,false);
 if(question===questions[2]){assert.match(item.answer,/卧室/);assert.match(item.answer,/住|居住|老房/);}
 if(question===questions[3]){
  const pages=original.steps.filter((s:any)=>s.kind==='retrieval'&&s.status==='succeeded').flatMap((s:any)=>s.private_checkpoint?.pages||[]);
  assert.ok(pages.some((p:any)=>new URL(p.url).hostname==='www.nipponpaint.com.cn'||new URL(p.url).hostname==='nipponpaint.com.cn'),'Manufacturer lookup must read the actual official original, not a third party');
  assert.ok(item.citationReadback.some((c:any)=>c.sourceUrl&&new URL(c.sourceUrl).hostname.endsWith('nipponpaint.com.cn')),'The saved answer must expose a readable official citation');
 }
 if(question===questions[4]){const business=original.steps.filter((s:any)=>s.capability_name==='query_business'&&s.status==='succeeded');assert.ok(business.length,'Current progress requires a real authorized business read');
  const expected=projects[activeJourney.trial-1],other=projects[activeJourney.trial===1?1:0];
  assert.ok(business.some((s:any)=>JSON.stringify(s.private_checkpoint).includes('"projectId":"'+expected+'"')||JSON.stringify(s.private_checkpoint).includes('"id":"'+expected+'"')));
  assert.ok(!business.some((s:any)=>JSON.stringify(s.private_checkpoint).includes('"projectId":"'+other+'"')));
  assert.match(item.answer,activeJourney.trial===1?/水电/:/安装/,'The actual answer must address the current authorized stage');
  assert.notEqual(item.answer,activeJourney.turns.at(-2)?.answer,'A new project-stage question must not repeat the painting answer');}
 const detail=await new ConversationService(chatActor(users[0])).detail(cid);assert.equal(String(detail.id),cid);save();return item;
}
async function correctStage(){
 const first=report.stage[0];assert.ok(first);const d=await owner.execute('detail',{projectId:projects[0]});await owner.execute('progress',{projectId:projects[0],expectedVersion:Number(d.project.version),stageKey:'demolition',note:'合成测试·更正阶段',sendReminder:false},randomUUID());
 const followups=new FollowupService(actorFor(users[0])),historical=await followups.detail(first.bindingId,first.reportId,1);assert.equal(historical.available,true,'Delivered reminders remain historical records after normal stage progression');
 const {currentReportStageEvent}=await imp('src/lib/construction/stage-events.ts');
 const oldEvent=await read(async(tx:any)=>{const r=await one(tx,sql`select stage_event_id from app.construction_reports where enterprise_id=1454 and id=${first.reportId}`);return currentReportStageEvent(tx,eid,r.stage_event_id);});assert.equal(oldEvent,undefined,'Superseded events cannot generate a new current-stage reminder');
 const changed=await owner.execute('detail',{projectId:projects[0]});await owner.execute('update',{projectId:projects[0],expectedVersion:Number(changed.project.version),name:changed.project.name,status:'active',customerAccess:false},randomUUID());
 await assert.rejects(()=>followups.detail(first.bindingId,first.reportId,1),(error:any)=>error.code==='assistant_resource_not_found','Project revocation must deny the original private conversation');
 report.stageCorrection={oldEventCannotGenerateNew:true,historicalReminderRetained:true,projectAccessRevoked:true};save();return{bindingId:first.bindingId,reportId:first.reportId};
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
  const fact=await claimJob();assert.ok(fact);await processConstructionReport(fact);const body=await claimJob();assert.ok(body);
  await processReportComposition(body,stageFixtureModels.length?{model:async(_messages:any,_tools:any,turn:number)=>{assert.equal(turn,0);const m=stageFixtureModels[i];return{text:'',toolCalls:[{id:'fixture-stage-'+m.sourceRunId,name:'final_response',arguments:m.raw}],finishReason:'tool_calls',providerRequestId:'engineering-reuse:'+m.sourceRunId,usage:{inputTokens:0,outputTokens:0}};}}:{});
  const bodyTrace=await trace(body.runId);fs.writeFileSync(path.join(out,'run-'+body.runId+'.json'),JSON.stringify(bodyTrace,null,2));assert.equal(bodyTrace.run.status,'succeeded',bodyTrace.run.error_code);
  assert.equal(await deliverConstructionReports(eid),1);assert.equal(await deliverConstructionReports(eid),0);
  const r=await read((tx:any)=>one(tx,sql`select r.id::text from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id where r.enterprise_id=1454 and v.body_run_id=${body.runId}`));
  const svc=new FollowupService(actorFor(users[0])),opened=await svc.detail(String(bindings[i].id),r.id,1);assert.equal(opened.available,true);assert.equal(opened.kind,'stage');assert.deepEqual(opened.body,(await svc.detail(String(bindings[i].id),r.id,1)).body);
  await assert.rejects(()=>new FollowupService(actorFor(users[1])).detail(String(bindings[i].id),r.id,1));
  await assert.rejects(()=>new FollowupService({...actorFor(users[0]),enterpriseId:'2385'}).detail(String(bindings[i].id),r.id,1));
  report.stage.push({projectId:projects[i],bindingId:String(bindings[i].id),conversationId:String(bindings[i].conversation_id),reportId:r.id,runId:body.runId,body:opened.body,modelOrigin:stageFixtureModels.length?'saved-stage-advice-engineering-fixture':'actual-native-FastGPT',...(stageFixtureModels.length?{sourceRunId:stageFixtureModels[i].sourceRunId}:{}),passed:true});save();
 }
 for(let trial=0;trial<(stageServiceOnly?1:2);trial++){
  if(report.trials.some((t:any)=>t.trial===trial+1))continue;
  const cid=chatIds[trial],actor=chatActor(users[0]),service=new ConversationService(actor);activeJourney={trial:trial+1,conversationId:cid,turns:[]};report.trials.push(activeJourney);save();
  if(trial===0&&process.argv.includes('--native')){
   const {SignJWT}=require('jose');const token=await new SignJWT({id:users[0],mode:'customer',role:'user',enterpriseId:eid,contextVersion:1,source:'password'}).setProtectedHeader({alg:'HS256'}).setSubject(users[0]).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET||'fallback_secret_random_123'));
   const {assistantHttp}=await imp('src/lib/assistant/application/http.ts');
   report.native=await require(path.resolve('scripts/fastgpt/acceptance-native.cjs'))({root,output:out,actor:{uid:users[0],token,cid,bid:String(bindings[0].id)},questions:stageServiceOnly?[]:questions,stage:report.stage,assistantHttp,
    onQueued:async(question:string,runId:string,actualCid:string)=>{assert.equal(actualCid,cid);assert.equal(question,questions[activeJourney.turns.length]);return consume(question,runId,cid);},
    onSwitch:stageServiceOnly?undefined:async()=>{const nextCid=chatIds[1],svc=new ConversationService(chatActor(users[0]));activeJourney={trial:2,conversationId:nextCid,turns:[]};report.trials.push(activeJourney);save();
      for(const question of questions){const key=randomUUID(),content={version:1,blocks:[{type:'text',text:question}]};const sent=await svc.send(nextCid,key,content);assert.equal((await svc.send(nextCid,key,content)).runId,sent.runId);await consume(question,sent.runId,nextCid);}
      await assert.rejects(()=>new ConversationService(chatActor(users[1])).detail(nextCid));return{conversationId:nextCid,messageId:activeJourney.turns.at(-1).messageId};},onStageCorrection:knowledgeOnly?undefined:correctStage});save();assert.equal(report.native.passed,true,report.native.error);
  }else for(const question of questions){const key=randomUUID(),content={version:1,blocks:[{type:'text',text:question}]};const sent=await service.send(cid,key,content);assert.equal((await service.send(cid,key,content)).runId,sent.runId);await consume(question,sent.runId,cid);}
  await assert.rejects(()=>new ConversationService(chatActor(users[1])).detail(cid));
 }
 if(!knowledgeOnly&&!report.stageCorrection)await correctStage();
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
