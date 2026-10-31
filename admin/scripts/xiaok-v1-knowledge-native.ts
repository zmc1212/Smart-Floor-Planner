/* eslint-disable @typescript-eslint/no-explicit-any -- Native RPC and persisted provider JSON are asserted at the boundary. */
/** Fixed two-trial journeys, actual Stable input/HTTP/Worker; no provider/configuration substitution. */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, decodeJwt } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { wechatideNativeClient } from './wechatide-native-client';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { knowledgeExplanationProtocol } from '@/lib/assistant/agent/knowledge-explanation';

loadEnvConfig(process.cwd(),true);
type Row=Record<string,any>;
const root=path.resolve('..'), eid='1454', pid='237', project=path.join(root,'miniprogram');
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)||'native-preflight-01';
assert.match(label,/^[a-z0-9-]+$/);
const output=path.join(root,'tmp/v1-01-weiyun-jingyi',label);fs.mkdirSync(output,{recursive:true});
assert.ok(!fs.existsSync(path.join(output,'report.json')),'Keep original attempts; use a distinct justified evidence label');
const ledger=path.join(root,'tmp/agent-contract/trial-v1-knowledge-'+label+'.json');
const report:Row={startedAt:new Date().toISOString(),enterpriseId:eid,checks:[],trials:[],calls:[],reservationHistory:[],passed:false};
const save=()=>{const json=JSON.stringify(report,(_key,value)=>value instanceof RegExp?{pattern:value.source,flags:value.flags}:value,2);fs.writeFileSync(path.join(output,'report.json'),json);if(process.argv.includes('--run-fixed-trials'))fs.writeFileSync(ledger,json);};
const mp=wechatideNativeClient(project,output),execFile=promisify(cp.execFile),delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const evaluate=async(source:string,...args:unknown[])=>{const r=await mp.call('automation_evaluate',{project,fnSource:source,args});return r.result.result;};
const retained:RetainedReviewHold[]=['tmp/anythingllm-pilot','tmp/agent-comparison','tmp/agent-diagnosis','tmp/agent-contract']
  .flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(f=>/^trial-.*\.json$/.test(f)).flatMap(f=>(JSON.parse(fs.readFileSync(path.join(root,dir,f),'utf8')).calls||[])
    .filter((c:Row)=>c.status!=='succeeded').map((c:Row)=>({id:c.id,runId:c.runId,reservedTokens:c.reservedTokens}))));
let release:(()=>Promise<void>)|undefined,installed=false,ownerId='',ownerUserId='',cloneId='',cloneVersion='';
let quotaCapacity:Row|null=null;
let explanationConfig: { before: Row; opted: Row } | undefined;
const knowledge=new KnowledgeService({enterpriseId:eid,adminId:'16'});
const httpComplete=process.argv.includes('--http-complete'),httpOnly=process.argv.includes('--http-only')||httpComplete,nativePair=process.argv.includes('--native-pair');
const naturalExplanation=process.argv.includes('--natural-explanation');
const frameDiscriminator=process.argv.includes('--frame-discriminator');
const boundedBusinessBatch=process.argv.includes('--bounded-business-batch');
assert.ok(!frameDiscriminator||(naturalExplanation&&httpOnly),'Frame diagnosis is one HTTP-only engineering probe, never native/business acceptance');
assert.ok(!boundedBusinessBatch||(naturalExplanation&&!httpOnly&&!frameDiscriminator&&!nativePair),'Closure batch is the two original journeys, HTTP first and native second, with no reused trial');
assert.ok(!naturalExplanation||!httpComplete,'New semantic mechanism requires two fresh fixed trials; do not reuse the old excerpt journey');
function assertBinding(){
  const binding=JSON.parse(fs.readFileSync(path.join(output,'binding.json'),'utf8')).before;
  const drift=Object.keys(binding).filter(file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==binding[file]);
  report.sourceDrift=drift;assert.deepEqual(drift,[],'Bound source changed; stop dispatch and retain original outputs');
}
async function runtimeSnapshot(){return withPlatformTransaction(async tx=>({
  enterprise:await one(tx,sql`select enabled,md5(agent_config::text) agent_hash,active_index_profile_id,daily_requests,daily_tokens::text,daily_cost_micros::text from app.assistant_enterprise_settings where enterprise_id=${eid}`),
  platform:await rows(tx,sql`select key,md5(llm_config::text) config_hash from app.platform_configs where key='default'`),
  providers:await rows(tx,sql`select key,md5(to_jsonb(p)::text) config_hash from app.ai_provider_configs p where key in ('llm-settings-override','vlm-settings-override') order by key`),
}));}
async function wait<T>(read:()=>Promise<T|null|false|undefined>,name:string,seconds=180):Promise<T>{
  const end=Date.now()+seconds*1000;while(Date.now()<end){const value=await read();if(value)return value;await delay(500);}throw Error('Timed out: '+name);
}
async function step(name:string,work:()=>Promise<unknown>){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}
  catch(error){report.checks.push({name,passed:false,error:(error as Error).message});throw error;}finally{save();}}
async function api(url:string,token:string,method='GET',body?:unknown,key?:string){
  const response=await fetch('http://localhost:3006/api'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
  const value=await response.json();assert.ok(response.ok&&value.success,`${method} ${url}: ${response.status}/${value.error||value.code}`);return value.data||value;
}
async function windowCheck(){
  const r=await execFile('powershell.exe',['-NoProfile','-File',path.join(root,'admin/scripts/wechatide-window-state.ps1')],{windowsHide:true,timeout:10000});
  const state=JSON.parse(r.stdout.replace(/^\uFEFF/,'').trim()),windows=state.Windows.filter((w:Row)=>['WeChat Web Devtools','miniprogram'].includes(w.Title));
  assert.equal(windows.length,1);const w=windows[0],b=w.Minimized?w.NormalBounds:w.Bounds,x=(b.Left+b.Right)/2,y=(b.Top+b.Bottom)/2;
  assert.ok(state.Screens.some((s:Row)=>!s.Primary&&x>=s.Bounds.X&&x<s.Bounds.X+s.Bounds.Width&&y>=s.Bounds.Y&&y<s.Bounds.Y+s.Bounds.Height));
  report.window=state;return {secondaryMonitor:true,minimized:w.Minimized};
}
async function pageAt(route:string){return wait(async()=>{const page=await mp.currentPage();if(page?.path!==route)return null;const data=await page.data();
  if(data.fatal||data.needsLogin)throw Error(JSON.stringify({route,fatal:data.fatal,needsLogin:data.needsLogin,error:data.error}));return !data.loading?page:null;},route);}
async function capture(name:string,route:string){await windowCheck();assert.equal((await mp.currentPage())?.path,route);
  const stack=await evaluate('function(){return getCurrentPages().map(p=>p.route);}');assert.equal(stack.at(-1),route);report.lastCaptureStack=stack;
  const file=path.join(output,name+'.png');await mp.screenshot({path:file});const bytes=fs.readFileSync(file);assert.equal(bytes.subarray(1,4).toString(),'PNG');
  return {route,logical:[390,844],encoded:[bytes.readUInt32BE(16),bytes.readUInt32BE(20)],file};
}
async function session(token:string){const bootstrap=await api('/miniprogram/bootstrap',token);return {token,bootstrap,user:bootstrap.user||{},userId:decodeJwt(token).sub};}
async function login(credentials:Row){const response=await api('/auth/miniprogram','','POST',{type:'password',username:credentials.username,password:credentials.password});
  const value=await session(response.token);assert.equal(response.context.enterpriseId,eid);return {...value,staffId:response.context.staffId,staffRole:response.context.staffRole};}
async function identity(current:Row,route:string){await evaluate(`function(current){const app=getApp(),s=app.__qaV1Knowledge;s.memory.clear();s.memory.set('token',current.token);
    app.globalData.token=current.token;app.globalData.bootstrap=current.bootstrap;app.globalData.userInfo=current.user;}`,current);
  await mp.redirectTo('/'+route);return pageAt(route.split('?')[0]);}
async function snapshotRun(runId:string){return withTenantTransaction(eid,async tx=>({
  run:await one(tx,sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=${eid} and id=${runId}`),
  steps:await rows(tx,sql`select step_seq,kind,status,provider_attempt_id::text,input_summary,private_checkpoint,source_refs from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`),
  usage:await rows(tx,sql`select category,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId}`),
  output:await one(tx,sql`select m.* from app.assistant_messages m join app.assistant_runs r on r.enterprise_id=m.enterprise_id and r.output_message_id=m.id where r.enterprise_id=${eid} and r.id=${runId}`),
  citations:await rows(tx,sql`select c.id::text,c.document_id::text,c.document_version_id::text,c.quote_snapshot from app.assistant_message_citations c where c.enterprise_id=${eid} and c.run_id=${runId}`),
}));}
async function reserve(turn:Row){assertBinding();assert.deepEqual(await runtimeSnapshot(),report.runtimeBefore,'Configured runtime changed before dispatch');reviewBudget(root).assertReservation(0,320000,retained);
  turn.reservationId='pending-'+turn.key;report.calls.push({id:turn.reservationId,runId:'unresolved-operation:'+turn.key,status:'unknown',reservedTokens:320000});
  report.reservationHistory.push({key:turn.key,state:'reserved',tokens:320000,at:new Date().toISOString()});save();}
async function settle(turn:Row){if(!turn.runId)return;const trace=await snapshotRun(turn.runId);
  fs.writeFileSync(path.join(output,'run-'+turn.runId+'.json'),JSON.stringify(trace,null,2));turn.traceFile='run-'+turn.runId+'.json';turn.status=trace.run?.status;turn.error=trace.run?.error_code;
  const models=trace.steps.filter(s=>s.kind==='agent_model');
  turn.firstDraftValidationFailures=trace.steps.filter(s=>s.kind==='agent_validation'&&s.status==='failed').map(s=>s.input_summary);
  turn.sourceQuestionCoverage=(trace.steps.find(s=>s.kind==='retrieval')?.input_summary as Row|undefined)?.questionCoverage;
  if(naturalExplanation)turn.semanticReviews=trace.steps.filter(s=>s.kind==='agent_explanation_review').map(s=>({status:s.status,...s.input_summary as Row}));
  report.calls=report.calls.filter((c:Row)=>c.id!==turn.reservationId);
  for(const model of models){const raw=model.private_checkpoint as Row,usage=raw?.usage,known=usage&&Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens);
    report.calls.push({id:model.provider_attempt_id||`step:${turn.runId}:${model.step_seq}`,runId:turn.runId,status:known?'succeeded':'unknown',reservedTokens:64000,
      ...(known?{usage:{total_tokens:usage.inputTokens+usage.outputTokens}}:{}),rawStep:model.step_seq});}
  if(!models.length&&trace.run?.status==='indeterminate')report.calls.push({id:turn.reservationId,runId:turn.runId,status:'unknown',reservedTokens:320000});
  report.reservationHistory.push({key:turn.key,runId:turn.runId,state:models.every(m=>m.status==='succeeded')?'observed':'retained',at:new Date().toISOString()});
  turn.text=trace.output?safeText(trace.output.content as Parameters<typeof safeText>[0]):'';turn.citations=trace.citations;turn.modelCalls=models.length;save();
  assertBinding();assert.deepEqual(await runtimeSnapshot(),report.runtimeBefore);
  if(report.calls.some((c:Row)=>c.runId===turn.runId&&c.status!=='succeeded'))throw Error('New unknown provider outcome; fixed batch stopped');
  assert.equal(trace.run?.status,'succeeded',`Run ${turn.runId}: ${trace.run?.status}/${trace.run?.error_code}`);
  if(naturalExplanation){assert.equal((trace.run?.policy_snapshot as Row)?.sourceAnswerMode,knowledgeExplanationProtocol);
    assert.ok(turn.semanticReviews.some((r:Row)=>r.status==='succeeded'),'A natural answer needs its durable semantic review');}
  assert.ok(trace.steps.some(s=>s.kind==='retrieval'&&s.status==='succeeded'));
  assert.ok(trace.citations.length,'An enterprise answer requires actual citations');
  const allowed=turn.kind==='customer'?['404','405']:[cloneId,'404','405'];assert.ok(trace.citations.some(c=>allowed.includes(String(c.document_id))));
  for(const expectation of turn.expectations)assert.match(turn.text,expectation);
  assert.doesNotMatch(turn.text,/本项目(?:已|已经)(?:验收|完成)|我家(?:已经)?验收合格/u);
  if(turn.kind==='shared')assert.doesNotMatch(turn.text,/必须先开槽|严禁先穿线/u,'Do not strengthen source wording into a new enterprise prohibition');
}
async function ask(turn:Row,current:Row,cid:string,native:boolean){await reserve(turn);
  try{
    if(native){const route=turn.kind==='customer'?'packages/assistant/chat/chat':'packages/construction/chat/chat';
      const page=await identity(current,route+(turn.kind==='customer'?'?conversationId='+cid:'?projectId='+pid));
      const element=await page.$('.composer-input');assert.ok(element);await element.input(turn.question);
      await wait(async()=>((await page.data()).draft===turn.question),'real input');await(await page.$(turn.kind==='customer'?'.send-button':'.send'))!.tap();
      const run=await wait<Row>(()=>withTenantTransaction(eid,tx=>one(tx,sql`select r.id::text,r.status from app.assistant_runs r join app.assistant_messages m
        on m.enterprise_id=r.enterprise_id and m.id=r.trigger_message_id where r.enterprise_id=${eid} and r.conversation_id=${cid}
        and m.content->'blocks'->0->>'text'=${turn.question} and r.created_at>=${turn.startedAt}::timestamptz order by r.id desc limit 1`)),'actual native service write');turn.runId=run.id;
    }else{const base=turn.kind==='customer'?'/miniprogram/assistant/conversations/'+cid:'/miniprogram/construction/projects/'+pid+'/chat';
      const state=turn.kind==='customer'?null:await api(base,current.token);
      const body=turn.kind==='customer'?{clientMessageId:turn.key,content:{version:1,blocks:[{type:'text',text:turn.question}]}}:{text:turn.question,mediaIds:[],versions:state.versions};
      const sent=await api(base+'/messages',current.token,'POST',body,turn.key);turn.runId=String(sent.runId);
      const repeated=await api(base+'/messages',current.token,'POST',body,turn.key);assert.equal(String(repeated.runId),turn.runId);turn.originalKeyReused=true;
    }
    save();await wait(async()=>{const value=await withTenantTransaction(eid,tx=>one(tx,sql`select status from app.assistant_runs where enterprise_id=${eid} and id=${turn.runId}`));return value&&!['queued','running'].includes(String(value.status))?value:null;},'configured Worker answer',360);
    await settle(turn);
    if(native){const route=turn.kind==='customer'?'packages/assistant/chat/chat':'packages/construction/chat/chat',page=await pageAt(route);
      await wait(async()=>JSON.stringify((await page.data()).messages||(await page.data()).items).includes(turn.text.slice(0,25)),'visible actual answer');
      const citation=turn.citations[0];const selector=turn.kind==='customer'?'.citation-chip[data-id="'+citation.id+'"]':'.record-actions .text-button[data-id="'+citation.id+'"]';
      const messageId=await evaluate(`function(id,shared){const p=getCurrentPages().at(-1),items=shared?p.data.items:p.data.messages;
        const item=items.find(i=>(shared?(i.response&&i.response.citations)||[]:i.citations||[]).some(c=>String(c.id)===id));
        if(!item)throw Error('Citation missing from actual page data');return String(shared?item.message.id:item.id);}`,String(citation.id),turn.kind==='shared');
      await evaluate(`function(target){const p=getCurrentPages().at(-1);p.setData({scrollTarget:''},()=>p.setData({scrollTarget:target}));}`,(turn.kind==='shared'?'source-':'message-')+messageId);await delay(500);
      const source=await page.$(selector);assert.ok(source);turn.sourcePosition={offset:await source.offset(),size:await source.size()};await source.tap();
      await wait(async()=>{const d=await page.data();return d.citation?.available&&d.citation.quote;},'source original opens');
      turn.capture=await capture('source-'+turn.runId,route);await evaluate('function(){getCurrentPages().at(-1).closeSheet(true);}');
      await mp.redirectTo('/'+route+(turn.kind==='customer'?'?conversationId='+cid:'?projectId='+pid));
      const reentry=await pageAt(route);await wait(async()=>JSON.stringify((await reentry.data()).messages||(await reentry.data()).items).includes(turn.text.slice(0,25)),'persisted native reentry');turn.reentry=true;
    }else{const read=await api(turn.kind==='customer'?'/miniprogram/assistant/conversations/'+cid+'/messages':'/miniprogram/construction/projects/'+pid+'/chat',current.token);
      fs.writeFileSync(path.join(output,'readback-'+turn.runId+'.json'),JSON.stringify(read,null,2));
      assert.ok(JSON.stringify(read).includes(turn.text.slice(0,25)));turn.reentry=true;}
    turn.passed=true;
  }finally{if(turn.runId&&!turn.traceFile)await settle(turn);save();}
}
async function main(){
  const database=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(database.hostname)&&database.port==='5432'&&database.pathname==='/smart_floor_planner');
  const control=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8')).DATABASE_URL;
  release=await lockAssistantAcceptance(control,{waitForLock:true});
  await step('idle real development queue',async()=>{const value=await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int active from app.assistant_jobs where status in ('queued','running')`));assert.equal(value?.active,0);return value;});
  if(process.argv.includes('--inventory-only')){const status=await mp.call('check_wechatide_status');report.ideStatus=status;console.log(JSON.stringify({statusKeys:Object.keys(status)}));report.passed=true;return;}
  if(!httpOnly){
  await step('unique Stable project window on secondary monitor',windowCheck);
  await step('registered Stable CLI and existing authorization',async()=>{const status=await mp.call('check_wechatide_status',{skillVersion:'0.3.11'});
    assert.ok(['equal','agent_ahead'].includes(status.versionRelation));assert.equal(status.loginExpired,false);assert.equal(status.cliTokenRequired,false);
    return {versionRelation:status.versionRelation,loginExpired:false,skillVersion:status.skillVersion,project};});
  await step('fresh compilation and live official SDK data',async()=>{let last:unknown;for(let i=0;i<2;i++){try{await mp.call('simulator_refresh',{project});await delay(6000);const info=await mp.systemInfo(),page=await mp.currentPage();assert.ok(page&&Object.keys(await page.data()).length);assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);return {info,route:page.path,freshCompile:true};}catch(error){last=error;}}throw last;});
  }
  if(!process.argv.includes('--run-fixed-trials')){report.passed=true;return;}
  assertBinding();report.runtimeBefore=await runtimeSnapshot();
  report.budgetBefore=reviewBudget(root).usedMicros;report.fixedPlan={totalTriesPerJourney:2,thisBatchTrialsPerJourney:httpComplete?{customer:1,shared:2}:httpOnly||nativePair?1:2,
    customerTurns:3,sharedTurns:3,maxNewRuns:httpComplete?9:httpOnly||nativePair?6:12,configuredModelUnchanged:true,
    sourceAnswerMode:naturalExplanation?knowledgeExplanationProtocol:'validated-source-excerpts-v1',sourceQuestionCoverage:'source-question-coverage-v1',priorFailures:[{batch:'http-fixed-01',runId:'1596',retained:true},{batch:'excerpt-http-02',runId:'1597',retained:true},{batch:'semantic-final-01',runId:'1602',retained:true}],
    ...(httpComplete?{reusedCustomerTrial:'wire-http-01/customer/round1',unreusedSharedPartial:'wire-http-01/run-1601',pendingZeroModelNative:true}:httpOnly?{pendingNativePair:true}:{}),...(nativePair?{pairedWith:process.argv.find(v=>v.startsWith('--paired-with='))?.slice(14)||(naturalExplanation?'explanation-nullable-http-01':'wire-http-01')}:{})};save();
  // A reversible development-fixture allowance for retained historical token
  // holds. Never settle unknown usage, increase either cash cap or change a model.
  await step('temporary development token capacity within existing cash caps',async()=>withTenantTransaction(eid,async tx=>{
    const before=await one(tx,sql`select daily_tokens::text,daily_requests,daily_cost_micros::text from app.assistant_enterprise_settings where enterprise_id=${eid} for update`);
    assert.ok(before);assert.equal(before.daily_tokens,'1200000');assert.equal(before.daily_cost_micros,'100000000');
    await tx.execute(sql`update app.assistant_enterprise_settings set daily_tokens=2200000,version=version+1,updated_at=now() where enterprise_id=${eid}`);
    quotaCapacity=before;report.quotaCapacity={before,temporaryTokens:'2200000',cashCapChanged:false,historicalReservationsChanged:false};return report.quotaCapacity;
  }));save();
  if(naturalExplanation)await step('temporary development-only explanation strategy; configured model unchanged',async()=>withTenantTransaction(eid,async tx=>{
    const settings=await one(tx,sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${eid} for update`);
    const before=settings!.agent_config as Row;assert.equal(before.model,'qwen3.7-flash');assert.equal(before.knowledgeExplanation,undefined);
    const opted={...before,knowledgeExplanation:knowledgeExplanationProtocol};
    await tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(opted)}::jsonb,version=version+1,updated_at=now() where enterprise_id=${eid}`);
    explanationConfig={before,opted};report.strategyOptIn={protocol:knowledgeExplanationProtocol,modelChanged:false,restored:false};return report.strategyOptIn;
  }));
  report.runtimeBefore=await runtimeSnapshot();
  if(frameDiscriminator)report.fixedPlan={...report.fixedPlan,kind:'invalid-function-arguments discriminator only',maxNewRuns:1,
    businessAcceptance:false,hypotheses:['JSON envelope/double encoding','boolean serialization','incomplete JSON syntax'],noRetry:true};
  if(boundedBusinessBatch)report.fixedPlan={...report.fixedPlan,kind:'one consolidated closure business batch',totalTriesPerJourney:2,
    thisBatchTrialsPerJourney:2,maxNewRuns:12,rounds:['HTTP original journeys','Stable native original journeys'],
    stopOnBlockingFailureOrUnknown:true,noRenamedDiagnosticBatches:true,originalQuestionsPreserved:true,
    retainedCurrentRuns:['1603','1604','1605','1606','1607','1608']};
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-manual-fixture-20261030/manifest.json'),'utf8'));
  const user=await withPlatformTransaction(tx=>one(tx,sql`select id,context_version from app.users where id=${String(fixture.customerId)}`));assert.ok(user);
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:String(user.id)},contextVersion:Number(user.context_version),capabilities:['assistant.chat.self'],entry:{kind:'lead',id:'3132'}};
  const customerToken=await new SignJWT({id:String(user.id),mode:'customer',role:'user',enterpriseId:eid,contextVersion:Number(user.context_version),source:'wechat'}).setProtectedHeader({alg:'HS256'}).setSubject(String(user.id)).setAudience('miniprogram').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET||'fallback_secret_random_123'));
  const customer=await session(customerToken),accounts=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-manual-fixture-20261030/accounts.private.json'),'utf8')).accounts;
  const worker=await login(accounts.worker),designer=await login(accounts.designer_a);
  const password=randomBytes(24).toString('base64url'),username='synthetic-v1-owner-'+randomUUID(),passwordHash=await bcrypt.hash(password,10);
  ownerId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.admin_users(enterprise_id,username,display_name,password_hash,role,status,must_change_password,menu_permissions)
    values(${eid},${username},'合成测试·微云V1企业负责人',${passwordHash},'enterprise_admin','active',false,ARRAY['construction-projects']) returning id`)))!.id);
  fs.writeFileSync(path.join(output,'owner-credentials.private.json'),JSON.stringify({ownerId,username,password}));report.ownedOwnerId=ownerId;save();
  const initialBoss=await login({username,password});ownerUserId=String(initialBoss.userId);
  // The original owner-contact diagnosis established this existing Mini scope
  // requirement. Only this newly owned synthetic account receives a contact.
  await withPlatformTransaction(async tx=>{const phone='1990000'+ownerId.slice(-4).padStart(4,'0');
    const seeded=await one(tx,sql`update app.users u set phone=${phone} where u.id=${ownerUserId} and coalesce(u.phone,'')=''
      and exists(select 1 from app.admin_users a where a.id=${ownerId} and a.user_id=u.id and a.enterprise_id=${eid} and a.username=${username})
      and not exists(select 1 from app.users other where other.phone=${phone} and other.id<>u.id) returning id`);assert.ok(seeded);});
  const boss=await login({username,password});assert.equal(String(boss.userId),ownerUserId);
  const originals=await withTenantTransaction(eid,tx=>rows(tx,sql`select c.text from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v
    on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id where c.enterprise_id=${eid} and v.document_id=404 and (c.text like '%线管弯头%' or c.text like '%布管穿线%') order by c.ordinal`));assert.equal(originals.length,2);
  const clone=await knowledge.execute('create',{sourceType:'manual_text',audience:'staff_internal',title:'合成测试·微云内部精艺工艺复核资料',category:'合成测试',body:'微云内部精艺工艺复核资料：原PDF第29页水电工艺标准节选，仅用于本地测试，不是现场完成记录。\n'+originals.map(o=>o.text).join('\n')},randomUUID());
  cloneId=String((clone.document as Row).id);cloneVersion=String((clone.draft as Row).id);report.temporaryKnowledge={cloneId,cloneVersion};save();
  const indexed=await knowledge.execute('index',{documentId:cloneId,versionId:cloneVersion,expectedEditVersion:1},randomUUID());
  await wait(async()=>{const j=await knowledge.execute('job',{jobId:indexed.jobId});if(['failed','indeterminate'].includes(String(j.status)))throw Error('Index '+j.status+'/'+j.last_error);return j.status==='succeeded'?j:null;},'real test-source indexing');
  await knowledge.execute('publish',{documentId:cloneId,versionId:cloneVersion,expectedVersion:1,expectedEditVersion:1},randomUUID());
  if(!httpOnly){await evaluate(`function(){const app=getApp();if(app.__qaV1Knowledge)throw Error('Another native controller owns the fixture');
    const s=app.__qaV1Knowledge={global:{...app.globalData},hydrate:app.hydrateStoredSession,memory:new Map(),originals:{get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request}};
    const page=getCurrentPages().at(-1);s.route=page.route;s.options=page.options||{};
    wx.getStorageSync=function(k){return s.memory.get(k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};
    wx.request=function(o){const copy={...o};const at=String(copy.url).indexOf('/api/');if(at>=0)copy.url='http://127.0.0.1:3006/api/'+String(copy.url).slice(at+5);return s.originals.request.call(wx,copy);};app.hydrateStoredSession=async function(){return true;};}`);installed=true;}
  const customerQuestions=naturalExplanation?[frameDiscriminator?'《精艺》里，防水基层要怎么准备？管根要怎么加强？':'我在看《精艺》这份装修手册，卫生间防水前要准备什么？管根又该怎么处理？','我刚才说得不准，是水管根部，不是整面墙。为什么这里还要单独处理？','不是问材料刷完就算验收，我想知道什么条件下才适合继续铺砖？']
    :['我在看《精艺》这份装修手册，卫生间防水前要准备什么？','我是说管根，不是整面墙。要先处理哪些地方？','不是问材料刷完就算验收，我想知道什么条件下才适合继续铺砖？'];
  const staffQuestions=['微云内部的精艺工艺复核资料里，电视墙线管拐弯和穿线顺序该怎么理解？','我是说先穿线还是先铺管，为什么要这样做？','不是问我们现场已经做完没，我想知道这几项做法分别是为了解决什么问题。'];
  const customerChecks=naturalExplanation?[[/基层|地基/,/管根/,/堵漏宝|附加层/],[/管根|水管根部/,/渗|漏|衔接|接缝|薄弱/],[/闭水/,/合格/,/贴砖|铺砖/,/干透|保护层/]]
    :[[/基层|地基/,/防水坝|管根|清理/],[/管根/,/堵漏宝/,/附加层/],[/闭水/,/合格/,/贴砖|铺砖/,/干透|保护层/]];
  const sharedChecks=[[/大弯/,/穿线/,/维修|抽线/],[/铺.*管|铺管|铺设线管/,/穿线/,/抽|维修/],[/抽线|抽动|维修/,/先穿线|后铺管|铺设|顺序/]];
  const rounds=boundedBusinessBatch?[{round:1,native:false,kinds:['customer','shared']},{round:2,native:true,kinds:['customer','shared']}]
    :httpComplete?[{round:1,native:false,kinds:['shared']},{round:2,native:false,kinds:['customer','shared']}]
    :httpOnly?[{round:1,native:false,kinds:['customer','shared']}]:nativePair?[{round:2,native:true,kinds:['customer','shared']}]
    :[{round:1,native:true,kinds:['customer','shared']},{round:2,native:false,kinds:['customer','shared']}];
  for(const round of rounds){
    const conversation=await new ConversationService(actor).create(randomUUID()),cid=String(conversation.id);
    for(const kind of round.kinds) {const trial:Row={round:round.round,kind,native:round.native,turns:[]};report.trials.push(trial);save();
      const currentShared=await api('/miniprogram/construction/projects/'+pid+'/chat',worker.token),conversationId=kind==='customer'?cid:String(currentShared.conversationId);
      for(let index=0;index<3;index++){const turn:Row={kind,role:kind==='customer'?'customer':['worker','designer','boss'][index],question:(kind==='customer'?customerQuestions:staffQuestions)[index],key:randomUUID(),startedAt:new Date().toISOString(),
        expectations:(kind==='customer'?customerChecks:sharedChecks)[index]};trial.turns.push(turn);
        await ask(turn,kind==='customer'?customer:[worker,designer,boss][index],conversationId,round.native);console.log(`fixed ${kind} round${round.round} turn${index+1}: PASS`);
        if(frameDiscriminator){report.protocolDiscriminator={decoded:true,runId:turn.runId,businessAcceptance:false};return;}}
      trial.passed=trial.turns.every((t:Row)=>t.passed);save();
    }
  }
  const cited=report.trials.filter((t:Row)=>t.kind==='shared').flatMap((t:Row)=>t.turns).flatMap((t:Row)=>t.citations).find((c:Row)=>c.document_id===cloneId);assert.ok(cited,'Fixed internal-source journey must actually cite its scoped original before testing withdrawal');
  await step('actual cited source withdrawal, private-source customer denial and native reentry',async()=>{
    const denied=await fetch('http://localhost:3006/api/miniprogram/assistant/citations/'+cited.id,{headers:{Authorization:'Bearer '+customerToken}});assert.equal(denied.status,404);
    const detail=await knowledge.execute('detail',{documentId:cloneId});await knowledge.execute('retire',{documentId:cloneId,expectedVersion:Number((detail.document as Row).version)},randomUUID());
    const source=await api('/miniprogram/construction/projects/'+pid+'/chat/citations/'+cited.id,worker.token);assert.equal(source.available,false);assert.equal(source.quote,undefined);
    if(!httpOnly){const page=await identity(worker,'packages/construction/chat/chat?projectId='+pid);await wait(async()=>JSON.stringify((await page.data()).items).includes('原回答不再沿用'),'withdrawn derived answer');
      return capture('withdrawn-source-reentry','packages/construction/chat/chat');}
    const read=await api('/miniprogram/construction/projects/'+pid+'/chat',worker.token);assert.match(JSON.stringify(read),/原回答不再沿用/);return {httpReentry:true,sourceRevoked:true};});
  report.passed=report.trials.length===(httpComplete?3:httpOnly||nativePair?2:4)&&report.trials.every((t:Row)=>t.passed);report.budgetAfter=reviewBudget(root).usedMicros;
}
main().catch(error=>{report.error=(error as Error).stack||String(error);process.exitCode=1;console.error((error as Error).message);}).finally(async()=>{
  try{if(installed){const original=await evaluate(`function(){const app=getApp(),s=app.__qaV1Knowledge;if(!s)return null;const original={route:s.route,options:s.options};
      wx.getStorageSync=s.originals.get;wx.setStorageSync=s.originals.set;wx.removeStorageSync=s.originals.remove;wx.request=s.originals.request;app.hydrateStoredSession=s.hydrate;
      for(const key of Object.keys(app.globalData))delete app.globalData[key];Object.assign(app.globalData,s.global);delete app.__qaV1Knowledge;return original;}`);
      if(original?.route)await mp.reLaunch('/'+original.route+(Object.keys(original.options).length?'?'+new URLSearchParams(original.options).toString():''));report.sessionRestored=true;}
    if(cloneId){const detail=await knowledge.execute('detail',{documentId:cloneId});if((detail.document as Row).status!=='retired')await knowledge.execute('retire',{documentId:cloneId,expectedVersion:Number((detail.document as Row).version)},randomUUID());}
    if(ownerId)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.admin_users set status='disabled' where id=${ownerId} and username like 'synthetic-v1-owner-%'`);if(ownerUserId)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${ownerUserId}`);});
    fs.rmSync(path.join(output,'owner-credentials.private.json'),{force:true});
  }catch(error){report.cleanupError=(error as Error).message;report.passed=false;process.exitCode=1;}
  finally{try{if(explanationConfig){const restored=await withTenantTransaction(eid,tx=>one(tx,sql`update app.assistant_enterprise_settings
      set agent_config=${JSON.stringify(explanationConfig!.before)}::jsonb,version=version+1,updated_at=now() where enterprise_id=${eid}
      and agent_config=${JSON.stringify(explanationConfig!.opted)}::jsonb returning enterprise_id`));assert.ok(restored,'Strategy changed concurrently; do not overwrite it');report.strategyOptIn.restored=true;}}
    catch(error){report.strategyRestoreError=(error as Error).message;report.passed=false;process.exitCode=1;}
    try{if(quotaCapacity){const restored=await withTenantTransaction(eid,tx=>one(tx,sql`update app.assistant_enterprise_settings
      set daily_tokens=${quotaCapacity!.daily_tokens},version=version+1,updated_at=now() where enterprise_id=${eid} and daily_tokens=2200000
      and daily_requests=${quotaCapacity!.daily_requests} and daily_cost_micros=${quotaCapacity!.daily_cost_micros} returning daily_tokens::text`));
      assert.ok(restored,'Quota changed concurrently; do not overwrite it');report.quotaCapacity.restored=restored.daily_tokens===quotaCapacity.daily_tokens;}}
    catch(error){report.quotaRestoreError=(error as Error).message;report.passed=false;process.exitCode=1;}
    if(release)await release();report.finishedAt=new Date().toISOString();save();await closePostgresPool();}
});
