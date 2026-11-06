/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated configured-model acceptance inspects private service snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
const require=createRequire(process.cwd()+'/package.json');require('@next/env').loadEnvConfig(process.cwd(),true);
const providerSourceDatabase=process.env.DATABASE_URL;
process.env.DATABASE_URL=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8')).DATABASE_URL;
const {sql}=require('drizzle-orm'),root=path.resolve('..'),imp=(p:string)=>import(pathToFileURL(path.resolve(p)).href);
const {withTenantTransaction,withPlatformTransaction}=await imp('src/db/transaction.ts');
const {one,rows}=await imp('src/db/repositories/assistant-repository.ts');
const {closePostgresPool}=await imp('src/lib/postgresql.ts');
const {ConversationService}=await imp('src/lib/assistant/core/conversation.ts');
const {readMemory}=await imp('src/lib/assistant/agent/memory.ts');
const {safeText}=await imp('src/lib/assistant/contracts/index.ts');
const {minimalDialogueProtocol}=await imp('src/lib/assistant/agent/minimal-dialogue.ts');
const {processAgentAnswer}=await imp('src/lib/assistant/agent/worker.ts');
const {processAssistantRun}=await imp('src/lib/assistant/application/worker.ts');
const {claimJob}=await imp('src/lib/assistant/infrastructure/job-queue.ts');
const {lockAssistantAcceptance}=await imp('scripts/assistant-acceptance-safety.mjs');
assert.ok(process.argv.includes('--live'),'Explicit --live required; no automatic retry');
const model=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||'qwen3.8-flash';
assert.ok(['qwen3.8-flash','qwen3.8-max','qwen3.7-plus','deepseek-v4.1-flash-1017'].includes(model),'Use only the fixed original or authorized replacement model');
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'../tmp/xiaok-dify-dialogue-20261106/trials01');fs.mkdirSync(out,{recursive:true});
assert.ok(!fs.existsSync(path.join(out,'report.json')),'Do not overwrite or resample a previous attempt');
const eid='1454',prefix='synthetic-minimal-dialogue-'+randomUUID(),read=(fn:any)=>withTenantTransaction(eid,fn),platform=(fn:any)=>withPlatformTransaction(fn);
const questions=['帮我记一下：书房书桌靠窗，书房保留收纳。','书房书桌改为靠内墙。','我刚才的书房想法是什么？这样布置有什么需要注意的？','我家准备用立邦醛零防霉耐水腻子，帮我查一下官网的施工温度和湿度条件。','刚才说的要求是我们公司已经定下来的做法吗？'];
const report:any={scope:'Two unchanged natural five-turn dialogues with Dify-shaped v3 assembly: plain role messages, retained authorized public answers, original public-only ancestor receipts and front-loaded source policy. Same tools/2048/thinking-off services and guards. Stop on first blocker/unknown/drift; no resampling. Revocation probes use injected model output and no provider calls, separate from semantic trials.',protocol:minimalDialogueProtocol,model,fixedTrials:2,questions,maxModelCalls:32,originalFailedRepairCount:2,retainedReplacementRuns:['10668','10669','10670','10671'],retainedMinimalRuns:['10673','10674','10675','10676','10677','10678','10679','10680','10695'],newMechanismTrials:2,repairIterations:2,retainedIntegrationFailures:['10699','10704'],trials:[],providerHttpErrors:[],passed:false};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const ts=require('typescript'),cfg=ts.readConfigFile('tsconfig.json',ts.sys.readFile),options=ts.parseJsonConfigFileContent(cfg.config,ts.sys,process.cwd()).options,files=new Set<string>();
function visit(f:string){if(files.has(f)||f.includes('node_modules')||!fs.existsSync(f))return;files.add(f);for(const i of ts.preProcessFile(fs.readFileSync(f,'utf8'),true,true).importedFiles){const r=ts.resolveModuleName(i.fileName,f,options,ts.sys).resolvedModule?.resolvedFileName;if(r)visit(path.resolve(r));}}
for(const f of ['src/lib/assistant/core/conversation.ts','src/lib/assistant/application/worker.ts','src/lib/assistant/application/http.ts',
 'scripts/wechatide-native-client.ts','scripts/assistant-acceptance-safety.mjs'])visit(path.resolve(f));
for(const f of [fileURLToPath(import.meta.url),'scripts/xiaok-minimal-dialogue-native.cjs','src/lib/assistant/__tests__/minimal-dialogue.test.ts','src/lib/assistant/__tests__/consultation-projection.test.ts','src/lib/assistant/__tests__/web.test.ts','.env.local','package.json','package-lock.json','tsconfig.json',path.resolve('../tmp/xiaok-vector/connection.private.json')])files.add(path.resolve(f));
const binding=()=>Object.fromEntries([...files].sort().map(f=>[path.relative(root,f).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const runtime=()=>read(async(tx:any)=>({assistant:await one(tx,sql`select agent_config,policy_version from app.assistant_enterprise_settings where enterprise_id=1454`),platform:await one(tx,sql`select md5(llm_config::text) hash from app.platform_configs where key='default'`)}));
const counts=()=>platform(async(tx:any)=>({provider:Number((await one(tx,sql`select count(*)::int n from app.ai_provider_attempts`)).n),queue:Number((await one(tx,sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`)).n)}));
const walk=(dir:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','miniprogram_npm'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else files.add(f);}};walk(path.join(root,'miniprogram'));
const originalFetch=globalThis.fetch,owned:any[]=[],users:string[]=[];let release:any,assistantBefore:any,platformBefore:any,opted:any;
try{
 release=await lockAssistantAcceptance(process.env.DATABASE_URL,{waitForLock:true});report.before=await counts();assert.equal(report.before.queue,0);
 assistantBefore=await read((tx:any)=>one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=1454`));assert.equal(assistantBefore.enabled,false);
 await read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=true,agent_config=${JSON.stringify({runtime:'langgraph-v1',model,providerKey:'dashscope',imageInput:false,tools:true,probeVersion:minimalDialogueProtocol,enterpriseKnowledgeEnabled:false})}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
 const sourceUrl=new URL(providerSourceDatabase!);assert.ok(['localhost','127.0.0.1'].includes(sourceUrl.hostname)&&sourceUrl.port==='5432'&&sourceUrl.pathname==='/smart_floor_planner');
 const sourceClient=new (require('pg').Client)({connectionString:providerSourceDatabase});let source:any;
 try{await sourceClient.connect();await sourceClient.query('begin read only');source=(await sourceClient.query("select llm_config from app.platform_configs where key='default'")).rows[0]?.llm_config;await sourceClient.query('rollback');}finally{await sourceClient.end();}
 assert.equal(source.providerKey,'dashscope');platformBefore=await platform((tx:any)=>one(tx,sql`select llm_config from app.platform_configs where key='default' for update`));opted={...source,model};
 await platform((tx:any)=>tx.execute(sql`update app.platform_configs set llm_config=${JSON.stringify(opted)}::jsonb where key='default'`));
 globalThis.fetch=async(...args:Parameters<typeof originalFetch>)=>{const response=await originalFetch(...args);if(response.status===429){const body=await response.clone().text();report.providerHttpErrors.push({status:429,bodyHash:createHash('sha256').update(body).digest('hex'),body});save();}return response;};
 report.bindingBefore=binding();report.runtimeBefore=await runtime();save();
 for(let trial=1;trial<=2;trial++){
  const uid=String((await platform((tx:any)=>one(tx,sql`insert into app.users(nickname,context_version) values(${prefix+':'+trial},1) returning id`))).id);users.push(uid);
  await platform((tx:any)=>tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix+':openid:'+trial})`));
  const actor={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self']};
  const service=new ConversationService(actor),cid=String((await service.create(randomUUID())).id);owned.push({service,cid,uid,actor});
  const journey:any={trial,conversationId:cid,turns:[]};report.trials.push(journey);save();
  for(const question of questions){
   const key=randomUUID(),content={version:1,blocks:[{type:'text',text:question}]},queued=await service.send(cid,key,content);assert.ok(queued.runId);
   assert.equal((await service.send(cid,key,content)).runId,queued.runId);
    const item:any={question,runId:queued.runId,startedAt:new Date().toISOString()};journey.turns.push(item);save();
   const lease=await claimJob();assert.equal(lease.runId,queued.runId);await processAssistantRun(lease);
   const trace=await read(async(tx:any)=>({run:await one(tx,sql`select id::text,status,error_code,output_message_id::text,policy_snapshot from app.assistant_runs where enterprise_id=1454 and id=${queued.runId}`),
      steps:await rows(tx,sql`select step_seq,kind,status,capability_name,input_summary,private_checkpoint,source_refs,provider_attempt_id::text from app.assistant_run_steps where enterprise_id=1454 and run_id=${queued.runId} order by step_seq`),
     usage:await rows(tx,sql`select category,input_tokens,output_tokens,measurement_kind from app.assistant_usage_records where enterprise_id=1454 and run_id=${queued.runId}`),
     attempts:await rows(tx,sql`select id::text,status,accepted,error_code,actual_cost,metadata from app.ai_provider_attempts where enterprise_id=1454 and assistant_run_id=${queued.runId} order by id`)}));
    fs.writeFileSync(path.join(out,'run-'+queued.runId+'.json'),JSON.stringify(trace,null,2));item.status=trace.run.status;item.error=trace.run.error_code;item.finishedAt=new Date().toISOString();item.attempts=trace.attempts.map((a:any)=>({id:a.id,status:a.status,accepted:a.accepted,error:a.error_code}));save();
   assert.equal(trace.run.status,'succeeded',trace.run.error_code);
    assert.equal(trace.run.policy_snapshot.dialogueContext,minimalDialogueProtocol);
   for(const step of trace.steps.filter((s:any)=>s.capability_name==='web.search.v1')){
    assert.equal(step.input_summary?.discoveryScope?.protocol,'public-domain-provenance-v1');
    assert.deepEqual(step.private_checkpoint.query.domains,[],'Original question names no domain; a model guess cannot constrain discovery');
   }
   assert.ok(!trace.steps.some((s:any)=>s.capability_name==='knowledge.search.v1'));assert.ok(!trace.usage.some((u:any)=>u.category==='query_embedding'));
   const messages=await service.messages(cid),again=await new ConversationService(actor).messages(cid);assert.deepEqual(messages.items,again.items);
   const reply=messages.items.find((m:any)=>m.id===trace.run.output_message_id);assert.ok(reply);item.answer=reply.content;item.reply=reply;item.reentrySame=true;
   const prose=(reply.content.blocks||[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text||'').join('\n');
    const saved=trace.steps.filter((s:any)=>s.kind==='agent_need_write'&&s.status==='succeeded').flatMap((s:any)=>s.private_checkpoint.receipt.savedFacts);
    const entry=await read((tx:any)=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=1454 and id=${cid}`));
    item.memory=readMemory(entry.entry_snapshot);const current=item.memory.facts.filter((f:any)=>f.status==='current');
    if(question===questions[0]){assert.ok(saved.some((f:any)=>f.room==='书房'&&f.field==='desk'&&f.value.includes('靠窗')));assert.ok(saved.some((f:any)=>f.field==='storage'&&f.value.includes('收纳')));}
    else if(question===questions[1]){assert.ok(saved.some((f:any)=>f.room==='书房'&&f.field==='desk'&&f.value.includes('靠内墙')));assert.ok(!current.some((f:any)=>f.field==='desk'&&f.value.includes('靠窗')));assert.ok(current.some((f:any)=>f.field==='storage'&&f.value.includes('收纳')));}
    else if(question===questions[2]){assert.equal(saved.length,0);assert.ok(prose.includes('靠内墙')&&prose.includes('收纳'),'Recall must retain the correction and independent storage requirement');}
    else if(question===questions[3]){assert.ok(['5','35','85'].every(n=>prose.includes(n)),'Must actually answer both manufacturer temperature and humidity conditions');
    assert.ok((reply.citations||[]).some((c:any)=>c.available&&String(c.sourceUrl||c.sourceLocation||'').includes('nipponpaint.com.cn')),'Actual current manufacturer citation required');}
   else{assert.ok(/公开|网页|官网|厂家|生产商/.test(prose)&&/不能|尚|没有|未|不代表|不等于|待核|需/.test(prose),'Must distinguish external original from unverified company adoption');}
   assert.ok((await counts()).provider-report.before.provider<=report.maxModelCalls);save();
  }
 }
  const first=report.trials[0].turns[3],citation=first.reply.citations.find((c:any)=>c.available&&String(c.sourceUrl||c.sourceLocation||'').includes('nipponpaint.com.cn'));
 await assert.rejects(owned[1].service.citation(citation.id,false,owned[0].cid));
  await assert.rejects(owned[1].service.messages(owned[0].cid));
 const liveSource=await owned[0].service.citation(citation.id,false,owned[0].cid);assert.ok(liveSource.available&&liveSource.quote&&liveSource.sourceUrl);
 report.permissions={otherCustomerDenied:true,originalQuoteReadback:true};
 const {SignJWT}=require('jose'),{assistantHttp}=await imp('src/lib/assistant/application/http.ts');
 const owner=owned[0],token=await new SignJWT({id:owner.uid,mode:'customer',role:'user',enterpriseId:eid,contextVersion:1,source:'password'})
  .setProtectedHeader({alg:'HS256'}).setSubject(owner.uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  report.native=await require(path.resolve('scripts/xiaok-minimal-dialogue-native.cjs'))({root,output:out,actor:{uid:owner.uid,token,cid:owner.cid,citation:liveSource},assistantHttp,
    revokeSource:async()=>{
      await read((tx:any)=>tx.execute(sql`update app.assistant_run_steps set private_checkpoint=null where enterprise_id=1454 and run_id=${first.runId} and capability_name in ('web.search.v1','web.read.v1')`));
      assert.equal((await owner.service.citation(citation.id,false,owner.cid)).available,false);
      assert.ok((await owner.service.messages(owner.cid)).items.some((m:any)=>m.available===false));
      report.permissions.sourceRevocation=true;save();
    }});save();assert.equal(report.native.passed,true);
  // These two probes exercise the existing revocation fence with a deterministic
  // model port. They are engineering evidence, not additional model trials.
  report.revocationProbes=[];
  const textOf=(message:any)=>safeText(message.content);
  const probe=async(target:any,sourceTurn:any,duringDispatch:boolean)=>{
    const question=duringDispatch?'刚才那份厂家要求能证明公司采用吗？':'刚才那份资料现在还能作为依据吗？';
    const queued=await target.service.send(target.cid,randomUUID(),{version:1,blocks:[{type:'text',text:question}]});
    const providerBefore=(await counts()).provider,lease=await claimJob();assert.equal(lease.runId,queued.runId);
    let dispatches=0,wire:any[]=[];
    await processAgentAnswer(lease,{model:async(messages:any[])=>{
      dispatches++;assert.equal(dispatches,1);wire=messages;
      const last=messages.filter(m=>m.role==='user').at(-1);assert.equal(last.content.find((p:any)=>p.type==='text').text,question);
      const retained=messages.some(m=>m.role==='assistant'&&typeof m.content==='string'&&m.content===textOf(sourceTurn.reply));
      assert.equal(retained,duringDispatch,'Only currently authorized public answer text may enter the model');
      const web=messages.filter(m=>m.role==='tool').flatMap(m=>{try{return JSON.parse(m.content).synthesisSources||[];}catch{return[];}}).filter(s=>s.kind==='web');
      assert.equal(web.length>0,duringDispatch);
      if(duringDispatch)await read((tx:any)=>tx.execute(sql`update app.assistant_run_steps set private_checkpoint=null where enterprise_id=1454 and run_id=${sourceTurn.runId} and capability_name in ('web.search.v1','web.read.v1')`));
      return {text:'',toolCalls:[{id:'synthetic-revocation-final',name:'final_response',arguments:JSON.stringify(duringDispatch
        ?{kind:'synthesis',segments:[{basis:'uncertainty',text:'本次无法确认公司是否采用。',citations:[]}]}
        :{kind:'unavailable',text:'本次资料已不可用，暂时无法确认。'})}],finishReason:'tool_calls',providerRequestId:null,usage:{inputTokens:0,outputTokens:0,cachedInputTokens:0}};
    }});
    const state=await read((tx:any)=>one(tx,sql`select status,error_code,output_message_id::text from app.assistant_runs where enterprise_id=1454 and id=${queued.runId}`));
    const result={runId:queued.runId,scope:'injected model port; no provider call',duringDispatch,dispatches,state,providerDelta:(await counts()).provider-providerBefore};
    fs.writeFileSync(path.join(out,'revocation-probe-'+queued.runId+'.json'),JSON.stringify({...result,wireMessages:wire},null,2));
    report.revocationProbes.push(result);save();assert.equal(result.providerDelta,0);
    assert.equal(state.status,duringDispatch?'failed':'succeeded');
    if(duringDispatch){assert.equal(state.error_code,'context_changed');assert.equal(state.output_message_id,null);}
  };
  await probe(owner,first,false);
  await probe(owned[1],report.trials[1].turns[3],true);
 report.runtimeAfter=await runtime();assert.deepEqual(report.runtimeAfter,report.runtimeBefore);report.passed=true;
}catch(e){report.error=(e as Error).stack||String(e);process.exitCode=1;}
finally{
 try{
  for(const c of owned){const row=await read((tx:any)=>one(tx,sql`select status,version from app.assistant_conversations where enterprise_id=1454 and id=${c.cid}`));if(row.status==='open')await c.service.archive(c.cid,Number(row.version),randomUUID());}
  for(const uid of users)await platform((tx:any)=>tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`));
  if(platformBefore){const restored=await platform((tx:any)=>one(tx,sql`update app.platform_configs set llm_config=${JSON.stringify(platformBefore.llm_config)}::jsonb where key='default' and llm_config=${JSON.stringify(opted)}::jsonb returning key`));assert.ok(restored,'Do not overwrite platform configuration drift');}
  if(assistantBefore)await read((tx:any)=>tx.execute(sql`update app.assistant_enterprise_settings set enabled=${assistantBefore.enabled},agent_config=${JSON.stringify(assistantBefore.agent_config)}::jsonb,policy_version=policy_version+1,version=version+1 where enterprise_id=1454`));
  report.cleanup={archivedChats:owned.length,revokedUsers:users.length,configurationRestored:true};report.after=await counts();assert.equal(report.after.queue,0);
 }catch(e){report.cleanupError=String(e);report.passed=false;process.exitCode=1;}
 globalThis.fetch=originalFetch;if(release)await release();if(report.bindingBefore){report.bindingAfter=binding();report.drift=Object.keys(report.bindingBefore).filter(f=>report.bindingBefore[f]!==report.bindingAfter[f]);if(report.drift.length){report.passed=false;process.exitCode=1;}}
 save();await closePostgresPool();console.log(JSON.stringify({passed:report.passed,trials:report.trials.map((t:any)=>({trial:t.trial,turns:t.turns.map((v:any)=>({runId:v.runId,status:v.status,error:v.error,attempts:v.attempts}))})),error:report.error,cleanup:report.cleanup,cleanupError:report.cleanupError,drift:report.drift,providerHttpErrors:report.providerHttpErrors}));
}
