import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '../contracts';
import {
  candidateReasons,
  isRetentionEligible,
  isRetentionRedacted,
  redactedCitationLocator,
  redactedMessageContent,
  retentionCutoff,
  retentionMarkerPayload,
  RETENTION_BATCH_SIZE,
  type RetentionBlockReason,
  type RetentionCandidate,
  type RetentionMode,
  type RetentionPlan,
  type RetentionRedactionCounts,
} from './contract';

const REDACTED_QUOTE = '[redacted by retention policy]';
const RETENTION_EVENT = 'assistant.retention.redacted.v1';

type RetentionSettings = Row & { retention_days: number | string };

export type RetentionReport = {
  mode: RetentionMode;
  status: 'ready' | 'disabled';
  reason?: 'retention_not_configured' | 'retention_disabled';
  enterpriseId: string;
  operatorId: string;
  retentionDays: number;
  cutoff: string | null;
  generatedAt: string;
  plan: RetentionPlan | null;
  candidates: RetentionCandidate[];
  applied: RetentionRedactionCounts;
  skippedDuringApply: Array<{ conversationId: string; reasons: RetentionBlockReason[] }>;
  preserved: {
    knowledgeSources: true;
    unknownCostReservations: true;
    costReviews: true;
    idempotencyRecords: true;
    idempotencyResponsesRedacted: true;
    providerAttempts: true;
    knowledgeJobs: true;
  };
};

const emptyCounts = (): RetentionRedactionCounts => ({
  conversations: 0,
  messages: 0,
  citations: 0,
  runSteps: 0,
  runs: 0,
  outboxPayloads: 0,
  auditEvents: 0,
  idempotencyResults: 0,
  requirementSummaries: 0,
});

const preserved = {
  knowledgeSources: true as const,
  unknownCostReservations: true as const,
  costReviews: true as const,
  idempotencyRecords: true as const,
  idempotencyResponsesRedacted: true as const,
  providerAttempts: true as const,
  knowledgeJobs: true as const,
};

function positiveId(value: string, name: string) {
  if (!/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(String(value)) > BigInt('9223372036854775807')) {
    throw new Error(`${name} must be a positive PostgreSQL bigint`);
  }
  return String(value);
}

function bool(value: unknown) {
  return value === true || value === 't' || value === 'true';
}

function asDate(value: unknown): Date {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid retention timestamp');
  return result;
}

function safeRetentionDays(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

/**
 * The operator is deliberately narrower than the platform cleanup roles. A
 * tenant-bound enterprise administrator must receive this explicit capability
 * in the database before either a dry-run or an apply can inspect data.
 */
export async function authorizeRetentionOperator(
  tx: PostgresTransaction,
  enterpriseId: string,
  adminId: string
) {
  positiveId(enterpriseId, 'enterpriseId');
  positiveId(adminId, 'adminId');
  const operator = await one(tx, sql`select e.id as enterprise_id,a.id as admin_id
    from app.enterprises e
    join app.admin_users a on a.enterprise_id=e.id
    where e.id=${enterpriseId} and e.status='active'
      and a.id=${adminId} and a.role='enterprise_admin' and a.status='active'
      and a.must_change_password=false
      and 'assistant-retention'=any(coalesce(a.menu_permissions, array[]::text[]))
    for share of e,a`);
  if (!operator) fail('assistant_capability_forbidden', 403);
  return { enterpriseId, adminId };
}

async function lockSettings(tx: PostgresTransaction, enterpriseId: string) {
  return one<RetentionSettings>(tx, sql`select * from app.assistant_enterprise_settings
    where enterprise_id=${enterpriseId} for update`);
}

function buildCandidate(row: Row): RetentionCandidate {
  const reasons = candidateReasons({
    activeRun: bool(row.active_run),
    activeJob: bool(row.active_job),
    activeProviderAttempt: bool(row.active_provider_attempt),
    unknownCost: bool(row.unknown_cost),
    alreadyRedacted: bool(row.already_redacted),
  });
  return {
    conversationId: String(row.conversation_id),
    status: String(row.status),
    updatedAt: asDate(row.updated_at),
    eligible: isRetentionEligible(reasons),
    reasons,
  };
}

/**
 * Builds a tenant-scoped plan while the settings row is locked. The worker,
 * quota reservation and send paths use the same settings lock, so an apply
 * cannot pass this check while a new provider dispatch is acquiring the lock.
 */
export async function buildRetentionPlan(
  tx: PostgresTransaction,
  enterpriseId: string,
  settings: RetentionSettings,
  now = new Date(),
  afterConversationId?: string
): Promise<RetentionPlan> {
  const retentionDays = safeRetentionDays(settings.retention_days);
  if (retentionDays < 1) fail('assistant_disabled', 403);
  const cutoff = retentionCutoff(now, retentionDays);
  const values = await rows(tx, sql`select c.id::text as conversation_id,c.status,c.updated_at,
      (c.entry_snapshot->>'retentionRedacted')='true' as already_redacted,
      exists(select 1 from app.assistant_runs r
        where r.enterprise_id=c.enterprise_id and r.conversation_id=c.id
          and r.status in ('queued','running','indeterminate')) as active_run,
      exists(select 1 from app.assistant_jobs j join app.assistant_runs r
        on r.enterprise_id=j.enterprise_id and r.id=j.run_id
        where j.enterprise_id=c.enterprise_id and r.conversation_id=c.id
          and (j.status in ('queued','running')
            or j.lease_expires_at>${now.toISOString()}::timestamptz
            or j.provider_started_at>${now.toISOString()}::timestamptz-interval '180 seconds')) as active_job,
      exists(select 1 from app.ai_provider_attempts p join app.assistant_runs r
        on r.enterprise_id=p.enterprise_id and r.id=p.assistant_run_id
        where p.enterprise_id=c.enterprise_id and r.conversation_id=c.id
          and p.status in ('created','submitted','processing','unknown')) as active_provider_attempt,
      exists(select 1 from app.assistant_quota_reservations q join app.assistant_runs r
        on r.enterprise_id=q.enterprise_id and r.id=q.run_id
        where q.enterprise_id=c.enterprise_id and r.conversation_id=c.id
          and q.status in ('held','reconciling')) as unknown_cost
    from app.assistant_conversations c
    where c.enterprise_id=${enterpriseId}
      and c.status in ('archived','closed')
      and c.updated_at<${cutoff.toISOString()}::timestamptz
      ${afterConversationId ? sql`and c.id>${afterConversationId}` : sql``}
      and (c.entry_snapshot->>'retentionRedacted') is distinct from 'true'
    order by c.id limit ${RETENTION_BATCH_SIZE + 1}`);
  const page = values.slice(0, RETENTION_BATCH_SIZE);
  const hasMore = values.length > RETENTION_BATCH_SIZE;
  return {
    enterpriseId,
    retentionDays,
    cutoff,
    candidates: page.map(buildCandidate),
    hasMore,
    nextCursor: hasMore && page.length ? String(page.at(-1)!.conversation_id) : null,
  };
}

function reportBase(
  mode: RetentionMode,
  enterpriseId: string,
  operatorId: string,
  now: Date,
  settings?: RetentionSettings
): RetentionReport {
  const retentionDays = safeRetentionDays(settings?.retention_days);
  return {
    mode,
    status: retentionDays > 0 ? 'ready' : 'disabled',
    ...(settings ? {} : { reason: 'retention_not_configured' as const }),
    ...(settings && retentionDays === 0 ? { reason: 'retention_disabled' as const } : {}),
    enterpriseId,
    operatorId,
    retentionDays,
    cutoff: null,
    generatedAt: now.toISOString(),
    plan: null,
    candidates: [],
    applied: emptyCounts(),
    skippedDuringApply: [],
    preserved,
  };
}

async function currentBlockers(tx: PostgresTransaction, enterpriseId: string, conversationId: string, now: Date) {
  const row = await one(tx, sql`select
      exists(select 1 from app.assistant_runs r where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
        and r.status in ('queued','running','indeterminate')) as active_run,
      exists(select 1 from app.assistant_jobs j join app.assistant_runs r
        on r.enterprise_id=j.enterprise_id and r.id=j.run_id
        where j.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
        and (j.status in ('queued','running') or j.lease_expires_at>${now.toISOString()}::timestamptz
          or j.provider_started_at>${now.toISOString()}::timestamptz-interval '180 seconds')) as active_job,
      exists(select 1 from app.ai_provider_attempts p join app.assistant_runs r
        on r.enterprise_id=p.enterprise_id and r.id=p.assistant_run_id
        where p.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
          and p.status in ('created','submitted','processing','unknown')) as active_provider_attempt,
      exists(select 1 from app.assistant_quota_reservations q join app.assistant_runs r
        on r.enterprise_id=q.enterprise_id and r.id=q.run_id
        where q.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
          and q.status in ('held','reconciling')) as unknown_cost`);
  return candidateReasons({
    activeRun: bool(row?.active_run),
    activeJob: bool(row?.active_job),
    activeProviderAttempt: bool(row?.active_provider_attempt),
    unknownCost: bool(row?.unknown_cost),
  });
}

async function redactConversation(
  tx: PostgresTransaction,
  enterpriseId: string,
  conversationId: string,
  operatorId: string,
  cutoff: Date
): Promise<RetentionRedactionCounts> {
  const counts = emptyCounts();
  const marker = retentionMarkerPayload();
  const content = redactedMessageContent();
  const citationLocator = redactedCitationLocator();
  const conversation = await one(tx, sql`update app.assistant_conversations
    set title='',
      entry_snapshot=jsonb_strip_nulls(jsonb_build_object(
        'retentionRedacted',true,'retentionVersion',${marker.retentionVersion}::integer,'marker',${marker.marker}::text,
        'preview',entry_snapshot->'preview')),
      version=version+1,updated_at=now()
    where enterprise_id=${enterpriseId} and id=${conversationId}
      and status in ('archived','closed')
      and updated_at<${cutoff.toISOString()}::timestamptz
      and (entry_snapshot->>'retentionRedacted') is distinct from 'true'
    returning id::text,version`);
  if (!conversation) return counts;
  counts.conversations = 1;
  await tx.execute(sql`update app.assistant_media set data=null,room_name='',source_ref=null,deleted_at=coalesce(deleted_at,now())
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and deleted_at is null`);

  const summaries = await rows(tx, sql`update app.assistant_requirement_summaries
    set status='redacted',draft_fields='{}'::jsonb,confirmed_fields=null,updated_at=now(),version=version+1
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and status!='redacted' returning id`);
  counts.requirementSummaries = summaries.length;

  const messageRows = await rows(tx, sql`update app.assistant_messages
    set content=${JSON.stringify(content)}::jsonb,updated_at=now(),version=version+1
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
      and (content->>'retentionRedacted') is distinct from 'true'
    returning id`);
  counts.messages = messageRows.length;

  const citationRows = await rows(tx, sql`update app.assistant_message_citations
    set quote_snapshot=${REDACTED_QUOTE},locator=${JSON.stringify(citationLocator)}::jsonb
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
      and (locator->>'retentionRedacted') is distinct from 'true'
    returning id`);
  counts.citations = citationRows.length;

  const runRows = await rows<Row>(tx, sql`update app.assistant_runs
    set policy_snapshot=jsonb_strip_nulls(jsonb_build_object(
      'retentionRedacted',true,'retentionVersion',${marker.retentionVersion}::integer,'marker',${marker.marker}::text,
      'policyVersion',policy_snapshot->'policyVersion')),
      updated_at=now(),version=version+1
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
      and (policy_snapshot->>'retentionRedacted') is distinct from 'true'
    returning id::text`);
  counts.runs = runRows.length;

  const stepRows = await rows(tx, sql`update app.assistant_run_steps
    set input_summary=${JSON.stringify(marker)}::jsonb,source_refs='[]'::jsonb,private_checkpoint=null,updated_at=now(),version=version+1
    where enterprise_id=${enterpriseId} and run_id in
      (select id from app.assistant_runs where enterprise_id=${enterpriseId} and conversation_id=${conversationId})
      and (input_summary->>'retentionRedacted') is distinct from 'true'
    returning id`);
  counts.runSteps = stepRows.length;

  // Keep create/send/retry/archive idempotency rows and their durable IDs, but
  // reduce replay payloads to the public DTO shapes. This prevents an old
  // response extension or title from restoring private text on replay.
  const idempotencyRows = await rows(tx, sql`update app.assistant_idempotency_records i
    set result=case
      when i.result->>'id'=${conversationId} and (i.operation='create' or i.operation=${'archive:' + conversationId}) then
        jsonb_build_object('id',i.result->'id','purpose',i.result->'purpose','status',i.result->'status',
          'mode',i.result->'mode','title','','version',i.result->'version','contextRevision',i.result->'contextRevision',
          'createdAt',i.result->'createdAt')
      when i.result->>'conversationId'=${conversationId} and i.result ? 'runId' then
        jsonb_build_object('conversationId',i.result->'conversationId','messageId',i.result->'messageId',
          'runId',i.result->'runId','status',i.result->'status','nextPollMs',i.result->'nextPollMs')
      when i.result->>'conversationId'=${conversationId} and i.result ? 'id' then
        jsonb_build_object('id',i.result->'id','conversationId',i.result->'conversationId','status',i.result->'status',
          'outputMessageId',i.result->'outputMessageId','answerKind',i.result->'answerKind','errorCode',i.result->'errorCode',
          'retryable',i.result->'retryable','nextPollMs',i.result->'nextPollMs')
      else i.result end,
      updated_at=now(),version=version+1
    where i.enterprise_id=${enterpriseId}
      and ((i.result->>'id'=${conversationId} and (i.operation='create' or i.operation=${'archive:' + conversationId}))
        or (i.result->>'conversationId'=${conversationId} and (i.result ? 'runId' or i.result ? 'id')))
    returning i.id`);
  counts.idempotencyResults = idempotencyRows.length;

  const outboxRows = await rows(tx, sql`update app.domain_event_outbox e
    set payload=${JSON.stringify(marker)}::jsonb,updated_at=now(),version=version+1
    where e.enterprise_id=${enterpriseId}
      and ((e.aggregate_type='assistant_run' and e.aggregate_id in
        (select id::text from app.assistant_runs where enterprise_id=${enterpriseId} and conversation_id=${conversationId}))
        or (e.aggregate_type='assistant_conversation' and e.aggregate_id=${conversationId}))
      and e.type like 'assistant.%'
      and e.type<>${RETENTION_EVENT}
      and e.type not like 'assistant.knowledge.%'
      and (e.payload->>'retentionRedacted') is distinct from 'true'
    returning e.id`);
  counts.outboxPayloads = outboxRows.length;

  const event = await one(tx, sql`insert into app.domain_event_outbox(
      enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${enterpriseId},${RETENTION_EVENT},'assistant_conversation',${conversationId},${String(conversation.version)},
      ${JSON.stringify({ kind: 'admin', adminId: operatorId })}::jsonb,${randomUUID()},
      ${JSON.stringify({ retentionVersion: marker.retentionVersion, cutoff: cutoff.toISOString(), counts: { ...counts, auditEvents: 1 } })}::jsonb)
    on conflict(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do nothing
    returning id`);
  counts.auditEvents = event ? 1 : 0;
  return counts;
}

export async function runAssistantRetention(input: {
  enterpriseId: string;
  adminId: string;
  mode?: RetentionMode;
  now?: Date;
  afterConversationId?: string;
}): Promise<RetentionReport> {
  const enterpriseId = positiveId(input.enterpriseId, 'enterpriseId');
  const adminId = positiveId(input.adminId, 'adminId');
  const afterConversationId = input.afterConversationId
    ? positiveId(input.afterConversationId, 'afterConversationId')
    : undefined;
  const mode = input.mode ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('mode must be dry-run or apply');
  if (input.now && (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))) {
    throw new Error('Invalid retention timestamp');
  }

  return withTenantTransaction(enterpriseId, async (tx) => {
    await authorizeRetentionOperator(tx, enterpriseId, adminId);
    const settings = await lockSettings(tx, enterpriseId);
    // Production apply uses the transaction's database clock. Tests may inject
    // a fixed clock explicitly so their cutoff and fixtures remain deterministic.
    const now = input.now ?? (mode === 'apply'
      ? asDate((await one(tx, sql`select now() as now`))?.now)
      : new Date());
    const base = reportBase(mode, enterpriseId, adminId, now, settings);
    if (!settings || safeRetentionDays(settings.retention_days) < 1) return base;

    const plan = await buildRetentionPlan(tx, enterpriseId, settings, now, afterConversationId);
    const report: RetentionReport = {
      ...base,
      cutoff: plan.cutoff.toISOString(),
      plan,
      candidates: plan.candidates,
    };
    if (mode === 'dry-run') return report;

    for (const candidate of plan.candidates.filter((value) => value.eligible)) {
      const locked = await one<Row>(tx, sql`select id::text,status,updated_at,entry_snapshot
        from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${candidate.conversationId} for update`);
      if (!locked || !['archived', 'closed'].includes(String(locked.status)) ||
          asDate(locked.updated_at).getTime() >= plan.cutoff.getTime() || isRetentionRedacted(locked.entry_snapshot)) {
        report.skippedDuringApply.push({ conversationId: candidate.conversationId, reasons: ['already_redacted'] });
        continue;
      }
      const blockers = await currentBlockers(tx, enterpriseId, candidate.conversationId, now);
      if (!isRetentionEligible(blockers)) {
        report.skippedDuringApply.push({ conversationId: candidate.conversationId, reasons: blockers });
        continue;
      }
      const counts = await redactConversation(tx, enterpriseId, candidate.conversationId, adminId, plan.cutoff);
      for (const key of Object.keys(report.applied) as Array<keyof RetentionRedactionCounts>) {
        report.applied[key] += counts[key];
      }
    }
    return report;
  });
}
