import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, key, principalKey, requireCapability, safeText, userContent, type ActorContext, type MessageContent, type RunTrigger } from '../contracts';
import { bindSpeechToMessage } from '../speech/link';
import { speechConfigurationHash } from '../speech/local';
import { createPreviewPolicy, previewPolicy, projectMessage, citationProjection, webCitationProjection } from '../knowledge/sources';
import { sourceExcerptProtocol } from '../agent/source-excerpts';
import { sourceQuestionCoverageProtocol } from '../agent/source-question-coverage';
import { naturalKnowledgeProtocol, knowledgeQuantityScopeProtocol } from '../agent/knowledge-explanation';
import { reportAnswerGroundingProtocol, reportSourceProjectionProtocol } from '../agent/report-source-scope';
import { reportCoordinationProtocol, reportHistoryScopeProtocol, reportQuestionPlanningProtocol, reportReadCompletionProtocol, siteObservationReferralProtocol } from '../agent/report-question-plan';
import { drawingChecklistReadProtocol } from '../agent/read-tool-input';
import { parseWebCitationId } from '../agent/web-evidence';
import { configuredGuidance, conversationGuidance, guidanceOpening, guidanceView } from '../requirements/guidance';
import { requirementCheckpoint } from '../requirements/checkpoint';
import { saveAutomaticRequirements } from '../requirements/automatic';
import { currentRequirementProposalPending } from '../requirements/current';
import { requestsDesigner } from '../handoff/intent';
import { stageHandoffProposal } from '../handoff/proposal';
import { currentHandoffOwner } from '../handoff/owner';
import { agentConfig, type AgentConfig } from '../agent/config';
import { homeSourceBudgetProtocol } from '../agent/home-source-budget';
import { homeSourceViewProtocol } from '../agent/home-source-view';
import { ownerArchiveReadProtocol, ownerQuestionScopeProtocol } from '../agent/owner-question-scope';
import { ownerCitationCarrierProtocol } from '../agent/final-output';
import { reportBodyFinalPolicy, reportNativeAdmission, reportNativeFinalProtocol, reportFinalFunctionCarrier, reportStructuralFinalSchema } from '../agent/report-native-final';
import { reportFinalOutputTokenLimit } from '../contracts/model';
import { imageContextBudgetPolicy } from '../agent/context-budget';
import { conversationImageProtocol } from '../agent/image-context';
import { nativeImageSchemaProtocol } from '../agent/native-final';
import { boundReviewProtocol, developmentReviewEntry } from '../agent/review-runtime';
import { referenceCase } from '../knowledge/reference-case';
import { contentEntrySource, contentGreeting, type ContentEntry } from '../knowledge/content-entry';
import { syncConstructionReminders } from '@/lib/construction/reminders';
import { currentConstructionContact } from '@/lib/construction/customer';
import { runRetryAwaitingReconciliation, runUsageReconciled, unresolvedProviderOutcome } from './usage-review';
import { portfolioCopyBudget } from './model-task-budget';
import { reportContext, reportContextView, selectedReport } from '@/lib/construction/report-reference';
import type { ReportCompositionScope } from '@/lib/construction/report-composition';

export const reserveTokens = 12000;
export const reserveCostMicros = 1000000;
export function runQuotaReservation(agent: AgentConfig | null) {
  if (agent?.consultation) return { tokens: 0, costMicros: 0 };
  if (agent?.imageContext === conversationImageProtocol) {
    const tokens = imageContextBudgetPolicy.inputBudget * imageContextBudgetPolicy.maxDispatches;
    // Preserve the existing conservative Agent cost-per-token hold. Actual
    // settlement and unknown-outcome holds continue through the same row.
    return { tokens, costMicros: Math.ceil(reserveCostMicros * tokens / 72000), imageContextBudget: imageContextBudgetPolicy.version,
      imageSchema: nativeImageSchemaProtocol };
  }
  return { tokens: agent ? 72000 : reserveTokens, costMicros: reserveCostMicros };
}
export function conversationSource(c:Row) {
  const e=c.entry_snapshot as Row;
  return e.kind==='reference_content'?{kind:e.kind,documentId:e.documentId,versionId:e.versionId,channel:e.channel}
    : e.kind === 'portfolio_content' ? { kind: e.kind, workId: e.workId, versionId: e.versionId, authorId: e.authorId }
    : {kind:e.kind||'conversation',id:e.id||String(c.id)};
}
const json = (value: unknown) => JSON.stringify(value);
export function conversationDto(c: Row, requirementProposalPending = false) {
  const guidance = conversationGuidance(c.entry_snapshot);
  const entry = c.entry_snapshot as Row;
  return { id: String(c.id), purpose: c.purpose, status: c.status, mode: c.mode, title: c.title, version: c.version, contextRevision: c.context_revision, createdAt: c.created_at,
    ...(entry?.requirementReviewMode===true && entry?.requirementWorkflow==='langgraph' ? {reviewWorkflow:'langgraph'} : {}),
    requirementProposalPending,
    guidanceEnabled: !!guidance, guidanceOpening: guidance ? guidanceOpening(guidance) : null,
    humanName: ((c.entry_snapshot as Row)?.handoff as Row)?.ownerName || null };
}
export function runDto(r: Row) {
  return { id: String(r.id), conversationId: String(r.conversation_id), status: r.status, outputMessageId: r.output_message_id ? String(r.output_message_id) : null,
    answerKind:r.answer_kind ?? null,errorCode: r.error_code, usageReconciled: r.usage_reconciled === true,
    retryable: !r.awaiting_reconciliation && ['failed', 'cancelled'].includes(String(r.status)), nextPollMs: ['queued', 'running'].includes(String(r.status)) ? 1500 : null };
}
/** Retain operation results with their resources; expiry is not permission to duplicate effects. */
export async function idempotent(tx: PostgresTransaction, actor: ActorContext, operation: string, requestKey: string, body: unknown, action: () => Promise<Row>): Promise<Row> {
  key(requestKey);
  const hash = fingerprint(body);
  const old = await one(tx, sql`select * from app.assistant_idempotency_records where enterprise_id=${actor.enterpriseId}
    and principal_key=${principalKey(actor)} and operation=${operation} and key=${requestKey}`);
  if (old) { if (old.request_hash !== hash) fail('idempotency_conflict'); return old.result as Row; }
  const result = await action();
  await tx.execute(sql`insert into app.assistant_idempotency_records(enterprise_id,principal_key,operation,key,request_hash,result,expires_at)
    values(${actor.enterpriseId},${principalKey(actor)},${operation},${requestKey},${hash},${json(result)}::jsonb,now()+interval '90 days')`);
  return result;
}
export async function appendMessage(tx: PostgresTransaction, actor: ActorContext, conversationId: string, input: {
  author: 'user' | 'admin' | 'assistant' | 'system'; content: MessageContent; clientMessageId?: string; runId?: string; eventId?: string; purpose?: string;
}) {
  if (input.author === 'system' && !input.eventId) fail('invalid_message', 422);
  if (input.author === 'assistant' && !input.runId) fail('invalid_message', 422);
  if (input.author === 'system') {
    const existing = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${conversationId} and source_event_id=${input.eventId!} and purpose=${input.purpose || 'reply'}`);
    if (existing) return existing;
  }
  const c = await one(tx, sql`update app.assistant_conversations set last_seq=last_seq+1,updated_at=now(),version=version+1
    where enterprise_id=${actor.enterpriseId} and id=${conversationId} and status='open' returning last_seq`);
  if (!c) fail('context_changed');
  return (await one(tx, sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,admin_id,content,client_message_id,run_id,source_event_id,purpose)
    values(${actor.enterpriseId},${conversationId},${String(c.last_seq)},${input.author},${input.author === 'user' && actor.principal.kind === 'user' ? actor.principal.userId : null},
    ${input.author==='admin' && actor.principal.kind==='admin'?actor.principal.adminId:null},
    ${json(input.content)}::jsonb,${input.clientMessageId || null},${input.runId || null},${input.eventId || null},${input.purpose || 'reply'}) returning *`))!;
}
export async function terminalEvent(tx: PostgresTransaction, enterpriseId: string, runId: string, status: string) {
  const event = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${enterpriseId},'assistant.run.terminal.v1','assistant_run',${runId},1,'{"kind":"system"}',${runId},${json({ status })}::jsonb)
    on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do update set aggregate_id=excluded.aggregate_id returning id`);
  await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
    values(${enterpriseId},${String(event!.id)},'assistant.run.metrics.v1') on conflict do nothing`);
}
export async function newRun(tx: PostgresTransaction, actor: ActorContext, c: Row, settings: Row, messageId: string | null, retryOf?: string, trigger: RunTrigger = { kind: 'user_message', messageId: messageId! }, purpose = 'reply', reportComposition?: ReportCompositionScope) {
  const speech = purpose === 'speech.transcribe', speechBinding = speech ? speechConfigurationHash() : null;
  const report = purpose === 'construction.report.compose' && trigger.kind === 'scheduled_task' && !!reportComposition
    && c.purpose === 'construction_followup' && actor.capabilities.includes('assistant.followup.delivery');
  if (purpose === 'construction.report.compose' && !report) fail('assistant_capability_forbidden', 403);
  if (speech && !speechBinding) fail('speech_unavailable', 503);
  if ((report ? c.status === 'closed' : c.status !== 'open') || !((speech || report) ? ['ai', 'human', 'handoff_requested'].includes(String(c.mode)) : c.mode === 'ai')) fail('context_changed');
  const privateFollowup = c.purpose === 'construction_followup' && actor.capabilities.includes('assistant.followup.self');
  const agent = !speech && (report || actor.principal.kind === 'user' || privateFollowup || (['site.record', 'site.action', 'site.question'].includes(purpose) && actor.capabilities.includes('assistant.project.shared'))) ? agentConfig(settings.agent_config) : null;
  const reportNativeFinal = reportNativeAdmission(agent, { conversationPurpose: c.purpose, purpose, triggerKind: trigger.kind,
    privateFollowup, selected: !!reportContext(c.entry_snapshot).selection });
  if (report && !agent) fail('assistant_capability_forbidden', 403);
  const entry = c.entry_snapshot as Row;
  const reviewRuntime = agent && actor.principal.kind === 'user' && c.purpose === 'customer_consultation'
    && entry.agentReviewCandidate === true && entry.requirementReviewMode === true
    && entry.requirementWorkflow === 'langgraph' ? boundReviewProtocol(entry, actor.enterpriseId) : null;
  // The snapshot and quota are bound together; old image runs never gain an
  // enlarged request envelope without its corresponding reservation.
  const reservation = runQuotaReservation(agent);
  if (speech) { reservation.tokens = 0; reservation.costMicros = 0; }
  const tokenReservation = reservation.tokens, costReservation = reservation.costMicros;
  const rate = Number(process.env.ASSISTANT_REQUESTS_PER_MINUTE || 30);
  if (!Number.isInteger(rate) || rate < 1 || rate > 1000) fail('assistant_disabled', 403);
  const recent = await one(tx, sql`select count(*) as n from app.assistant_runs where enterprise_id=${actor.enterpriseId} and created_at>now()-interval '1 minute'`);
  if (Number(recent!.n) >= rate) fail('assistant_quota_exceeded', 429);
  if (!report && purpose !== 'site.record' && await one(tx, sql`select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${String(c.id)} and status in ('queued','running') and purpose not in ('construction.report.facts','construction.report.compose')`)) fail('conversation_busy');
  // Match C01's existing unknown-result state at the service boundary too.
  // A distinct question is not permission to bypass an unresolved dispatch;
  // confirmed usage review is the same recovery proof projected to the client.
  if (!speech && !report && (privateFollowup || ['customer_consultation','construction_followup'].includes(String(c.purpose)) && actor.principal.kind === 'user'
    || c.purpose==='project_collaboration' && purpose==='site.question' && actor.capabilities.includes('assistant.project.shared')) && await one(tx, sql`select r.id from
    (select id,enterprise_id,status,error_code from app.assistant_runs where enterprise_id=${actor.enterpriseId}
      and conversation_id=${String(c.id)} and purpose not in ('speech.transcribe','construction.report.facts','construction.report.compose') order by created_at desc,id desc limit 1) r
    where ${unresolvedProviderOutcome()} and not ${runUsageReconciled()}`)) fail('provider_outcome_unknown');
  const budget = (await one(tx, sql`select coalesce(sum(reserved_requests),0) requests,
    coalesce(sum(case when status='settled' then coalesce(settled_tokens,reserved_tokens) else reserved_tokens end),0) tokens,
    coalesce(sum(case when status='settled' then coalesce(settled_cost_micros,reserved_cost_micros) else reserved_cost_micros end),0) cost
    from app.assistant_quota_reservations where enterprise_id=${actor.enterpriseId} and status!='released'
    and (budget_date=(now() at time zone 'UTC')::date or status in ('held','reconciling'))`))!;
  const copyBudget = await portfolioCopyBudget(tx, actor.enterpriseId);
  if (Number(budget.requests) + Number(copyBudget.requests) + 1 > Number(settings.daily_requests) || BigInt(String(budget.tokens)) + BigInt(String(copyBudget.tokens)) + BigInt(tokenReservation) > BigInt(String(settings.daily_tokens))
      || BigInt(String(budget.cost)) + BigInt(String(copyBudget.cost)) + BigInt(costReservation) > BigInt(String(settings.daily_cost_micros))) fail('assistant_quota_exceeded', 429);
  const r = (await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,trigger_event_id,trigger_schedule_key,purpose,retry_of_run_id,policy_snapshot,context_revision,knowledge_epoch)
    values(${actor.enterpriseId},${String(c.id)},${trigger.kind},${trigger.kind === 'user_message' ? trigger.messageId : null},
    ${trigger.kind === 'domain_event' ? trigger.eventId : null},${trigger.kind === 'scheduled_task' ? trigger.occurrenceKey : null},${purpose},
    ${retryOf || null},${json({ schemaVersion: 1, actor, maxTokens: agent?.consultation ? 8192 : 2048, policyVersion: settings.policy_version, agent,
      ...(!report && reportContext(c.entry_snapshot).selection ? { reportContextVersion: reportContext(c.entry_snapshot).revision } : {}),
      ...(report ? { reportComposition } : {}),
      ...(report ? reportBodyFinalPolicy(agent) : {}),
      ...(reportNativeFinal ? { reportNativeFinal: reportNativeFinalProtocol, reportFinalOutputTokens: reportFinalOutputTokenLimit,
        reportFinalCarrier: reportFinalFunctionCarrier, reportFinalSchema: reportStructuralFinalSchema, reportAnswerGrounding: reportAnswerGroundingProtocol,
        reportSourceProjection: reportSourceProjectionProtocol, reportQuestionPlanning: reportQuestionPlanningProtocol,
        reportReadCompletion: reportReadCompletionProtocol, reportHistoryScope: reportHistoryScopeProtocol, reportCoordination: reportCoordinationProtocol } : {}),
      ...(agent && !agent.structuredFinal && ['reply','site.question'].includes(purpose)
        ? { sourceAnswerMode: agent.knowledgeExplanation || sourceExcerptProtocol,
          ...(agent.knowledgeExplanation === naturalKnowledgeProtocol ? { knowledgeQuantityScope: knowledgeQuantityScopeProtocol }
            : agent.knowledgeQuantityScope ? { knowledgeQuantityScope: agent.knowledgeQuantityScope } : {}),
          sourceQuestionCoverage: sourceQuestionCoverageProtocol } : {}),
      ...(speech ? { localSpeech: { protocol: 'local-speech-v1', configurationHash: speechBinding } } : {}),
      ...(reservation.imageContextBudget ? { imageContextBudget: reservation.imageContextBudget } : {}),
      ...(reservation.imageSchema ? { imageSchema: reservation.imageSchema } : {}),
      ...(agent && actor.principal.kind === 'user' && c.purpose === 'customer_consultation' && purpose === 'reply'
        ? { homeSourceBudget: homeSourceBudgetProtocol, siteObservationReferral: siteObservationReferralProtocol,
          drawingChecklistRead: drawingChecklistReadProtocol, homeSourceView: homeSourceViewProtocol,
          ownerQuestionScope: ownerQuestionScopeProtocol, ownerArchiveRead: ownerArchiveReadProtocol,
          ...(agent.providerKey === 'dashscope' && agent.model === 'qwen3.8-flash' ? { ownerCitationCarrier: ownerCitationCarrierProtocol } : {}) } : {}),
      ...(reviewRuntime ? { reviewRuntime } : {}) })}::jsonb,${Number(c.context_revision)},${Number(settings.knowledge_epoch)}) returning *`))!;
  const runId = String(r.id);
  await tx.execute(sql`insert into app.assistant_jobs(enterprise_id,kind,run_id,dedupe_key) values(${actor.enterpriseId},'chat_turn',${runId},${'run:' + runId})`);
  await tx.execute(sql`insert into app.assistant_quota_reservations(enterprise_id,run_id,operation_key,reserved_tokens,reserved_cost_micros)
    values(${actor.enterpriseId},${runId},${'run:' + runId},${tokenReservation},${costReservation})`);
  return { conversationId: String(c.id), messageId, runId, status: 'queued', nextPollMs: 1500 };
}
/** Internal extension seam; no production P1 actor receives this capability. */
export function startInternalRun(actor: ActorContext, conversationId: string, trigger: RunTrigger, purpose: string, requestKey: string) {
  requireCapability(actor, 'assistant.run.internal');
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const repo = new AssistantRepository(tx, actor); const settings = await repo.settings(true); const c = await repo.conversation(conversationId);
    return idempotent(tx, actor, 'internal:' + conversationId, requestKey, { trigger, purpose }, () =>
      newRun(tx, actor, c, settings!, trigger.kind === 'user_message' ? trigger.messageId : null, undefined, trigger, purpose));
  });
}
export async function cancelRuns(tx: PostgresTransaction, actor: ActorContext, conversationId: string, runId?: string, keepReports = false) {
  const cancelled = await rows(tx, sql`update app.assistant_runs set status='cancelled',completed_at=now(),updated_at=now(),version=version+1
    where enterprise_id=${actor.enterpriseId} and conversation_id=${conversationId} and status in ('queued','running')
    ${keepReports ? sql`and purpose not in ('construction.report.facts','construction.report.compose')` : sql``}
    ${runId ? sql`and id=${runId}` : sql``} returning id,purpose,policy_snapshot`);
  for (const r of cancelled) {
    const job = await one(tx, sql`update app.assistant_jobs set status='cancelled',lease_token=null,updated_at=now(),version=version+1
      where enterprise_id=${actor.enterpriseId} and run_id=${String(r.id)} returning provider_started_at`);
    await tx.execute(sql`update app.assistant_quota_reservations set status=${job?.provider_started_at ? 'reconciling' : 'released'},updated_at=now(),version=version+1
      where enterprise_id=${actor.enterpriseId} and run_id=${String(r.id)}`);
    if (r.purpose === 'speech.transcribe' && (r.policy_snapshot as Row).localSpeech)
      await tx.execute(sql`update app.assistant_quota_reservations set status='settled',settled_tokens=0,settled_cost_micros=0,version=version+1,updated_at=now() where enterprise_id=${actor.enterpriseId} and run_id=${String(r.id)}`);
    await terminalEvent(tx, actor.enterpriseId, String(r.id), 'cancelled');
  }
}
export class ConversationService {
  constructor(readonly actor: ActorContext, private transaction?: PostgresTransaction) {
    requireCapability(actor, actor.capabilities.includes('assistant.followup.self') ? 'assistant.followup.self'
      : actor.principal.kind === 'user' ? 'assistant.chat.self' : 'assistant.preview.self');
  }
  private scoped<T>(work: (repo: AssistantRepository, settings: Row | undefined) => Promise<T>, write = false) {
    const execute = async (tx: PostgresTransaction) => {
      const repo = new AssistantRepository(tx, this.actor); const settings = await repo.settings(write); return work(repo, settings);
    };
    return this.transaction ? execute(this.transaction) : withTenantTransaction(this.actor.enterpriseId, execute);
  }
  create(requestKey: string, previewInput:Row={}) {
    if (this.actor.capabilities.includes('assistant.followup.self')) fail('assistant_capability_forbidden', 403);
    return this.scoped(async (repo, settings) => {
      const result = await idempotent(repo.tx, this.actor, 'create', requestKey, { entry: this.actor.entry || {},previewInput }, async () => {
      const preview=this.actor.principal.kind==='admin';
      if(!preview && Object.keys(previewInput).length) fail('invalid_message',422);
      const baseEntry: Row = { ...this.actor.entry };
      const entry: Row=preview?{preview:await createPreviewPolicy(repo.tx,this.actor.enterpriseId,previewInput)}
        : agentConfig(settings!.agent_config) ? developmentReviewEntry(this.actor.enterpriseId, baseEntry) : baseEntry;
      if (!preview && entry.guidanceVersion !== undefined) {
        if (entry.guidanceVersion !== Number(settings!.version)) fail('entry_context_invalid', 409);
        entry.guidance = configuredGuidance(settings!.guidance_config);
        if (['reference_content','reference_unavailable'].includes(String(entry.kind))) entry.guidance = null;
      }
      const c = (await one(repo.tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
        values(${this.actor.enterpriseId},${preview?'knowledge_preview':'customer_consultation'},${json(entry)}::jsonb,${Number(settings!.policy_version)}) returning *`))!;
      await repo.tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,admin_id,grant_basis)
        values(${this.actor.enterpriseId},${String(c.id)},${this.actor.principal.kind},${this.actor.principal.kind==='user'?this.actor.principal.userId:null},
        ${this.actor.principal.kind==='admin'?this.actor.principal.adminId:null},${json({ kind: 'self', contextVersion: this.actor.contextVersion })}::jsonb)`);
      return conversationDto(c);
      });
      await repo.conversation(String(result.id));
      return result;
    }, true);
  }
  list(cursor = '9223372036854775807', limit = 20) {
    if (this.actor.capabilities.includes('assistant.followup.self')) fail('assistant_capability_forbidden', 403);
    return this.scoped(async (repo, settings) => {
      const result = await rows(repo.tx, sql`select c.*, case when coalesce(c.entry_snapshot->>'retentionRedacted','false') != 'true' then
        (select m.content->'blocks'->0->>'text' from app.assistant_messages m
          where m.enterprise_id=c.enterprise_id and m.conversation_id=c.id and m.author_kind=${this.actor.principal.kind}
          order by m.seq asc limit 1) end as first_question
        from app.assistant_conversations c join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
        where c.enterprise_id=${this.actor.enterpriseId} and ${this.actor.principal.kind==='user'?sql`p.user_id=${this.actor.principal.userId}`:sql`p.admin_id=${this.actor.principal.adminId}`}
        and p.status='active' and c.purpose=${this.actor.principal.kind==='user'?'customer_consultation':'knowledge_preview'} and c.id<${cursor}
        order by c.id desc limit ${limit}`);
      const items = [];
      for (const c of result) {
        const question = typeof c.first_question === 'string' ? c.first_question.replace(/\s+/gu, ' ').trim() : '';
        const characters = Array.from(question);
        items.push(conversationDto({ ...c, title: question ? characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '') : c.title },
          await currentRequirementProposalPending(repo, c, settings)));
      }
      return { items, nextCursor: result.length === limit ? String(result.at(-1)!.id) : null };
    });
  }
  detail(conversationId: string) {
    return this.scoped(async (repo, settings) => {
      const c = await repo.conversation(conversationId);
      const config = conversationGuidance(c.entry_snapshot);
      const turns = config?.schemaVersion ? await rows(repo.tx, sql`select id,content from app.assistant_messages
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`) : [];
      const checkpoint = config ? await requirementCheckpoint(repo.tx, this.actor.enterpriseId, conversationId) : undefined;
      const guidance = guidanceView(config, turns.map(m => ({ id: String(m.id), text: ((m.content as { blocks?: Array<{text?: string}> })?.blocks || []).map(b => b.text || '').join('\n') })), checkpoint);
      if (guidance && (!configuredGuidance(settings?.guidance_config).enabled || c.status !== 'open' || c.mode !== 'ai')) { guidance.options = []; guidance.questionKey = null; }
      const latest = await one(repo.tx, sql`select r.*,${runUsageReconciled()} as usage_reconciled,${runRetryAwaitingReconciliation()} as awaiting_reconciliation
        from app.assistant_runs r where r.enterprise_id=${this.actor.enterpriseId} and r.conversation_id=${conversationId} and r.purpose not in ('speech.transcribe','construction.report.facts','construction.report.compose')
        order by r.id desc limit 1`);
      const preview = this.actor.principal.kind === 'admin' && c.purpose === 'knowledge_preview' ? previewPolicy(c) : null;
      const handoff = (c.entry_snapshot as Row)?.handoff as Row | undefined;
      const ownerAvailable = c.mode !== 'human' || !!await currentHandoffOwner(repo.tx, this.actor.enterpriseId, conversationId, handoff);
      const entry=c.entry_snapshot as Row;
      const contentEntry=['reference_content','reference_unavailable'].includes(String(entry.kind));
      const source=entry.kind==='reference_content'?await contentEntrySource(repo.tx,entry as ContentEntry):null;
      return { ...conversationDto(c, await currentRequirementProposalPending(repo, c, settings)), ownerAvailable, guidance:contentEntry?null:guidance, latestRun: latest ? runDto(latest) : null,
        reportContext: await reportContextView(repo.tx, this.actor, c),
        ...(contentEntry?{guidanceOpening:contentGreeting(source),guidanceEnabled:false}:{}),
        ...(preview ? { previewScope: { audience: preview.audience, draftVersionIds: preview.drafts.map(draft => draft.id) } } : {}) };
    });
  }
  messages(conversationId: string, beforeSeq = '9223372036854775807', limit = 20) {
    return this.scoped(async repo => {
      const c=await repo.conversation(conversationId);
      await syncConstructionReminders(repo.tx, this.actor, c);
      const result = await rows(repo.tx, sql`select id,seq,author_kind,content,answer_kind,created_at,purpose from app.assistant_messages
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and seq<${beforeSeq}
        and ${c.purpose === 'construction_followup' ? sql`purpose is distinct from 'construction.report.facts'` : sql`true`} order by seq desc limit ${limit}`);
      const items=[];
      for(const message of result)items.push(await projectMessage(repo.tx,this.actor,c,message));
      return { items,
        nextCursor: result.length === limit ? String(result.at(-1)!.seq) : null };
    });
  }
  constructionContact(conversationId: string, projectId: string, messageId: string) {
    return this.scoped(async repo => {
      const c = await repo.conversation(conversationId);
      const contact = await currentConstructionContact(repo.tx, this.actor, projectId);
      const message = await one(repo.tx, sql`select id,seq,author_kind,content,answer_kind,created_at,purpose from app.assistant_messages
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and id=${messageId}`);
      if (!message) fail('assistant_resource_not_found', 404);
      const projected = await projectMessage(repo.tx, this.actor, c, message);
      if (!projected.available || !projected.constructionContacts?.some(a => a.projectId === projectId && a.stageKey === contact.stageKey)) fail('construction_contact_unavailable', 404);
      return contact;
    });
  }
  citation(citationId:string, includeReference = true, expectedConversationId?: string) {
    return this.scoped(async repo=>{
      const web = parseWebCitationId(citationId);
      if (web) {
        const run = await one(repo.tx, sql`select conversation_id from app.assistant_runs where enterprise_id=${this.actor.enterpriseId} and id=${web.runId}`);
        if (!run || expectedConversationId && String(run.conversation_id) !== expectedConversationId) fail('assistant_resource_not_found', 404);
        return webCitationProjection(repo.tx, this.actor, await repo.conversation(String(run.conversation_id)), citationId);
      }
      const citation=await one(repo.tx,sql`select * from app.assistant_message_citations where enterprise_id=${this.actor.enterpriseId} and id=${citationId}`);
      if(!citation || expectedConversationId && String(citation.conversation_id) !== expectedConversationId) fail('assistant_resource_not_found',404);
      const c=await repo.conversation(String(citation.conversation_id));
      const projected = await citationProjection(repo.tx,this.actor,c,citation);
      if (!includeReference || !projected.available || !('referenceCase' in projected) || !projected.referenceCase) return projected;
      const version = await one(repo.tx,sql`select reference_case from app.assistant_knowledge_versions where enterprise_id=${this.actor.enterpriseId} and id=${String(citation.document_version_id)}`);
      const reference = referenceCase(version?.reference_case);
      return { ...projected, reference: { source: reference.source, authorization: reference.authorization, imageBase64: reference.imageBase64, mimeType: reference.mimeType } };
    });
  }
  send(conversationId: string, clientMessageId: string, content: unknown, interceptor?: {
    matches(content: MessageContent, conversation: Row): boolean;
    apply(tx: PostgresTransaction, actor: ActorContext, conversation: Row, message: Row): Promise<boolean>;
  }, speech?: unknown) {
    key(clientMessageId);
    return this.scoped(async (repo, settings) => {
      const c = await repo.conversation(conversationId); const safe = userContent(content, Number(settings!.max_message_chars));
      return idempotent(repo.tx, this.actor, 'send:' + conversationId, clientMessageId, speech === undefined ? safe : { ...safe, speech }, async () => {
        if (c.status !== 'open') fail('context_changed');
        const append = async (purpose?: string) => {
          const message = await appendMessage(repo.tx, this.actor, conversationId, { author: this.actor.principal.kind, content: safe, clientMessageId, purpose });
          await bindSpeechToMessage(repo.tx, this.actor, conversationId, String(message.id), safeText(safe), speech);
          return message;
        };
        let intercepted: Row | undefined;
        if (interceptor?.matches(safe, c)) {
          intercepted = await append();
          if (await interceptor.apply(repo.tx, this.actor, c, intercepted)) return { conversationId, messageId: String(intercepted.id), runId: null, status: 'succeeded', nextPollMs: null };
        }
        if (c.mode === 'handoff_requested' && this.actor.principal.kind === 'user') {
          const message = intercepted || await append('handoff.supplement');
          await saveAutomaticRequirements(repo, conversationId);
          return { conversationId, messageId: String(message.id), runId: null, status: 'succeeded', nextPollMs: null };
        }
        if (c.mode === 'human' && this.actor.principal.kind === 'user') {
          const h = (c.entry_snapshot as Row)?.handoff as Row;
          if (!await currentHandoffOwner(repo.tx,this.actor.enterpriseId,conversationId,h)) fail('context_changed');
          const message=intercepted || await append('human.reply');
          await saveAutomaticRequirements(repo, conversationId);
          return {conversationId,messageId:String(message.id),runId:null,status:'succeeded',nextPollMs:null};
        }
        if (c.mode !== 'ai') fail('context_changed');
        const reference = reportContext(c.entry_snapshot);
        if (reference.selection ? safe.reportContextVersion !== reference.revision || !await selectedReport(repo.tx, this.actor, c)
          : safe.reportContextVersion !== undefined || c.purpose === 'construction_followup') fail('context_changed');
        if (reference.selection && !agentConfig(settings!.agent_config)) fail('assistant_disabled', 403);
        // Operational commands may finish during a run. Other busy sends roll back every write above.
        if (await one(repo.tx, sql`select id from app.assistant_runs where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status in ('queued','running')`)) fail('conversation_busy');
        const old = intercepted ? undefined : await one(repo.tx, sql`select * from app.assistant_messages where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId}
          and ${this.actor.principal.kind==='user'?sql`user_id=${this.actor.principal.userId}`:sql`admin_id=${this.actor.principal.adminId}`} and client_message_id=${clientMessageId}`);
        if (old) {
          if (fingerprint(old.content) !== fingerprint(safe)) fail('idempotency_conflict');
          const r = await one(repo.tx, sql`select id from app.assistant_runs where enterprise_id=${this.actor.enterpriseId} and trigger_message_id=${String(old.id)} and retry_of_run_id is null`);
          return { conversationId, messageId: String(old.id), runId: r ? String(r.id) : null, status: r ? 'queued' : 'succeeded', nextPollMs: r ? 1500 : null };
        }
        const message = intercepted || await append();
        await saveAutomaticRequirements(repo, conversationId);
        if (this.actor.principal.kind === 'user' && requestsDesigner(safe.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'))) {
          if((c.entry_snapshot as Row)?.requirementReviewMode===true && (c.entry_snapshot as Row)?.requirementWorkflow==='langgraph') {
            const proposal=await stageHandoffProposal(repo,c,settings!,'request');
            const event=await one(repo.tx,sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
              values(${this.actor.enterpriseId},'assistant.handoff.proposed.v1','assistant_conversation',${conversationId},${Number(c.version)+1},${json(this.actor.principal)}::jsonb,${clientMessageId},${json({proposalId:proposal.id,action:'request'})}::jsonb) returning id`);
            await appendMessage(repo.tx,this.actor,conversationId,{author:'system',eventId:String(event!.id),purpose:'handoff.proposal',
              content:{version:1,blocks:[{type:'text',text:'接待提案已备好，尚未提交接待、接通或预约，也没有分享手机号。'}]}});
            return {conversationId,messageId:String(message.id),runId:null,status:'succeeded',nextPollMs:null};
          }
          const summary = await one(repo.tx, sql`select id,status,draft_fields,confirmed_fields from app.assistant_requirement_summaries
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
          const h = { state: 'waiting', requestId: clientMessageId, recipientId: null, recipientName: '企业接待团队', mediaConsent: true,
            contactConsent: false, phone: '', requestedAt: new Date().toISOString(), leadId: null,
            packet: { summary: summary || null, messages: [], truncated: false }, source: conversationSource(c) };
          await repo.tx.execute(sql`update app.assistant_conversations set mode='handoff_requested',entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${json(h)}::jsonb),
            context_revision=context_revision+1,version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
          const event = await one(repo.tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
            values(${this.actor.enterpriseId},'assistant.handoff.customer.v1','assistant_conversation',${conversationId},${Number(c.version)+1},
              ${json(this.actor.principal)}::jsonb,${clientMessageId},${json({ action: 'request', requestId: clientMessageId, basis: 'explicit_message' })}::jsonb) returning id`);
          await appendMessage(repo.tx, this.actor, conversationId, { author: 'system', eventId: String(event!.id), purpose: 'handoff.requested',
            content: { version: 1, blocks: [{ type: 'text', text: '已提交，等待企业接待团队。你可以继续补充资料，小K已暂停自动回复。' }] } });
          return { conversationId, messageId: String(message.id), runId: null, status: 'succeeded', nextPollMs: null };
        }
        return newRun(repo.tx, this.actor, c, settings!, String(message.id));
      });
    }, true);
  }
  archive(conversationId: string, expectedVersion: number, requestKey: string) {
    return this.scoped(async repo => {
      const c = await repo.conversation(conversationId);
      return idempotent(repo.tx, this.actor, 'archive:' + conversationId, requestKey, { expectedVersion }, async () => {
        if (c.version !== expectedVersion) fail('version_conflict');
        await cancelRuns(repo.tx, this.actor, conversationId);
        await repo.tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now(),version=version+1
          where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and participant_role='handoff_staff' and status='active'`);
        const updated = (await one(repo.tx, sql`update app.assistant_conversations set status='archived',context_revision=context_revision+1,version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${conversationId} returning *`))!;
        return conversationDto(updated);
      });
    });
  }
  run(runId: string, action?: 'cancel' | 'retry', requestKey?: string) {
    return this.scoped(async (repo, settings) => {
      const r = await one(repo.tx, sql`select r.*,${runUsageReconciled()} as usage_reconciled,${runRetryAwaitingReconciliation()} as awaiting_reconciliation
        from app.assistant_runs r where r.enterprise_id=${this.actor.enterpriseId} and r.id=${runId}`);
      if (!r) fail('assistant_resource_not_found', 404);
      const c = await repo.conversation(String(r.conversation_id));
      if (!action) return runDto(r);
      return idempotent(repo.tx, this.actor, action + ':' + runId, requestKey!, {}, async () => {
        if (action === 'cancel') {
          await cancelRuns(repo.tx, this.actor, String(c.id), runId);
          return runDto((await one(repo.tx, sql`select r.*,${runUsageReconciled()} as usage_reconciled,${runRetryAwaitingReconciliation()} as awaiting_reconciliation
            from app.assistant_runs r where r.enterprise_id=${this.actor.enterpriseId} and r.id=${runId}`))!);
        }
        if (!['failed', 'cancelled'].includes(String(r.status))) fail('context_changed');
        if (r.trigger_kind !== 'user_message') fail('assistant_capability_forbidden', 403);
        // Unknown/cancelled submissions still need reconciliation. A proved
        // model response followed by retrieval failure keeps its original cost
        // hold while the explicit retry receives a separate budget reservation.
        if (r.awaiting_reconciliation) fail('context_changed');
        return newRun(repo.tx, this.actor, c, settings!, String(r.trigger_message_id), runId);
      });
    }, action === 'retry');
  }
}
