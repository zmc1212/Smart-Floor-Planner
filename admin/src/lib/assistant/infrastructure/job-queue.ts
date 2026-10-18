import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, type ActorContext, type MessageContent, type Evidence } from '../contracts';
import { appendMessage, terminalEvent } from '../core/conversation';
import { processKnowledgeJob } from '../knowledge/index-worker';
import { processAnswer } from './answer-worker';
import { resolveEvidence, validatePreviewSnapshot, previewPolicy } from '../knowledge/sources';
import { parseAnswer, safeInsufficientContent, type GroundedAnswer } from '../knowledge/answer';
import { agentConfig } from '../agent/config';

export const workerTiming = { providerMs: 90000, leaseMs: 150000, requestMs: 180000, heartbeatMs: 30000 };
export type Lease = { enterpriseId: string; jobId: string; runId: string; token: string; actor: ActorContext };
export type RunResult = { content: MessageContent; usage: { inputTokens: number; outputTokens: number } | null; attemptId?: string };
async function finish(tx: PostgresTransaction, lease: Lease, status: string, error: string | null, outputMessageId?: string) {
  await tx.execute(sql`update app.assistant_jobs set status=${status},last_error=${error},lease_token=null,lease_expires_at=null,updated_at=now(),version=version+1 where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
  await tx.execute(sql`update app.assistant_runs set status=${status},error_code=${error},output_message_id=${outputMessageId || null},completed_at=now(),updated_at=now(),version=version+1 where enterprise_id=${lease.enterpriseId} and id=${lease.runId}`);
  await terminalEvent(tx, lease.enterpriseId, lease.runId, status);
}
async function authorized(repo: AssistantRepository, run: Row) {
  const settings = await repo.settings(true);
  const c = await repo.conversation(String(run.conversation_id));
  if (c.mode !== 'ai' || c.status !== 'open' || c.context_revision !== run.context_revision || settings!.knowledge_epoch !== run.knowledge_epoch
    || Number(settings!.policy_version) !== Number((run.policy_snapshot as { policyVersion: number }).policyVersion)) fail('context_changed');
  const configuredAgent = agentConfig((run.policy_snapshot as Row).agent);
  if (configuredAgent && fingerprint(configuredAgent) !== fingerprint(agentConfig(settings!.agent_config))) fail('context_changed');
  await validatePreviewSnapshot(repo.tx,repo.actor,c);
  return c;
}
/** Global scan exposes routing IDs only; every claim and recovery uses the tenant scope. */
export async function claimJob(): Promise<Lease | null> {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select enterprise_id,id from app.assistant_jobs
    where kind='chat_turn' and ((status='queued' and available_at<=now()) or (status='running' and lease_expires_at<=now())) order by available_at,id limit 50`));
  for (const candidate of candidates) {
    const lease = await withTenantTransaction(String(candidate.enterprise_id), async tx => {
      // The settings lock is the common ordering point for API, claim, completion, and cancellation.
      const settings = await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${String(candidate.enterprise_id)} for update skip locked`);
      if (!settings) return null;
      const job = await one(tx, sql`select * from app.assistant_jobs where enterprise_id=${String(candidate.enterprise_id)} and id=${String(candidate.id)}
        and ((status='queued' and available_at<=now()) or (status='running' and lease_expires_at<=now())) for update skip locked`);
      if (!job) return null;
      const run = (await one(tx, sql`select * from app.assistant_runs where enterprise_id=${String(job.enterprise_id)} and id=${String(job.run_id)} for update`))!;
      const actor = (run.policy_snapshot as { actor: ActorContext }).actor;
      const current: Lease = { enterpriseId: String(job.enterprise_id), jobId: String(job.id), runId: String(run.id), token: randomUUID(), actor };
      if (job.status === 'running' && job.provider_started_at) {
        const completedAgentSteps = agentConfig((run.policy_snapshot as Row).agent) ? await one(tx, sql`select count(*) as n,
          count(*) filter(where status!='succeeded') as incomplete from app.assistant_run_steps
          where enterprise_id=${current.enterpriseId} and run_id=${current.runId} and kind='agent_model'`) : null;
        if (!completedAgentSteps || Number(completedAgentSteps.n) < 1 || Number(completedAgentSteps.incomplete) > 0) {
        await finish(tx, current, 'indeterminate', 'provider_outcome_unknown');
        await tx.execute(sql`update app.assistant_quota_reservations set status='reconciling',version=version+1,updated_at=now() where enterprise_id=${current.enterpriseId} and run_id=${current.runId}`);
        return null;
        }
      }
      try {
        await authorized(new AssistantRepository(tx, actor), run);
        if (Number(job.attempts) >= 3) fail('model_unavailable', 503);
      } catch (e) {
        await finish(tx, current, 'failed', e instanceof AssistantError ? e.code : 'context_changed');
        await tx.execute(sql`update app.assistant_quota_reservations set status=${job.provider_started_at ? 'reconciling' : 'released'},version=version+1,updated_at=now() where enterprise_id=${current.enterpriseId} and run_id=${current.runId}`);
        return null;
      }
      await tx.execute(sql`update app.assistant_jobs set status='running',attempts=attempts+1,lease_token=${current.token},
        lease_expires_at=now()+interval '150 seconds',heartbeat_at=now(),version=version+1,updated_at=now() where enterprise_id=${current.enterpriseId} and id=${current.jobId}`);
      await tx.execute(sql`update app.assistant_runs set status='running',started_at=coalesce(started_at,now()),version=version+1,updated_at=now() where enterprise_id=${current.enterpriseId} and id=${current.runId}`);
      return current;
    });
    if (lease) return lease;
  }
  return null;
}
async function live(tx: PostgresTransaction, lease: Lease) {
  await tx.execute(sql`select id from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId} for update`);
  const job = await one(tx, sql`select * from app.assistant_jobs where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}
    and run_id=${lease.runId} and status='running' and lease_token=${lease.token} and lease_expires_at>now() for update`);
  if (!job) fail('context_changed');
  const run = await one(tx, sql`select * from app.assistant_runs where enterprise_id=${lease.enterpriseId} and id=${lease.runId} and status='running' for update`);
  if (!run) fail('context_changed');
  return { job, run };
}
export async function runContext(tx:PostgresTransaction,lease:Lease) {
  const state=await live(tx,lease);
  const conversation=await authorized(new AssistantRepository(tx,lease.actor),state.run);
  return {...state,conversation};
}
export async function heartbeat(lease: Lease) {
  return withTenantTransaction(lease.enterpriseId, async tx => {
    const { run } = await live(tx, lease); await authorized(new AssistantRepository(tx, lease.actor), run);
    await tx.execute(sql`update app.assistant_jobs set lease_expires_at=now()+interval '150 seconds',heartbeat_at=now(),updated_at=now(),version=version+1
      where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
  });
}
/** Commit this marker BEFORE any provider I/O; recovery must never assume an unrecorded acceptance was free. */
export async function markProviderStarted(lease: Lease,evidence:Evidence[]=[]) {
  return withTenantTransaction(lease.enterpriseId, async tx => {
    const { run, job } = await live(tx, lease); const c=await authorized(new AssistantRepository(tx, lease.actor), run);
    for(const e of evidence) if(!await resolveEvidence(tx,lease.actor,c,e))fail('context_changed');
    if (job.provider_started_at) fail('context_changed');
    await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
  });
}
export async function completeRun(lease: Lease, result: RunResult, commit?: (tx: PostgresTransaction, run: Row, messageId: string) => Promise<void>) {
  return withTenantTransaction(lease.enterpriseId, async tx => {
    const { run } = await live(tx, lease);
    await authorized(new AssistantRepository(tx, lease.actor), run);
    // 1A cannot persist citations until the 1B authorized source resolver exists.
    if (result.content.version !== 1 || !result.content.blocks.length || result.content.blocks.some(b => b.type !== 'text' || typeof b.text !== 'string' || !b.text.trim()) ||
      JSON.stringify(result.content).length > 32000) fail('invalid_message', 422);
    if (result.usage && (!Number.isSafeInteger(result.usage.inputTokens) || !Number.isSafeInteger(result.usage.outputTokens) || result.usage.inputTokens < 0 || result.usage.outputTokens < 0)) fail('invalid_message', 422);
    const message = await appendMessage(tx, lease.actor, String(run.conversation_id), { author: 'assistant', content: result.content, runId: lease.runId });
    await commit?.(tx, run, String(message.id));
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${lease.enterpriseId},${lease.runId},${result.attemptId || null},${'run:' + lease.runId},'tokens',
      ${result.usage ? result.usage.inputTokens + result.usage.outputTokens : null},${result.usage ? 'observed' : 'unavailable'},${result.usage?.inputTokens ?? null},${result.usage?.outputTokens ?? null}) on conflict do nothing`);
    // Unknown billing retains the conservative reservation for reconciliation.
    await tx.execute(sql`update app.assistant_quota_reservations set status='reconciling',version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}`);
    await finish(tx, lease, 'succeeded', null, String(message.id));
    return String(message.id);
  });
}
export async function failRun(lease: Lease, code: string, outcomeKnown=false) {
  return withTenantTransaction(lease.enterpriseId, async tx => {
    const { job } = await live(tx, lease);
    const unknown=job.provider_started_at && !outcomeKnown;
    const status = unknown ? 'indeterminate' : 'failed';
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
      values(${lease.enterpriseId},${lease.runId},${Number(job.attempts)},${code === 'retrieval_unavailable' ? 'retrieval' : 'execution'},${status},
      ${JSON.stringify({ code: unknown ? 'provider_outcome_unknown' : code })}::jsonb) on conflict do nothing`);
    await tx.execute(sql`update app.assistant_quota_reservations set status=${job.provider_started_at ? 'reconciling' : 'released'},version=version+1,updated_at=now()
      where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}`);
    await finish(tx, lease, status, unknown ? 'provider_outcome_unknown' : code);
  });
}
/** At most one expensive job per request; oldest eligible kind prevents chat/index starvation. */
export async function processAssistantJob(processRun: (lease: Lease) => Promise<void> = processAnswer) {
  const next=await withPlatformTransaction(tx=>one(tx,sql`select kind from app.assistant_jobs where
    (status='queued' and available_at<=now()) or (status='running' and lease_expires_at<=now()) order by available_at,id limit 1`));
  const lease=next?.kind==='chat_turn'?await claimJob():null;
  if(lease) await processRun(lease);
  const knowledgeClaimed=next?.kind==='knowledge_index'?await processKnowledgeJob():false;
  await deliverMetrics();
  return { claimed: Boolean(lease) || knowledgeClaimed };
}
/** Trusted configured interview copy is not a knowledge answer or provider invocation. */
export async function completeGuidance(lease: Lease, text: string) {
  if (!text.trim() || text.length > 2000) fail('invalid_message', 422);
  return withTenantTransaction(lease.enterpriseId, async tx => {
    const { conversation, job } = await runContext(tx, lease);
    if (job.provider_started_at) fail('context_changed');
    const message = await appendMessage(tx, lease.actor, String(conversation.id), {
      author: 'assistant', runId: lease.runId, purpose: 'requirements.guidance', content: { version: 1, blocks: [{ type: 'text', text }] },
    });
    await tx.execute(sql`update app.assistant_quota_reservations set status='released',version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}`);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${lease.enterpriseId},${lease.runId},${'guidance:'+lease.runId},'tokens',0,'observed',0,0)`);
    await finish(tx, lease, 'succeeded', null, String(message.id)); return String(message.id);
  });
}
/** Final answer and citations commit together, after all current authorization checks. */
export async function completeAnswer(lease:Lease,answer:GroundedAnswer,evidence:Evidence[],attemptId:string|null,followup?:string,guard?:(tx:PostgresTransaction)=>Promise<void>) {
  answer=parseAnswer(JSON.stringify(answer),evidence);
  return withTenantTransaction(lease.enterpriseId,async tx=>{
    const {job,conversation:c}=await runContext(tx,lease);
    if (guard) await guard(tx);
    const step=await one(tx,sql`select source_refs from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}
      and kind='retrieval' and status='succeeded' order by step_seq desc limit 1`);
    if(!step || fingerprint(step.source_refs)!==fingerprint(evidence.map(e=>({ref:e.ref,hash:e.hash}))))fail('context_changed');
    const sources=new Map<string,Row>();
    for(const e of evidence) {
      const source=await resolveEvidence(tx,lease.actor,c,e);
      if(!source || !String(source.text).includes(e.text))fail('context_changed');
      sources.set(e.ref.id,source);
    }
    const initial=answer.answerKind==='insufficient_evidence'?safeInsufficientContent():{version:1 as const,blocks:[]};
    const message=await appendMessage(tx,lease.actor,String(c.id),{author:'assistant',content:initial,runId:lease.runId});
    const content:MessageContent=answer.answerKind==='insufficient_evidence'?initial:{version:1,blocks:[]};
    const saved=new Map<string,string>();
    for(const segment of answer.segments) {
      content.blocks.push({type:'text',text:segment.text});
      for(const citation of segment.citations) {
        const source=sources.get(citation.sourceId);
        if(!source || !String(source.text).includes(citation.quote))fail('invalid_model_citation',502);
        let citationId=saved.get(citation.sourceId);
        if(!citationId) {
          const isDraft=lease.actor.principal.kind==='admin' && previewPolicy(c).drafts.some(d=>d.id===String(source.document_version_id));
          const row=(await one(tx,sql`insert into app.assistant_message_citations(enterprise_id,conversation_id,message_id,run_id,source_kind,resource_type,resource_id,resource_version,
            document_id,document_version_id,chunk_id,source_hash,quote_snapshot,locator,is_draft)
            values(${lease.enterpriseId},${String(c.id)},${String(message.id)},${lease.runId},'knowledge','knowledge_chunk',${citation.sourceId},${String(source.document_version_id)},
            ${String(source.document_id)},${String(source.document_version_id)},${citation.sourceId},${String(source.text_hash)},${citation.quote},${JSON.stringify(source.locator)}::jsonb,${isDraft}) returning id`))!;
          citationId=String(row.id);saved.set(citation.sourceId,citationId);
        }
        content.blocks.push({type:'citation',citationId,fallbackText:'知识来源'});
      }
    }
    if (followup) content.blocks.push({ type: 'text', text: followup });
    await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify(content)}::jsonb,answer_kind=${answer.answerKind} where enterprise_id=${lease.enterpriseId} and id=${String(message.id)}`);
    await tx.execute(sql`update app.assistant_runs set answer_kind=${answer.answerKind} where enterprise_id=${lease.enterpriseId} and id=${lease.runId}`);
    await tx.execute(sql`update app.assistant_quota_reservations set status=${job.provider_started_at?'reconciling':'released'},version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}`);
    if(!job.provider_started_at) await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
      values(${lease.enterpriseId},${lease.runId},${'answer:'+lease.runId},'tokens',0,'observed',0,0) on conflict do nothing`);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,provider_attempt_id,input_summary,status)
      values(${lease.enterpriseId},${lease.runId},${Number(job.attempts)*10+2},'answer',${attemptId},${JSON.stringify({answerKind:answer.answerKind,citations:saved.size})}::jsonb,'succeeded')`);
    await finish(tx,lease,'succeeded',null,String(message.id));
    return String(message.id);
  });
}
async function deliverMetrics() {
  const targets = await withPlatformTransaction(tx => rows(tx, sql`select enterprise_id,id from app.domain_event_deliveries
    where consumer_key in ('assistant.run.metrics.v1','assistant.knowledge.visibility.v1') and status in ('pending','retry_wait') and available_at<=now() order by id limit 50`));
  for (const target of targets) await withTenantTransaction(String(target.enterprise_id), async tx => {
    // The run itself is the durable metrics fact; this consumer acknowledges visibility, never sends notifications.
    await tx.execute(sql`update app.domain_event_deliveries set status='delivered',attempts=attempts+1,updated_at=now(),version=version+1
      where enterprise_id=${String(target.enterprise_id)} and id=${String(target.id)} and status in ('pending','retry_wait')`);
  });
}
