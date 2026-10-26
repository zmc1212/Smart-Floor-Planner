import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { businessReviewTools } from '@/lib/assistant/agent/review-tools';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { requirementItems, requirementSources } from '@/lib/assistant/requirements/items';
import { reviewBudget, reviewTokens as tokens } from './assistant-review-budget';
import { reviewCheckpointer } from '@/lib/assistant/core/review-graph';
import type { ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

// Existing separately pinned model adapter has a CommonJS boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
const root=path.resolve(process.cwd(),'..'),load=createRequire(path.join(root,'scripts/agent-comparison/package.json'));
createRequire(path.join(root,'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(),true);
process.env.LANGCHAIN_TRACING_V2='false';process.env.LANGSMITH_TRACING='false';
const config='tmp/xiaok-intelligent-consult/.env.qwen37',dbConfig='tmp/xiaok-vector/connection.private.json';
const env=Object.fromEntries(fs.readFileSync(path.join(root,config),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)
  .filter(s=>s.trim()&&!s.trim().startsWith('#')).map(s=>{const n=s.indexOf('=');return[s.slice(0,n).trim(),s.slice(n+1).trim().replace(/^(['"])(.*)\1$/,'$2')];}));
const database=JSON.parse(fs.readFileSync(path.join(root,dbConfig),'utf8').replace(/^\uFEFF/,'' )).DATABASE_URL,url=new URL(database);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/xiaok_embedding_eval');process.env.DATABASE_URL=database;
const provider=new URL(env.DASHSCOPE_BASE_URL);assert.equal(provider.origin,'https://dashscope.aliyuncs.com');assert.equal(provider.pathname.replace(/\/$/,''),'/compatible-mode/v1');assert.equal(env.DASHSCOPE_MODEL,'qwen3.7-flash');
const budget=reviewBudget(root),scope=budget.scope,beforeTokens=budget.usedTokens,beforeMicros=budget.usedMicros,beforeBatch=budget.legacyBatchTokens;
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const callCap=8192,fixedCap=4*callCap;budget.assertReservation(0,fixedCap);
const source='tmp/agent-contract/trial-2026-10-25T06-01-28-936Z.json',trace=JSON.parse(fs.readFileSync(path.join(root,source),'utf8'));
const output=path.join(root,'tmp/agent-contract',`trial-requirement-plan-os08-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
const mode=process.argv.includes('--live')?'live':'preflight';
if(mode==='live')assert.ok(!fs.readdirSync(path.join(root,'tmp/agent-contract')).filter(f=>/^trial-requirement-plan-os08-.*\.json$/.test(f))
  .some(f=>{const saved=JSON.parse(fs.readFileSync(path.join(root,'tmp/agent-contract',f),'utf8'));return saved.mode==='live'&&saved.mechanism==='retention-partition-1'&&saved.calls?.length>0;}),
  'OS-CONTRACT-08 retention-partition-1 fixed trial is closed; reuse saved failures. A third prompt/schema sampling loop is not authorized.');
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','admin/src/lib/assistant','admin/src/db','admin/src/lib/postgresql.ts','admin/scripts/requirement-review-model-acceptance.ts','admin/scripts/assistant-review-budget.ts','admin/scripts/__tests__/assistant-review-budget.test.ts','admin/scripts/assistant-acceptance-safety.mjs','admin/package.json','admin/package-lock.json','scripts/agent-comparison'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
files.push(config,dbConfig,source);
function runtime(dir:string){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())runtime(p);else if(/\.(?:c?js|mjs|json|d\.ts)$/.test(e.name))files.push(p);}}
for(const p of ['admin/node_modules/@langchain/core','admin/node_modules/@langchain/langgraph','admin/node_modules/@langchain/langgraph-checkpoint-postgres','admin/node_modules/zod','scripts/agent-comparison/node_modules/@langchain/openai','scripts/agent-comparison/node_modules/@langchain/core'])runtime(p);
const bind=()=>Object.fromEntries([...new Set(files)].sort().map(p=>[p,hash(fs.readFileSync(path.resolve(root,p)))]));
const report:Row={delivery:'OS-CONTRACT-08',mechanism:'retention-partition-1',mode,source,sourceHash:hash(fs.readFileSync(path.join(root,source))),sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),
  scope:'Exactly two saved mixed budget/tile and two explicit budget-restoration first-draft requirement proposals; one model request per trial; informational-answer branch is ungraded; no repair/judge/automatic execution or full-scenario pass',
  approval:scope.userApproval,model:env.DASHSCOPE_MODEL,callCap,fixedCap,beforeTokens,beforeBatch,beforeMicros,calls:[],cases:[],preflight:[],fixtures:[],before:bind(),passed:false,cleaned:false,actualBilledYuan:null};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
type Fixture={enterpriseId:string;userId:string;conversationId:string;actor:ActorContext};
const fixtures:Fixture[]=[];let release:(()=>Promise<void>)|undefined,active='',unknown=false,prepare=false;
const rawFetch=globalThis.fetch;
async function accountedFetch(input:RequestInfo|URL,init?:RequestInit){
  const target=new URL(input instanceof Request?input.url:String(input));assert.equal(target.origin,provider.origin);assert.equal(target.pathname,'/compatible-mode/v1/chat/completions');assert.equal(init?.method,'POST');assert.equal(typeof init?.body,'string');
  const body=JSON.parse(String(init!.body)),max=Number(body.max_tokens??body.max_completion_tokens);assert.equal(max,512);assert.equal(body.stream,false);assert.equal(body.enable_thinking,false);
  const reserve=Buffer.byteLength(String(init!.body),'utf8')+max+128;assert.ok(reserve<=callCap,`Actual serialized request exceeds fixed per-call cap: ${reserve}`);
  if(prepare){report.preflight.push({case:active,request:body,reservedTokens:reserve});throw Error('prepared_without_dispatch');}
  assert.equal(mode,'live');assert.ok(!unknown&&report.calls.length<4);
  const used=tokens(report.calls);budget.assertReservation(used,reserve);
  const attempt:Row={id:randomUUID(),case:active,engine:'LangChain ChatOpenAI + native typed tools',kind:'action_proposal',request:body,reservedTokens:reserve,status:'dispatching',started:new Date().toISOString()};report.calls.push(attempt);save();
  try {
    const response=await rawFetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(90000)}),data=await response.clone().json();
    attempt.response=data;attempt.httpStatus=response.status;
    if(!response.ok||!Number.isSafeInteger(data.usage?.total_tokens)||data.usage.total_tokens<0)throw Error('provider_outcome_unknown');
    attempt.status='succeeded';attempt.usage=data.usage;return response;
  }catch(e){attempt.status='unknown';unknown=true;attempt.error=String((e as Error).message);throw e;}
  finally{attempt.finished=new Date().toISOString();save();}
}
const {ChatOpenAI}=load('@langchain/openai'),{HumanMessage,SystemMessage}=load('@langchain/core/messages');
const model=new ChatOpenAI({apiKey:env.DASHSCOPE_API_KEY,model:env.DASHSCOPE_MODEL,temperature:0,maxTokens:512,maxRetries:0,timeout:90000,streaming:false,modelKwargs:{enable_thinking:false},configuration:{baseURL:provider.toString().replace(/\/$/,''),fetch:accountedFetch,maxRetries:0}});
async function append(f:Fixture,text:string){await withPlatformTransaction(async tx=>{
  await appendMessage(tx,f.actor,f.conversationId,{author:'user',clientMessageId:randomUUID(),content:{version:1,blocks:[{type:'text',text}]}});
});}
async function fixture(original:Row):Promise<Fixture>{
  const code='synthetic-review-model-'+randomUUID(),base=await withPlatformTransaction(async tx=>{
    const enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 配置模型类型提案',${code},'active') returning id`))!.id),userId=String((await one(tx,sql`insert into app.users(nickname,context_version) values('测试专用提案业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config) values(${enterpriseId},true,100,200000,1000000,30,'{"runtime":"synthetic-model-proposal","model":"none"}'::jsonb)`);return{enterpriseId,userId};
  });
  const actor:ActorContext={enterpriseId:base.enterpriseId,principal:{kind:'user',userId:base.userId},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'direct'}},f={...base,actor,conversationId:String((await new ConversationService(actor).create(randomUUID())).id)};
  fixtures.push(f);report.fixtures.push({...base,conversationId:f.conversationId});
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot||'{"requirementReviewMode":true,"requirementWorkflow":"langgraph"}'::jsonb where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`));
  const old=original,messages=old.context.customerMessages,mapping=new Map<string,string>(),req=new RequirementWorkflow(actor);
  for(const m of messages.slice(0,-1)){await append(f,m.text);const e=await req.requirements.customerEvidence(f.conversationId);mapping.set(m.id,e.messages.at(-1)!.id);}
  const e=await req.requirements.customerEvidence(f.conversationId),sources=requirementSources(e.messages),items=requirementItems(messages,old.before.requirements.latest.draftFields);
  const p=await req.propose(f.conversationId,randomUUID(),{sourceSeq:e.sourceSeq,baseSummaryId:null,changes:items.map(i=>{const s=sources.filter(s=>s.sourceMessageId===mapping.get(i.sourceMessageId)&&s.text===i.text);assert.equal(s.length,1);return{operation:'add',field:i.field,sourceId:s[0].id};})});assert.equal(p.kind,'proposal');if(p.kind!=='proposal')throw Error('seed_proposal');
  await req.write(f.conversationId,randomUUID(),{action:'apply_proposal',proposalId:p.proposal.id,digest:p.proposal.digest,consent:true});return f;
}
async function run(){
  save();try{
    release=await lockAssistantAcceptance(database);
    for(let trial=1;trial<=2;trial++)for(const action of ['mixed','reversal']){
      active=action+'.'+trial;const original=trace.cases.find((c:Row)=>c.id==='createAgent.1.'+action),text=original.context.customerMessages.at(-1).text,f=await fixture(original),cid=f.conversationId,req=new RequirementWorkflow(f.actor);
      const business=async()=>{const r=await req.requirements.read(cid);return{latest:r.latest,confirmed:r.confirmed};},saved=await business();
      await append(f,text);const tools=await businessReviewTools(f.actor,cid),bound=model.bindTools([tools.proposeRequirements],{tool_choice:'auto'});
      const messages=[new SystemMessage('You are XiaoK. Propose only requested changes to saved requirement items. Use the real customer clause and saved item IDs in context; preserve every unrequested item. Tools only propose; customer approval saves a draft and formal confirmation is separate. Do not claim an unperformed write. Context: '+JSON.stringify(tools.context)),new HumanMessage(text)];
      const row:Row={id:active,originalCase:original.id,userText:text,evaluatedBranch:'requirement_changes_only',informationalAnswer:'not_evaluated',originalFullScenarioPass:false,passed:false};report.cases.push(row);save();
      const preparedBefore=report.preflight.length,callsBefore=report.calls.length;
      prepare=true;try{await bound.invoke(messages);}catch{/* SDK wraps the local interceptor. */}finally{prepare=false;}
      assert.equal(report.preflight.length,preparedBefore+1);assert.equal(report.calls.length,callsBefore);
      if(mode!=='live'){row.prepared=true;continue;}
      try{
        const result=await bound.invoke(messages);row.firstDraft={toolCalls:result.tool_calls,invalidToolCalls:result.invalid_tool_calls,content:result.content};save();
        assert.equal((result.invalid_tool_calls||[]).length,0);assert.equal(result.tool_calls?.length,1);const call=result.tool_calls[0];assert.equal(call.name,tools.proposeRequirements.name);
        const proposed:Row=await tools.proposeRequirements.invoke(call.args);row.proposal=proposed;assert.equal(proposed.kind,'proposal');assert.deepEqual(await business(),saved);
        const p=proposed.proposal,fields=p.summary.draftFields,base=saved.latest!.draftFields as Row;
        for(const key of ['housing','devices'])assert.deepEqual(fields[key],base[key],`Untouched ${key} changed`);
        if(action==='mixed'){assert.match(fields.budget.text,/10万/);assert.match(fields.room.text,/瓷砖/);assert.doesNotMatch(fields.room.text,/木地板/);}
        else{assert.match(fields.budget.text,/12万/);assert.deepEqual(fields.room,base.room,'Unrequested tile requirement changed');}
        const accept={action:'apply_proposal',proposalId:p.id,digest:p.digest,consent:true,restoreConsent:p.requiresRestoreConsent===true};
        row.requiresRestoreConsent=accept.restoreConsent;
        if(accept.restoreConsent){await assert.rejects(()=>req.write(cid,randomUUID(),{...accept,restoreConsent:false}),/requirements_restore_confirmation_required/);assert.deepEqual(await business(),saved);row.restorationWithoutExtraConsentRejected=true;}
        const key=randomUUID(),receipt=await req.write(cid,key,accept);row.receipt=receipt;assert.equal(receipt.status,'draft');assert.equal(receipt.confirmedFields,null);assert.equal(receipt.receipt!.effect,'draft_saved');
        const repeated=await req.write(cid,key,accept);assert.equal(repeated.id,receipt.id);
        const reentered=await req.read(cid);assert.equal(reentered.latest!.id,receipt.id);assert.equal(reentered.confirmed,null);assert.deepEqual(reentered.latest!.draftFields,fields);
        const count=await withPlatformTransaction(tx=>one(tx,sql`select count(*)::int n from app.assistant_requirement_summaries where enterprise_id=${f.enterpriseId} and conversation_id=${cid}`));assert.equal(count!.n,2);
        const fresh=await businessReviewTools(f.actor,cid),ack=await fresh.proposeRequirements.invoke({retainedIds:fresh.context.savedItems.map(i=>i.id),changes:[]});assert.equal(ack.kind,'existing');assert.equal(ack.summary.id,receipt.id);row.existingDraftIdempotent=true;row.passed=true;
      }catch(e){row.error=String((e as Error).message);if(unknown)throw e;}finally{save();}
    }
    report.passed=mode==='live'&&report.cases.length===4&&report.cases.every((c:Row)=>c.passed);
    if(mode==='live'&&!report.passed)process.exitCode=1;
  }catch(e){report.error=String((e as Error).stack||e);process.exitCode=1;}
  finally{
    try {
    try { for(const f of fixtures){
      for(const kind of ['handoff-review:','requirement-proposal:']){
        const records=await withPlatformTransaction(tx=>rows(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${f.enterpriseId} and operation=${kind+f.conversationId}`));
        for(const r of records){const pid=(r.result as Row).proposalId;if(pid)await reviewCheckpointer().deleteThread(`${kind==='handoff-review:'?'handoff':'requirements'}:${f.enterpriseId}:${f.conversationId}:${pid}`);}
      }
      await withPlatformTransaction(async tx=>{const audit=await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f.enterpriseId}`);assert.equal(audit!.n,0);await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);});
    } report.cleaned=true;
    } catch(e) {report.cleanupError=String((e as Error).message);report.passed=false;process.exitCode=1;}
    report.after=bind();report.drift=Object.keys(report.before).filter(k=>report.before[k]!==report.after[k]);if(report.drift.length){report.passed=false;process.exitCode=1;}
    report.newTokens=tokens(report.calls);report.cumulativeTokens=beforeTokens+report.newTokens;report.legacyBatchTokens=beforeBatch+report.newTokens;report.upperMicros=beforeMicros+report.newTokens*5;report.unknown=unknown;
    report.preflightPassed=report.cases.length===4&&report.preflight.length===4;
    save();console.log(JSON.stringify({output:path.relative(root,output),mode,passed:report.passed,preflightPassed:report.preflightPassed,cases:report.cases.map((r:Row)=>({id:r.id,passed:r.passed,error:r.error})),calls:report.calls.length,newTokens:report.newTokens,cumulativeTokens:report.cumulativeTokens,legacyBatchTokens:report.legacyBatchTokens,upperMicros:report.upperMicros,error:report.error,drift:report.drift,cleaned:report.cleaned}));
    } finally {try{if(release)await release();}finally{await closePostgresPool();}}
  }
}
void run().catch(e=>{console.error(String((e as Error).message));process.exitCode=1;});
