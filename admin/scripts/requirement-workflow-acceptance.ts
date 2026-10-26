import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { RequirementWorkflow, requirementCheckpointer, setupRequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { RequirementService } from '@/lib/assistant/requirements/service';
import { requirementItems } from '@/lib/assistant/requirements/items';
import type { DraftRequirements } from '@/lib/assistant/requirements/contract';
import type { ActorContext } from '@/lib/assistant/contracts';
import { append } from './agent-comparison';

const root = path.resolve(process.cwd(), '..');
createRequire(path.join(root, 'admin/package.json'))('@next/env').loadEnvConfig(process.cwd(), true);
const dbConfig = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const database = dbConfig.DATABASE_URL;
const url = new URL(database);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '55432' && url.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = database;
const original = 'tmp/agent-contract/trial-2026-10-25T06-01-28-936Z.json';
const trace = JSON.parse(fs.readFileSync(path.join(root, original), 'utf8'));
const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'scripts/agent-comparison/scenarios.json'), 'utf8'));
const output = path.join(root, 'tmp/agent-workflow', `services-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const files = cp.execFileSync('git', ['ls-files','--cached','--others','--exclude-standard','-z',
  'admin/src/lib/assistant','admin/src/db','admin/src/lib/postgresql.ts','admin/package.json','admin/package-lock.json',
  'admin/scripts/agent-comparison*','admin/scripts/requirement-workflow-acceptance.ts','scripts/agent-comparison/scenarios.json'],
{ cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
files.push(original, 'tmp/xiaok-vector/connection.private.json');
for (const name of ['@langchain/langgraph','@langchain/langgraph-checkpoint','@langchain/langgraph-checkpoint-postgres']) {
  const folder = 'admin/node_modules/' + name;
  for (const file of fs.readdirSync(path.join(root, folder, 'dist'), { recursive: true })) {
    if (typeof file === 'string' && /\.(cjs|js)$/.test(file)) files.push(`${folder}/dist/${file}`);
  }
  files.push(folder + '/package.json');
}
const binding = () => Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const report = { source: original, sourceHash: createHash('sha256').update(fs.readFileSync(path.join(root,original))).digest('hex'),
  scope: 'OS-CONTRACT-05 native LangGraph approval/restart/real draft receipt; saved createAgent first submissions only; no new model output',
  checks: [] as string[], replay: [] as unknown[], before: binding(), after: {} as Record<string,string>, drift: [] as string[],
  modelCalls: 0, cleaned: false, passed: false, error: '' };
let f: { enterpriseId: string; userId: string; conversationId: string; actor: ActorContext } | undefined;
const proposals: string[] = [];
const check = (name: string) => report.checks.push(name);

async function main() {
  const ownerUrl = new URL(dbConfig.EMBEDDING_EVAL_OWNER_URL);
  assert.equal(ownerUrl.host,url.host);assert.equal(ownerUrl.pathname,url.pathname);
  const ownerPool = new Pool({connectionString:ownerUrl.toString(),max:1});
  try {
    await setupRequirementWorkflow(ownerPool);
    const appRole = decodeURIComponent(url.username);assert.match(appRole,/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    await ownerPool.query('REVOKE ALL ON SCHEMA assistant_requirement_workflow FROM PUBLIC');
    await ownerPool.query(`GRANT USAGE ON SCHEMA assistant_requirement_workflow TO "${appRole}"`);
    await ownerPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assistant_requirement_workflow TO "${appRole}"`);
  } finally {await ownerPool.end();}
  const code = 'synthetic-langgraph-approval-' + randomUUID();
  const fixture = await withPlatformTransaction(async tx => {
    const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · LangGraph审批恢复',${code},'active') returning id`))!.id);
    const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values('测试专用审批业主',1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${code})`);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${enterpriseId},true,100,200000,1000000,30)`);
    return { enterpriseId, userId };
  });
  const actor: ActorContext = { enterpriseId: fixture.enterpriseId, principal: { kind: 'user', userId: fixture.userId }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'direct' } };
  const conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  f = { ...fixture, actor, conversationId };
  await withPlatformTransaction(tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot || '{"requirementReviewMode":true,"requirementWorkflow":"langgraph"}'::jsonb where enterprise_id=${f!.enterpriseId} and id=${conversationId}`));
  const req = new RequirementService(actor), workflow = new RequirementWorkflow(actor);
  const count = async () => Number((await withPlatformTransaction(tx => one(tx, sql`select count(*)::int n from app.assistant_requirement_summaries where enterprise_id=${f!.enterpriseId} and conversation_id=${conversationId}`)))!.n);
  const sources = new Map<string,string>();
  const stage = async (turn: string) => {
    const row = trace.cases.find((c: { id: string }) => c.id === `createAgent.1.${turn}`);
    const submission = trace.submissions.find((s: { case: string; firstDraft: boolean }) => s.case === row.id && s.firstDraft);
    const current = await req.customerEvidence(conversationId), read = await req.read(conversationId);
    const originalSources = row.context.customerMessages as {id:string;text:string}[];
    for (const old of originalSources) {
      const local = current.messages.find(m => m.text === old.text);
      if (local) sources.set(old.id, local.id);
    }
    const beforeItems = requirementItems(originalSources, row.before.requirements.latest?.draftFields);
    const currentItems = requirementItems(current.messages, read.latest?.draftFields);
    const changes = submission.args.changes.map((change: Record<string,string>) => {
      const rebound = { ...change };
      if (change.sourceId) {
        const match = /^c(\d+)\.(\d+)$/.exec(change.sourceId)!;
        assert.ok(match && sources.has(match[1])); rebound.sourceId = `c${sources.get(match[1])}.${match[2]}`;
      }
      if (change.targetId) {
        const old = beforeItems.find(i => i.id === change.targetId)!;
        assert.ok(old); const target = currentItems.filter(i => i.field === old.field && i.text === old.text);
        assert.equal(target.length, 1); rebound.targetId = target[0].id;
      }
      return rebound;
    });
    // Only IDs are rebound by identical source text/item value. No action, field,
    // value or first-draft answer is repaired. Enterprise prose stays separate.
    const result = await workflow.propose(conversationId, randomUUID(), { sourceSeq: current.sourceSeq, baseSummaryId: read.latest?.id || null, changes });
    assert.equal(result.kind, 'proposal'); if (result.kind !== 'proposal') throw Error('proposal_expected');
    proposals.push(String(result.proposal.id));
    report.replay.push({ case: row.id, original: submission.args, reboundChanges: changes, result,
      enterpriseAnswer: 'preserved/unverified; never used as an execution receipt or customer approval' });
    return result.proposal;
  };
  const approve = (p: { id: unknown; digest: unknown }, restoreConsent = false) => ({ action: 'apply_proposal', proposalId: p.id, digest: p.digest, consent: true, restoreConsent });
  const resumeInNewProcess = (requestKey: string, input: Record<string,unknown>) => {
    const resumed = JSON.parse(cp.execFileSync(process.execPath,['--import','tsx','scripts/requirement-workflow-acceptance.ts','--resume-approved'],{
      cwd:path.join(root,'admin'),windowsHide:true,encoding:'utf8',timeout:60000,
      input:JSON.stringify({actor,conversationId,requestKey,input}),
    }));
    assert.notEqual(resumed.resumedByProcess,process.pid);
    report.replay.push({recoveryProcess:resumed.resumedByProcess,parentProcess:process.pid,summaryId:resumed.id});
    return resumed;
  };
  for (const turn of ['inquiry','followup','save']) await append(f, scenarios.turns.find((t: {id:string}) => t.id === turn).text);
  const first = await stage('save'); assert.equal(await count(),0); check('nativeInterruptBeforeAnyDraftWrite');
  const checkpoint = await requirementCheckpointer().getTuple({ configurable: { thread_id: `requirements:${f.enterpriseId}:${conversationId}:${first.id}` } });
  assert.ok(checkpoint); assert.ok(!JSON.stringify(checkpoint).includes('90平')); check('officialPostgresCheckpointHasNoCustomerText');
  const saveKey = randomUUID();
  const saved = resumeInNewProcess(saveKey, approve(first));check('separateNodeProcessResumesPersistedApproval');
  assert.equal(saved.status,'draft'); assert.equal(saved.confirmedFields,null); assert.equal(await count(),1); check('newWorkflowInstanceResumesOriginalApprovalAndWritesDraft');
  assert.equal((await workflow.write(conversationId, saveKey, approve(first))).id,saved.id); check('sameKeyReplayReturnsActualReceipt');
  const concurrent = await Promise.all([workflow.write(conversationId, randomUUID(), approve(first)), new RequirementWorkflow(actor).write(conversationId, randomUUID(), approve(first))]);
  assert.ok(concurrent.every(r => r.id===saved.id)); assert.equal(await count(),1); check('concurrentDifferentKeysCreateNoDuplicate');
  assert.equal(saved.receipt?.summaryId,saved.id); assert.doesNotMatch(saved.receipt?.text || '', /已正式确认|已安排/); check('receiptComesFromDatabaseNotOriginalPrematureSavedProse');
  await append(f, scenarios.turns.find((t: {id:string}) => t.id === 'mixed').text);
  const mixed = await stage('mixed'); let failed = false;
  const fault = new RequirementWorkflow(actor, { afterWrite: async () => { if (!failed) { failed=true; throw Error('synthetic_after_commit_before_checkpoint'); } } });
  const mixedKey = randomUUID(); await assert.rejects(() => fault.write(conversationId,mixedKey,approve(mixed)),/synthetic_after_commit/);
  assert.equal(await count(),2); check('lostCheckpointAfterCommittedBusinessWriteRetainsSingleDraft');
  const updated = resumeInNewProcess(mixedKey,approve(mixed));check('separateNodeProcessRecoversWriteBeforeCheckpoint');
  const updatedFields = updated.draftFields as DraftRequirements;
  assert.equal(await count(),2); assert.match(updatedFields.room.text,/瓷砖/); assert.match(updatedFields.budget.text,/10万/); check('restartRecoversUnknownCheckpointWithOriginalBusinessKey');
  await append(f, scenarios.turns.find((t: {id:string}) => t.id === 'withdrawal').text);
  await append(f, scenarios.turns.find((t: {id:string}) => t.id === 'reversal').text);
  const reversal = await stage('reversal');
  assert.equal(reversal.diff.length,1); assert.equal(reversal.diff[0].field,'budget'); check('savedReversalBusinessActionIndependentOfInvalidCompanyReferences');
  await assert.rejects(() => workflow.write(conversationId,randomUUID(),approve(reversal)),/requirements_restore_confirmation_required/);
  assert.equal(await count(),2); check('missingRestoreConsentDoesNotConsumeApprovalOrWrite');
  const restoreKey = randomUUID();
  const restored = await workflow.write(conversationId,restoreKey,approve(reversal,true));
  const restoredFields = restored.draftFields as DraftRequirements;
  assert.match(restoredFields.budget.text,/12万/); assert.match(restoredFields.room.text,/瓷砖/); assert.match(restoredFields.devices.text,/地暖不做/); check('nativeApprovalRestoresBudgetOnlyAndKeepsOtherValues');
  const badActor = { ...actor, principal: { kind: 'user' as const, userId: '1' } };
  await assert.rejects(() => new RequirementWorkflow(badActor).write(conversationId,randomUUID(),approve(reversal,true))); check('otherCustomerCannotResumeCheckpoint');
  await assert.rejects(() => new RequirementWorkflow({...actor,enterpriseId:'1'}).write(conversationId,randomUUID(),approve(reversal,true))); check('otherTenantCannotResumeCheckpoint');
  await assert.rejects(() => new RequirementWorkflow({...actor,contextVersion:0}).write(conversationId,randomUUID(),approve(reversal,true))); check('revokedIdentityCannotReadOrResumeCheckpoint');
  const src = await req.customerEvidence(conversationId);
  const proposal = await workflow.propose(conversationId,randomUUID(),{sourceSeq:src.sourceSeq,baseSummaryId:restored.id,changes:[{operation:'replace',targetId:requirementItems(src.messages,restored.draftFields).find(i=>i.field==='budget')!.id,sourceId:`c${src.messages.find(m=>m.text.includes('预算改成10万'))!.id}.0`}]});
  assert.equal(proposal.kind,'proposal'); if(proposal.kind!=='proposal')throw Error('proposal_expected'); proposals.push(String(proposal.proposal.id));
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_enterprise_settings set knowledge_epoch=knowledge_epoch+1 where enterprise_id=${f!.enterpriseId}`));
  await assert.rejects(()=>workflow.write(conversationId,randomUUID(),approve(proposal.proposal)),/requirement_target_changed|requirements_stale/);
  assert.equal(await count(),3); check('sourceEpochRevocationBlocksPersistedApproval');
  const fresh = await workflow.propose(conversationId,randomUUID(),{sourceSeq:src.sourceSeq,baseSummaryId:restored.id,changes:[{operation:'replace',targetId:requirementItems(src.messages,restored.draftFields).find(i=>i.field==='budget')!.id,sourceId:`c${src.messages.find(m=>m.text.includes('预算改成10万'))!.id}.0`}]});
  assert.equal(fresh.kind,'proposal'); if(fresh.kind!=='proposal')throw Error('proposal_expected'); proposals.push(String(fresh.proposal.id));
  await workflow.reject(conversationId,String(fresh.proposal.id),String(fresh.proposal.digest),randomUUID());
  assert.equal(await count(),3); await assert.rejects(()=>workflow.write(conversationId,randomUUID(),approve(fresh.proposal)),/requirement_target_changed/); check('nativeRejectionNeverWritesOrLaterApprovesSameThread');
  const displayed=await req.read(conversationId);
  await req.write(conversationId,randomUUID(),{action:'confirm',draftId:restored.id,expectedVersion:restored.version,consent:true,
    fields:Object.fromEntries(Object.entries(restoredFields).map(([k,v])=>[k,v.text])),reviewedSourceSeq:displayed.sourceSeq});
  const confirmedReceipt=await workflow.write(conversationId,restoreKey,approve(reversal,true));
  assert.equal(confirmedReceipt.status,'confirmed');assert.equal(confirmedReceipt.receipt?.effect,'requirements_confirmed');
  assert.doesNotMatch(confirmedReceipt.receipt?.text||'',/尚未正式确认/);assert.equal(await count(),3);check('receiptReplayProjectsLaterFormalConfirmation');
  await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_requirement_summaries set status='redacted',draft_fields='{}'::jsonb,confirmed_fields=null where enterprise_id=${f!.enterpriseId} and id=${restored.id}`));
  const redactedReceipt=await workflow.write(conversationId,restoreKey,approve(reversal,true));
  assert.equal(redactedReceipt.receipt?.effect,'requirements_redacted');assert.deepEqual(redactedReceipt.draftFields,{});
  assert.doesNotMatch(redactedReceipt.receipt?.text||'',/12万|瓷砖/);check('receiptReplayProjectsCurrentRedactionWithoutCachedPrivateText');
  const runtime = await withPlatformTransaction(async tx => ({
    attempts: await one(tx,sql`select count(*)::int n from app.ai_provider_attempts where enterprise_id=${f!.enterpriseId}`),
    jobs: await one(tx,sql`select count(*)::int n from app.assistant_jobs where enterprise_id=${f!.enterpriseId} and status in ('queued','running')`),
  }));
  report.modelCalls=Number(runtime.attempts!.n);assert.equal(report.modelCalls,0);assert.equal(runtime.jobs!.n,0);check('realProviderAttemptAndActiveJobCountsRemainZero');
  report.passed=true;
}
async function run() {
  try { await main(); } catch(e) { report.error=e instanceof Error?e.message:String(e);process.exitCode=1; }
  finally {
    if(f) {
      for(const proposal of proposals) await new RequirementWorkflow(f.actor).forget(f.conversationId,proposal);
      await withPlatformTransaction(async tx=>{
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${f!.enterpriseId}`);
        await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f!.userId}`);
      }); report.cleaned=true;
    }
    report.after=binding(); report.drift=Object.keys(report.before).filter(k=>report.before[k]!==report.after[k]);
    if(report.drift.length){report.passed=false;process.exitCode=1;}
    fs.writeFileSync(output,JSON.stringify({...report,fixture:f && {enterpriseId:f.enterpriseId,userId:f.userId,conversationId:f.conversationId}},null,2));
    await closePostgresPool(); console.log(JSON.stringify({output:path.relative(root,output),checks:report.checks.length,passed:report.passed,error:report.error,drift:report.drift,cleaned:report.cleaned,modelCalls:0}));
  }
}
if(process.argv.includes('--resume-approved')) {
  void (async()=>{
    try {
      const input=JSON.parse(fs.readFileSync(0,'utf8'));
      const synthetic=await withPlatformTransaction(tx=>one(tx,sql`select code from app.enterprises where id=${String(input.actor.enterpriseId)}`));
      assert.match(String(synthetic?.code),/^synthetic-langgraph-approval-/);
      const saved=await new RequirementWorkflow(input.actor).write(input.conversationId,input.requestKey,input.input);
      console.log(JSON.stringify({...saved,resumedByProcess:process.pid}));
    }finally{await closePostgresPool();}
  })().catch(()=>{process.exitCode=1;});
}else void run().catch(()=>{process.exitCode=1;});
