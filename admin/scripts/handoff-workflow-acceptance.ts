import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { reviewCheckpointer } from '@/lib/assistant/core/review-graph';
import { requirementItems, requirementSources } from '@/lib/assistant/requirements/items';
import { businessReviewTools } from '@/lib/assistant/agent/review-tools';
import type { ActorContext } from '@/lib/assistant/contracts';
import { append } from './agent-comparison';

const root=path.resolve(process.cwd(),'..');
createRequire(path.join(root,'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(),true);
const database=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,'')).DATABASE_URL;
const url=new URL(database);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/xiaok_embedding_eval');
process.env.DATABASE_URL=database;
const source='tmp/agent-contract/trial-2026-10-25T06-01-28-936Z.json';
const trace=JSON.parse(fs.readFileSync(path.join(root,source),'utf8'));
const out=path.join(root,'tmp/agent-review-next',`services-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);fs.mkdirSync(path.dirname(out),{recursive:true});
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','admin/src/lib/assistant','admin/src/db','admin/src/lib/postgresql.ts','admin/package.json','admin/package-lock.json','admin/scripts/handoff-workflow-acceptance.ts','admin/scripts/agent-comparison*'],{cwd:root,windowsHide:true,encoding:'utf8'}).split('\0').filter(Boolean);
files.push(source,'tmp/xiaok-vector/connection.private.json');
const bind=()=>Object.fromEntries([...new Set(files)].sort().map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
type Fixture={enterpriseId:string;userId:string;conversationId:string;actor:ActorContext};
let fixture:Fixture|undefined,other:Fixture|undefined;
const report={source,sourceHash:createHash('sha256').update(fs.readFileSync(path.join(root,source))).digest('hex'),scope:'OS-CONTRACT-06 saved createAgent contact/cancel first drafts; native LangChain tools and LangGraph approval; no new model sampling',
  before:bind(),after:{} as Record<string,string>,drift:[] as string[],checks:[] as string[],replay:[] as unknown[],passed:false,cleaned:false,modelCalls:0,error:''};
const check=(name:string)=>report.checks.push(name);
async function createFixture():Promise<Fixture> {
  const code='synthetic-handoff-review-'+randomUUID();
  const base=await withPlatformTransaction(async tx=>{
    const enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 接待审批恢复',${code},'active') returning id`))!.id);
    const userId=String((await one(tx,sql`insert into app.users(nickname,context_version) values('测试专用接待业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config) values(${enterpriseId},true,100,200000,1000000,30,'{"runtime":"synthetic-handoff-review","model":"none","tools":false}'::jsonb)`);
    return {enterpriseId,userId};
  });
  const actor:ActorContext={enterpriseId:base.enterpriseId,principal:{kind:'user',userId:base.userId},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'direct'}};
  const conversationId=String((await new ConversationService(actor).create(randomUUID())).id);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"requirementReviewMode":true,"requirementWorkflow":"langgraph"}'::jsonb where enterprise_id=${base.enterpriseId} and id=${conversationId}`));
  return {...base,actor,conversationId};
}
async function main() {
  fixture=await createFixture();other=await createFixture();const f=fixture,cid=f.conversationId;
  const conversation=new ConversationService(f.actor),handoff=new HandoffWorkflow(f.actor),requirements=new RequirementWorkflow(f.actor);
  const originalContact=trace.cases.find((c:{id:string})=>c.id==='createAgent.1.contact');
  const contactDraft=trace.submissions.find((s:{case:string;firstDraft:boolean})=>s.case===originalContact.id&&s.firstDraft).args;
  const originalCancel=trace.cases.find((c:{id:string})=>c.id==='createAgent.1.cancel');
  const cancelDraft=trace.submissions.find((s:{case:string;firstDraft:boolean})=>s.case===originalCancel.id&&s.firstDraft).args;
  const oldMessages=originalContact.context.customerMessages as {id:string;text:string}[],mapping=new Map<string,string>();
  const contactText=oldMessages.at(-1)!.text;
  for(const m of oldMessages.slice(0,-1)){await append(f,m.text);const e=await requirements.requirements.customerEvidence(cid);mapping.set(m.id,e.messages.at(-1)!.id);}
  const evidence=await requirements.requirements.customerEvidence(cid),catalog=requirementSources(evidence.messages);
  const oldItems=requirementItems(oldMessages,originalContact.before.requirements.latest.draftFields);
  const seed=await requirements.propose(cid,randomUUID(),{sourceSeq:evidence.sourceSeq,baseSummaryId:null,changes:oldItems.map(item=>{
    const matches=catalog.filter(c=>c.sourceMessageId===mapping.get(item.sourceMessageId)&&c.text===item.text);assert.equal(matches.length,1);
    return {operation:'add',field:item.field,sourceId:matches[0].id};
  })});assert.equal(seed.kind,'proposal');if(seed.kind!=='proposal')throw Error('seed_proposal');
  await requirements.write(cid,randomUUID(),{action:'apply_proposal',proposalId:seed.proposal.id,digest:seed.proposal.digest,consent:true});
  const savedBefore=await requirements.requirements.read(cid);
  const business=async()=>{const r=await requirements.requirements.read(cid);return {latest:r.latest,confirmed:r.confirmed};};
  const expectUnchanged=async()=>assert.deepEqual(await business(),{latest:savedBefore.latest,confirmed:savedBefore.confirmed});
  const textContent=(text:string)=>({version:1,blocks:[{type:'text',text}]});
  // Preserve the original compound contact/phone-refusal wording. Its language
  // interpretation needs the configured model; replay the saved proposal here.
  await append(f,contactText);assert.equal((await handoff.customerRead(cid)).handoff,null);
  check('savedContactTextAloneHasNoReceptionEffectAndModelSemanticsRemainUnverified');
  const naturalKey=randomUUID(),otherConversation=new ConversationService(other.actor),naturalContent=textContent('请设计师接着聊');
  assert.equal((await otherConversation.send(other.conversationId,naturalKey,naturalContent)).runId,null);
  assert.equal((await new HandoffWorkflow(other.actor).customerRead(other.conversationId)).handoff,null);
  check('existingExplicitContactShortcutOnlyProposesAndCreatesNoReceptionOrModelRun');
  assert.equal((await otherConversation.send(other.conversationId,naturalKey,naturalContent)).runId,null);check('naturalProposalMessageReplayDoesNotInventAnAiRun');
  const tools=await businessReviewTools(f.actor,cid);
  await assert.rejects(()=>tools.requestDesigner.invoke(JSON.parse('{"consent":true,"phone":"13800000000"}')));check('LangChainToolRejectsModelSuppliedConsentAndPhone');
  await assert.rejects(()=>tools.proposeRequirements.invoke({retainedIds:tools.context.savedItems.map(i=>i.id),changes:[{operation:'add',field:'budget',sourceId:'k-company-reference'}]}));check('typedCustomerSourceEnumRejectsCompanyReference');
  const proposed=await tools.requestDesigner.invoke({});assert.equal(proposed.effect,'proposal');assert.equal((await handoff.customerRead(cid)).handoff,null);
  await assert.rejects(()=>new HandoffService(f.actor).customerWrite(cid,randomUUID(),{action:'request'}),/handoff_review_required/);
  check('legacyModelToolCannotBypassNativeCustomerApproval');
  report.replay.push({case:originalContact.id,original:contactDraft,tool:tools.requestDesigner.name,result:proposed,answer:'original prose/company citations retained but not executed or regraded'});check('savedContactActionIsIndependentOfInvalidCompanyAnswerReferences');
  const version=async()=>Number((await conversation.detail(cid)).version);
  const request={action:'request',expectedVersion:await version(),consent:true,mediaConsent:true,contactConsent:false,phone:''};
  const requestKey=randomUUID();await assert.rejects(()=>new HandoffWorkflow(f.actor,{afterPause:async()=>{throw Error('synthetic_paused_before_approval');}}).customerWrite(cid,requestKey,request),/synthetic_paused/);
  assert.equal((await handoff.customerRead(cid)).handoff,null);check('nativeInterruptPersistsBeforeAnyReceptionWrite');
  const child=(key:string,body:Record<string,unknown>)=>{
    const result=JSON.parse(cp.execFileSync(process.execPath,['--import','tsx','scripts/handoff-workflow-acceptance.ts','--resume-approved'],{cwd:path.join(root,'admin'),windowsHide:true,encoding:'utf8',timeout:60000,input:JSON.stringify({actor:f.actor,conversationId:cid,requestKey:key,body})}));
    assert.notEqual(result.processId,process.pid);report.replay.push({child:result.processId,parent:process.pid,receipt:result.data.receipt});return result.data;
  };
  const waiting=child(requestKey,request);assert.equal(waiting.handoff.state,'waiting');assert.equal(waiting.handoff.contactConsent,false);assert.equal(waiting.handoff.phone,'');check('independentProcessResumesWaitingWithoutBookingOrPhoneGrant');
  assert.match(waiting.receipt.text,/等待/);assert.doesNotMatch(waiting.receipt.text,/已安排|已预约/);await expectUnchanged();check('realWaitingReceiptPreservesExistingRequirements');
  await assert.rejects(()=>handoff.customerWrite(cid,requestKey,{...request,phone:'13800000000',contactConsent:true}),/idempotency_conflict/);check('originalApprovalBodyCannotBeChangedDuringRecovery');
  const existing=await handoff.customerWrite(cid,randomUUID(),{...request,expectedVersion:await version()});assert.equal(existing.handoff!.requestId,waiting.handoff.requestId);check('newRequestKeyReadsExistingReceptionWithoutDuplicate');
  await assert.rejects(()=>new HandoffWorkflow(other!.actor).customerWrite(cid,randomUUID(),request));check('differentTenantCannotReadOrResumePrimaryReception');
  const cancelText=(originalCancel.context.customerMessages as {text:string}[]).at(-1)!.text;
  const cancelSend=await conversation.send(cid,randomUUID(),textContent(cancelText));assert.equal(cancelSend.runId,null);
  const cancelTools=await businessReviewTools(f.actor,cid);const cancelProposal=await cancelTools.cancelDesigner.invoke({});assert.equal(cancelProposal.effect,'proposal');
  report.replay.push({case:originalCancel.id,original:cancelDraft,tool:cancelTools.cancelDesigner.name,result:cancelProposal,answer:'original false cancellation claim remains historical/unverified'});
  assert.equal((await handoff.customerRead(cid)).handoff!.state,'waiting');check('savedCancellationProposalDoesNotExecuteBeforeCustomerClick');
  const cancel={action:'cancel',expectedVersion:await version()},cancelKey=randomUUID();
  await assert.rejects(()=>new HandoffWorkflow(f.actor,{afterWrite:async()=>{throw Error('synthetic_cancel_committed_before_checkpoint');}}).customerWrite(cid,cancelKey,cancel),/synthetic_cancel_committed/);
  assert.equal((await handoff.customerRead(cid)).handoff!.state,'cancelled');check('lostCheckpointAfterRealCancellationRetainsActualBusinessEffect');
  const cancelled=child(cancelKey,cancel);assert.equal(cancelled.handoff.state,'cancelled');assert.equal(cancelled.mode,'ai');await expectUnchanged();check('independentProcessRecoversCancellationWithOriginalKeyAndKeepsRequirements');
  const replayRequest=await handoff.customerWrite(cid,requestKey,request);assert.equal(replayRequest.handoff!.state,'cancelled');check('oldRequestReplayReportsCurrentCancellationInsteadOfReopeningReception');
  const newRequest={...request,expectedVersion:await version()},newKey=randomUUID();const next=await handoff.customerWrite(cid,newKey,newRequest);
  assert.equal(next.handoff!.state,'waiting');assert.notEqual(next.handoff!.requestId,waiting.handoff.requestId);
  const oldCancel=await handoff.customerWrite(cid,cancelKey,cancel);assert.equal(oldCancel.handoff!.requestId,next.handoff!.requestId);assert.equal(oldCancel.handoff!.state,'waiting');check('oldCancelReplayCannotCancelANewerReception');
  await assert.rejects(()=>handoff.customerWrite(cid,randomUUID(),cancel),/version_conflict/);check('staleDisplayedVersionCannotCancelANewerReception');
  const pendingCancel={action:'cancel',expectedVersion:await version()},staleKey=randomUUID();
  await assert.rejects(()=>new HandoffWorkflow(f.actor,{afterPause:async()=>{throw Error('synthetic_pending_epoch');}}).customerWrite(cid,staleKey,pendingCancel),/synthetic_pending_epoch/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${f.enterpriseId}`));
  await assert.rejects(()=>handoff.customerWrite(cid,staleKey,pendingCancel),/context_changed/);assert.equal((await handoff.customerRead(cid)).handoff!.state,'waiting');check('sourceEpochChangeInvalidatesAStoredUnexecutedApproval');
  await withPlatformTransaction(tx=>tx.execute(sql`update app.users set context_version=2 where id=${f.userId}`));
  await assert.rejects(()=>handoff.customerRead(cid),/identity_context_invalid/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.users set context_version=1 where id=${f.userId}`));check('realIdentityRevocationPreventsCachedWorkflowReadback');
  const originalSource=await requirements.requirements.customerEvidence(cid),originalMessage=originalSource.messages[0];
  const originalContent=await withPlatformTransaction(tx=>one(tx,sql`select content from app.assistant_messages where enterprise_id=${f.enterpriseId} and id=${originalMessage.id}`));
  const guardedTools=await businessReviewTools(f.actor,cid);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_messages set content='{"blocks":[{"type":"text","text":"来源已撤回"}]}'::jsonb where enterprise_id=${f.enterpriseId} and id=${originalMessage.id}`));
  await assert.rejects(()=>guardedTools.proposeRequirements.invoke({retainedIds:guardedTools.context.savedItems.map(i=>i.id),changes:[]}),/context_changed/);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(originalContent!.content)}::jsonb where enterprise_id=${f.enterpriseId} and id=${originalMessage.id}`));check('typedToolCatalogCannotSilentlyReuseSameSequenceRevokedText');
  const final=await handoff.customerWrite(cid,randomUUID(),{action:'cancel',expectedVersion:await version()});assert.equal(final.handoff!.state,'cancelled');await expectUnchanged();
  const audit=await withPlatformTransaction(async tx=>({
    attempts:await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f.enterpriseId}`),
    jobs:await one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${f.enterpriseId} and status in ('queued','running')`),
    events:await rows(tx,sql`select payload->>'action' action,count(*)::int n from app.domain_event_outbox where enterprise_id=${f.enterpriseId} and type='assistant.handoff.customer.v1' group by payload->>'action'`),
  }));report.modelCalls=Number(audit.attempts!.n);assert.equal(report.modelCalls,0);assert.equal(audit.jobs!.n,0);
  assert.equal(audit.events.find(e=>e.action==='request')!.n,2);assert.equal(audit.events.find(e=>e.action==='cancel')!.n,2);check('realOutboxHasExactlyTwoRequestsTwoCancellationsAndZeroProviderAttempts');
  // A saved active state is not proof that its staff grant is still available.
  const prior=await withPlatformTransaction(tx=>one(tx,sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${f.enterpriseId} and id=${cid}`));
  const entry=prior!.entry_snapshot as Record<string,unknown>,oldHandoff=entry.handoff as Record<string,unknown>;
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_conversations set mode='human',version=version+1,entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${JSON.stringify({...oldHandoff,state:'active',ownerId:'999999999'})}::jsonb) where enterprise_id=${f.enterpriseId} and id=${cid}`));
  try {
    const unavailable=await handoff.customerWrite(cid,requestKey,request);
    assert.ok('receipt' in unavailable);
    assert.equal(unavailable.handoff!.ownerAvailable,false);assert.match(unavailable.receipt!.text,/暂不可用/);assert.doesNotMatch(unavailable.receipt!.text,/已接入|已接通/);
  } finally {
    await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_conversations set mode='ai',version=version+1,entry_snapshot=${JSON.stringify(entry)}::jsonb where enterprise_id=${f.enterpriseId} and id=${cid}`));
  }
  await expectUnchanged();check('replayedActiveReceiptRechecksActualStaffAvailability');
  const staleSummary=await businessReviewTools(f.actor,cid);
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_requirement_summaries set version=version+1 where enterprise_id=${f.enterpriseId} and id=${savedBefore.latest!.id}`));
  await assert.rejects(()=>staleSummary.proposeRequirements.invoke({retainedIds:staleSummary.context.savedItems.map(i=>i.id),changes:[]}),/requirement_target_changed/);
  check('sameSummaryIdVersionChangeInvalidatesCapturedToolPlan');
  report.passed=true;
}
async function run() {
  try{await main();}catch(e){report.error=e instanceof Error?e.stack || e.message:String(e);process.exitCode=1;}
  finally {
    for(const f of [fixture,other].filter(Boolean) as Fixture[]) {
      const operations=await withPlatformTransaction(tx=>rows(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${f.enterpriseId} and operation=${'handoff-review:'+f.conversationId}`));
      // Owned synthetic checkpoint cleanup must still work after a failed test
      // deliberately revokes this fixture's customer identity.
      for(const o of operations)await reviewCheckpointer().deleteThread(`handoff:${f.enterpriseId}:${f.conversationId}:${String((o.result as Record<string,unknown>).proposalId)}`);
      const proposal=await withPlatformTransaction(tx=>rows(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${f.enterpriseId} and operation=${'requirement-proposal:'+f.conversationId}`));
      for(const p of proposal)if((p.result as Record<string,unknown>).proposalId)await reviewCheckpointer().deleteThread(`requirements:${f.enterpriseId}:${f.conversationId}:${String((p.result as Record<string,unknown>).proposalId)}`);
      await withPlatformTransaction(async tx=>{
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${f.enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_runs set status='cancelled' where enterprise_id=${f.enterpriseId} and status in ('queued','running')`);
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.userId}`);
        const attempts=await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f.enterpriseId}`);
        report.modelCalls+=Number(attempts!.n);assert.equal(attempts!.n,0);
      });
    }
    report.cleaned=!!fixture;report.after=bind();report.drift=Object.keys(report.before).filter(k=>report.before[k]!==report.after[k]);if(report.drift.length){report.passed=false;process.exitCode=1;}
    fs.writeFileSync(out,JSON.stringify({...report,fixtures:[fixture,other].filter(Boolean).map(f=>({enterpriseId:f!.enterpriseId,userId:f!.userId,conversationId:f!.conversationId}))},null,2));await closePostgresPool();
    console.log(JSON.stringify({output:path.relative(root,out),checks:report.checks.length,passed:report.passed,error:report.error,drift:report.drift,cleaned:report.cleaned,modelCalls:report.modelCalls}));
  }
}
if(process.argv.includes('--resume-approved'))void(async()=>{try{
  const i=JSON.parse(fs.readFileSync(0,'utf8'));const label=await withPlatformTransaction(tx=>one(tx,sql`select code from app.enterprises where id=${String(i.actor.enterpriseId)}`));assert.match(String(label?.code),/^synthetic-handoff-review-/);
  const data=await new HandoffWorkflow(i.actor).customerWrite(i.conversationId,i.requestKey,i.body);console.log(JSON.stringify({data,processId:process.pid}));
}finally{await closePostgresPool();}})().catch(()=>{process.exitCode=1;});
else void run().catch(()=>{process.exitCode=1;});
