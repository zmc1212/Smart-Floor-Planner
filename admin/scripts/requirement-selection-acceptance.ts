import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService, appendMessage } from '@/lib/assistant/core/conversation';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { requirementItems, requirementSources } from '@/lib/assistant/requirements/items';
import type { DraftRequirements } from '@/lib/assistant/requirements/contract';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { replaySelectionCase, selectionOriginal, selectionTrace } from './requirement-selection-fixtures';

// Saved provider requests and evidence contain heterogeneous historical shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const root=path.resolve(process.cwd(),'..');
createRequire(path.join(root,'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(),true);
process.env.DATABASE_URL=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/, '')).DATABASE_URL;
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','admin/src/lib/assistant','admin/src/db','admin/src/lib/postgresql.ts','admin/scripts/requirement-selection*','admin/scripts/assistant-acceptance-safety.mjs','admin/package.json','admin/package-lock.json'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
files.push(selectionOriginal,selectionTrace,'tmp/xiaok-vector/connection.private.json');
for(const pkg of ['@langchain/langgraph','@langchain/langgraph-checkpoint','@langchain/langgraph-checkpoint-postgres']) {
  for(const f of fs.readdirSync(path.join(root,'admin/node_modules',pkg,'dist'),{recursive:true})) if(typeof f==='string'&&/\.(cjs|js)$/.test(f))files.push(`admin/node_modules/${pkg}/dist/${f}`);
}
const binding=()=>Object.fromEntries(files.sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const output=path.join(root,'tmp/agent-selection',`services-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
const report:Row={delivery:'OS-CONTRACT-09',scope:'saved wrong proposals; customer-selected application; no model rescoring',checks:[],replays:[],fixtures:[],modelCalls:0,passed:false,cleaned:false};
const fixtures:{actor:ActorContext;cid:string;owned:string[]}[]=[];
let release:(()=>Promise<void>)|undefined;
const check=(name:string)=>report.checks.push(name);

async function fixture(trial:1|2) {
  const code='synthetic-review-selection-'+randomUUID();
  const base=await withPlatformTransaction(async tx=>{
    const enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 客户选择需求',${code},'active') returning id`))!.id);
    const userId=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${code},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${enterpriseId},true,100,200000,1000000,30)`);
    return {enterpriseId,userId};
  });
  const actor:ActorContext={enterpriseId:base.enterpriseId,principal:{kind:'user',userId:base.userId},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'direct'}};
  const cid=String((await new ConversationService(actor).create(randomUUID())).id),owned:string[]=[];
  fixtures.push({actor,cid,owned}); report.fixtures.push({...base,conversationId:cid});
  const replay=await replaySelectionCase(root,actor,cid,trial,id=>owned.push(id)); report.replays.push(replay.binding);
  const w=new RequirementWorkflow(actor);
  const count=async()=>Number((await withTenantTransaction(base.enterpriseId,tx=>one(tx,sql`select count(*)::int n from app.assistant_requirement_summaries where enterprise_id=${base.enterpriseId} and conversation_id=${cid}`)))!.n);
  const body={action:'apply_proposal',proposalId:replay.proposal.id,digest:replay.proposal.digest,consent:true,restoreConsent:false,selectedFields:['budget']};
  return {actor,cid,owned,w,count,body,...replay};
}
async function run(){
  report.before=binding();
  try{
    release=await lockAssistantAcceptance(process.env.DATABASE_URL!);
    for(const trial of [1,2] as const){
      const f=await fixture(trial),{actor,cid,w,body}=f;
      assert.equal(await f.count(),1);check(`wrong${trial}:stagingDoesNotWriteAcceptedDraft`);
      for(const selectedFields of [[],['budget','budget'],['housing'],['unknown']])await assert.rejects(()=>w.write(cid,randomUUID(),{...body,selectedFields}),/invalid_requirement_selection/);
      assert.equal(await f.count(),1);check(`wrong${trial}:invalidAndUnchangedSelectionsCannotConsumeApproval`);
      const key=randomUUID();
      if(trial===1){
        await assert.rejects(()=>new RequirementWorkflow(actor,{afterWrite:async()=>{throw Error('synthetic-after-commit');}}).write(cid,key,body),/synthetic-after-commit/);
        assert.equal(await f.count(),2);
        await assert.rejects(()=>w.write(cid,randomUUID(),{...body,selectedFields:['room']}),/idempotency_conflict/);check('changedSelectionRejectedAfterCommitBeforeCheckpoint');
        const child=cp.spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--tsconfig','tsconfig.json','scripts/requirement-selection-acceptance.ts','--resume'],{cwd:path.join(root,'admin'),encoding:'utf8',input:JSON.stringify({actor,cid,key,body}),windowsHide:true,maxBuffer:1024*1024});
        assert.equal(child.status,0,child.stderr);const resumed=JSON.parse(child.stdout.trim().split('\n').at(-1)!);assert.notEqual(resumed.process,process.pid);check('independentProcessRestoresOriginalSelectedBodyAfterCommit');
      }
      const saved=await w.write(cid,key,body), fields=saved.draftFields as DraftRequirements,base=f.baseline.draftFields as DraftRequirements;
      assert.match(fields.budget.text,/12万/);for(const k of ['room','devices','housing'] as const)assert.deepEqual(fields[k],base[k]);
      assert.equal(saved.status,'draft');assert.equal(saved.confirmedFields,null);assert.equal(saved.receipt?.effect,'draft_saved');check(`wrong${trial}:budgetOnlySaveKeepsExactTileNegativeHeatAreaAndReceipt`);
      const duplicate=await w.write(cid,randomUUID(),body);assert.equal(duplicate.id,saved.id);assert.equal(await f.count(),2);check(`wrong${trial}:sameAndDifferentKeyRetriesWriteOnce`);
      await assert.rejects(()=>w.write(cid,randomUUID(),{...body,selectedFields:['budget','room']}),/idempotency_conflict/);
      await assert.rejects(()=>w.requirements.write(cid,randomUUID(),{...body,selectedFields:['room']}),/idempotency_conflict/);check(`wrong${trial}:changedSelectionCannotReplayThroughGraphOrService`);
      for(const bad of [{...actor,enterpriseId:'1'},{...actor,contextVersion:0},{...actor,principal:{kind:'user' as const,userId:'1'}}]) await assert.rejects(()=>new RequirementWorkflow(bad).write(cid,randomUUID(),body));
      check(`wrong${trial}:tenantCustomerAndIdentityRevalidated`);
    }
    const f=await fixture(2),{actor,cid,w}=f;
    await withTenantTransaction(actor.enterpriseId,tx=>appendMessage(tx,actor,cid,{author:'user',clientMessageId:randomUUID(),content:{version:1,blocks:[{type:'text',text:'预算改为11万，客厅保留瓷砖。'}]}}));
    const evidence=await w.requirements.customerEvidence(cid),items=requirementItems(evidence.messages,f.baseline.draftFields),sources=requirementSources(evidence.messages);
    const stage=async(changes:Row[])=>{
      const r=await w.requirements.read(cid);const p=await w.propose(cid,randomUUID(),{sourceSeq:evidence.sourceSeq,baseSummaryId:r.latest!.id,changes});
      assert.equal(p.kind,'proposal');if(p.kind!=='proposal')throw Error('proposal_expected');f.owned.push(String(p.proposal.id));return p.proposal;
    };
    const proposal=await stage([{operation:'replace',targetId:items.find(i=>i.field==='budget')!.id,sourceId:sources.find(s=>s.text==='预算改为11万')!.id},
      {operation:'replace',targetId:items.find(i=>i.field==='room')!.id,sourceId:sources.find(s=>s.text==='客厅想铺木地板')!.id}]);
    assert.equal(proposal.requiresRestoreConsent,true);
    const body={action:'apply_proposal',proposalId:proposal.id,digest:proposal.digest,consent:true,selectedFields:['budget']};
    const budget=await w.write(cid,randomUUID(),body);assert.match((budget.draftFields as DraftRequirements).budget.text,/11万/);assert.deepEqual((budget.draftFields as DraftRequirements).room,(f.baseline.draftFields as DraftRequirements).room);check('unselectedHistoricalRoomDoesNotRequireConsentOrWrite');
    const restore=await stage([{operation:'replace',targetId:items.find(i=>i.field==='room')!.id,sourceId:sources.find(s=>s.text==='客厅想铺木地板')!.id}]);
    const restoreBody={...body,proposalId:restore.id,digest:restore.digest,selectedFields:['room']};
    await assert.rejects(()=>w.write(cid,randomUUID(),restoreBody),/requirements_restore_confirmation_required/);assert.equal(await f.count(),2);
    const key=randomUUID(),restored=await w.write(cid,key,{...restoreBody,restoreConsent:true});assert.match((restored.draftFields as DraftRequirements).room.text,/木地板/);check('selectedHistoricalRoomNeedsExplicitConsentBeforeWrite');
    const displayed=await w.read(cid);await w.write(cid,randomUUID(),{action:'confirm',draftId:restored.id,expectedVersion:restored.version,consent:true,reviewedSourceSeq:displayed.sourceSeq,fields:Object.fromEntries(Object.entries(restored.draftFields as DraftRequirements).map(([k,v])=>[k,v.text]))});
    assert.equal((await w.write(cid,key,{...restoreBody,restoreConsent:true})).receipt?.effect,'requirements_confirmed');check('laterFormalConfirmationProjectsRealReceipt');
    for(const boundary of ['version','source','epoch']){
      const g=await fixture(1);
      await withPlatformTransaction(async tx=>{
        if(boundary==='version')await tx.execute(sql`update app.assistant_requirement_summaries set version=version+1 where enterprise_id=${g.actor.enterpriseId} and id=${g.baseline.id}`);
        if(boundary==='epoch')await tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${g.actor.enterpriseId}`);
        if(boundary==='source')await tx.execute(sql`update app.assistant_messages set content='{"version":1,"blocks":[{"type":"text","text":"来源已撤回"}]}'::jsonb where enterprise_id=${g.actor.enterpriseId} and conversation_id=${g.cid} and id=${g.evidence.messages.at(-1)!.id}`);
      });
      await assert.rejects(()=>g.w.write(g.cid,randomUUID(),g.body),/requirement_target_changed|requirements_stale/);assert.equal(await g.count(),1);check(`${boundary}RevocationBlocksSelectedApproval`);
    }
    const legacy=await fixture(1),legacyItems=requirementItems(legacy.evidence.messages,legacy.baseline.draftFields);
    const p=await legacy.w.propose(legacy.cid,randomUUID(),{sourceSeq:legacy.evidence.sourceSeq,baseSummaryId:legacy.baseline.id,changes:[{
      operation:'replace',targetId:legacyItems.find(i=>i.field==='budget')!.id,sourceId:requirementSources(legacy.evidence.messages).find(s=>s.text==='预算还是按12万')!.id,
    }]});assert.equal(p.kind,'proposal');if(p.kind!=='proposal')throw Error('legacy_proposal');legacy.owned.push(String(p.proposal.id));
    const originalBody={action:'apply_proposal',proposalId:p.proposal.id,digest:p.proposal.digest,consent:true},legacyKey=randomUUID();
    const old=await legacy.w.requirements.write(legacy.cid,legacyKey,originalBody);
    const record=await withPlatformTransaction(tx=>one(tx,sql`select request_hash from app.assistant_idempotency_records where enterprise_id=${legacy.actor.enterpriseId} and operation=${'requirements:'+legacy.cid} and key=${legacyKey}`));
    assert.equal(record!.request_hash,fingerprint(originalBody));assert.equal((await legacy.w.requirements.write(legacy.cid,legacyKey,originalBody)).id,old.id);assert.equal(await legacy.count(),2);check('legacyOmittedRestoreConsentPreservesOriginalHashAndSameKeyReplay');
    for(const f of fixtures){
      const runtime=await withPlatformTransaction(async tx=>({attempts:await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f.actor.enterpriseId}`),jobs:await one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${f.actor.enterpriseId} and status in ('queued','running')`)}));
      assert.equal(runtime.attempts!.n,0);assert.equal(runtime.jobs!.n,0);
      const checkpoints=await withPlatformTransaction(tx=>rows(tx,sql`select checkpoint from assistant_requirement_workflow.checkpoints where thread_id like ${`requirements:${f.actor.enterpriseId}:${f.cid}:%`}`));
      assert.doesNotMatch(JSON.stringify(checkpoints),/预算|瓷砖|地暖|selectedFields|customerClauses/);
    }check('realZeroProviderJobsAndOpaqueCheckpointContent');report.passed=true;
  }catch(e){report.error=e instanceof Error?e.stack:String(e);process.exitCode=1;}
  finally{
    try{for(const f of fixtures){for(const id of f.owned)await new RequirementWorkflow(f.actor).forget(f.cid,id);
      await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.actor.enterpriseId}`);await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.actor.principal.kind==='user'?f.actor.principal.userId:'0'}`);});}report.cleaned=true;}
    catch(e){report.cleanupError=String(e);report.passed=false;process.exitCode=1;}
    if(release)await release();report.after=binding();report.drift=Object.keys(report.before).filter(k=>report.before[k]!==report.after[k]);if(report.drift.length){report.passed=false;process.exitCode=1;}
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await closePostgresPool();console.log(JSON.stringify({output:path.relative(root,output),passed:report.passed,checks:report.checks.length,error:report.error,cleaned:report.cleaned,drift:report.drift,modelCalls:0}));
  }
}
if(process.argv.includes('--resume'))void(async()=>{
  try{const x=JSON.parse(fs.readFileSync(0,'utf8'));const e=await withPlatformTransaction(tx=>one(tx,sql`select code from app.enterprises where id=${x.actor.enterpriseId}`));assert.match(String(e?.code),/^synthetic-review-selection-/);const result=await new RequirementWorkflow(x.actor).write(x.cid,x.key,x.body);console.log(JSON.stringify({id:result.id,process:process.pid}));}finally{await closePostgresPool();}
})().catch(()=>{process.exitCode=1;});else void run();
