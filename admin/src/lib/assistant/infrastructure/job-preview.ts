import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { assistantQueueFilter, type AssistantQueueScope } from './worker-scope';

/** Read-only dry-run of the assistant job queue used before a Worker starts.
 *
 * The preview never claims, retries or marks a job. It only classifies what a
 * future tick could safely reclaim:
 * - queued jobs that are already due;
 * - expired running jobs that never reached the provider;
 * - expired running jobs whose per-step provider outcome was already committed.
 *
 * A running job with `provider_started_at` and an unknown agent outcome stays
 * `indeterminate` and is never replayed automatically. `failed` and
 * `indeterminate` rows are terminal and are never retried by this preview. */
export type PreviewClassification = 'reclaimable' | 'waiting' | 'running' | 'indeterminate' | 'terminal';
export type PreviewReason =
  | 'queued_ready'
  | 'queued_not_due'
  | 'lease_active'
  | 'expired_without_provider'
  | 'expired_with_known_agent_outcome'
  | 'provider_outcome_unknown'
  | 'local_speech_result_unknown'
  | 'lease_missing'
  | 'failed_terminal'
  | 'indeterminate_terminal';

export type PreviewJobInput = {
  status: string;
  availableAt: Date | null;
  leaseExpiresAt: Date | null;
  providerStartedAt: Date | null;
  agentSteps: number;
  incompleteAgentSteps: number;
  localSpeech: boolean;
  now: Date;
};

export type PreviewJobDecision = {
  classification: PreviewClassification;
  reason: PreviewReason;
  reclaimable: boolean;
};

export function classifyPreviewJob(input: PreviewJobInput): PreviewJobDecision {
  if (input.status === 'failed') {
    return { classification: 'terminal', reason: 'failed_terminal', reclaimable: false };
  }
  if (input.status === 'indeterminate') {
    return { classification: 'terminal', reason: 'indeterminate_terminal', reclaimable: false };
  }
  if (input.status === 'queued') {
    const due = input.availableAt !== null && input.availableAt.getTime() <= input.now.getTime();
    return due
      ? { classification: 'reclaimable', reason: 'queued_ready', reclaimable: true }
      : { classification: 'waiting', reason: 'queued_not_due', reclaimable: false };
  }
  if (input.status !== 'running') {
    // Unknown statuses are never treated as safe work.
    return { classification: 'terminal', reason: 'indeterminate_terminal', reclaimable: false };
  }
  // `claimJob` requires an expired lease timestamp; a running row without one
  // is not eligible for automatic recovery.
  if (input.leaseExpiresAt === null) {
    return { classification: 'indeterminate', reason: 'lease_missing', reclaimable: false };
  }
  if (input.leaseExpiresAt.getTime() > input.now.getTime()) {
    return { classification: 'running', reason: 'lease_active', reclaimable: false };
  }
  if (input.localSpeech) {
    // The existing claim path terminally fails lost local transcription
    // results; the preview never proposes a replay.
    return { classification: 'terminal', reason: 'local_speech_result_unknown', reclaimable: false };
  }
  if (input.providerStartedAt === null) {
    return { classification: 'reclaimable', reason: 'expired_without_provider', reclaimable: true };
  }
  if (input.agentSteps >= 1 && input.incompleteAgentSteps === 0) {
    return { classification: 'reclaimable', reason: 'expired_with_known_agent_outcome', reclaimable: true };
  }
  return { classification: 'indeterminate', reason: 'provider_outcome_unknown', reclaimable: false };
}

export type PreviewJobItem = {
  enterpriseId: string;
  jobId: string;
  kind: string;
  status: string;
  attempts: number;
  availableAt: string | null;
  leaseExpiresAt: string | null;
  providerStartedAt: string | null;
  classification: PreviewClassification;
  reason: PreviewReason;
  reclaimable: boolean;
};

export type AssistantQueuePreview = {
  generatedAt: string;
  scope: { mode: 'global' | 'enterprise' | 'pilot_and_shared_consultations'; enterpriseId: string | null };
  counts: {
    queued: number;
    queuedReady: number;
    running: number;
    runningExpired: number;
    failed: number;
    indeterminate: number;
    expiredWithoutProvider: number;
    expiredWithKnownAgentOutcome: number;
    expiredUnknownProvider: number;
    expiredLocalSpeech: number;
  };
  reclaimable: {
    queuedReady: number;
    expiredWithoutProvider: number;
    expiredWithKnownAgentOutcome: number;
    total: number;
  };
  terminal: { failed: number; indeterminate: number };
  items: PreviewJobItem[];
  truncated: boolean;
};

const previewItemLimit = 200;

const int = (value: unknown) => Number(value ?? 0);

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asDate(value: unknown): Date | null {
  const parsed = iso(value);
  return parsed === null ? null : new Date(parsed);
}

/** Read-only queue preview. The transaction is opened with PostgreSQL
 * `READ ONLY`, so even an accidental write in this path is rejected by the
 * database instead of changing production state. */
export async function previewAssistantQueue(input: AssistantQueueScope & {
  now?: Date;
} = {}): Promise<AssistantQueuePreview> {
  const now = input.now ?? new Date();
  const enterpriseId = input.enterpriseId?.trim() || null;
  const scoped = assistantQueueFilter(input);
  const scopeMode = !enterpriseId ? 'global' : input.includeSharedConsultations
    ? 'pilot_and_shared_consultations' : 'enterprise';
  return withPlatformTransaction(async tx => {
    const counts = (await one(tx, sql`select
      count(*) filter (where j.status='queued')::int as queued,
      count(*) filter (where j.status='queued' and j.available_at<=${now})::int as queued_ready,
      count(*) filter (where j.status='running')::int as running,
      count(*) filter (where j.status='running' and j.lease_expires_at<=${now})::int as running_expired,
      count(*) filter (where j.status='failed')::int as failed,
      count(*) filter (where j.status='indeterminate')::int as indeterminate,
      count(*) filter (where j.status='running' and j.lease_expires_at<=${now}
        and j.provider_started_at is null and not coalesce((r.policy_snapshot->>'localSpeech')::boolean,false))::int as expired_without_provider,
      count(*) filter (where j.status='running' and j.lease_expires_at<=${now}
        and j.provider_started_at is not null and not coalesce((r.policy_snapshot->>'localSpeech')::boolean,false)
        and coalesce(s.n,0)>=1 and coalesce(s.incomplete,0)=0)::int as expired_known_outcome,
      count(*) filter (where j.status='running' and j.lease_expires_at<=${now}
        and j.provider_started_at is not null and not coalesce((r.policy_snapshot->>'localSpeech')::boolean,false)
        and (coalesce(s.n,0)<1 or coalesce(s.incomplete,0)>0))::int as expired_unknown,
      count(*) filter (where j.status='running' and j.lease_expires_at<=${now}
        and coalesce((r.policy_snapshot->>'localSpeech')::boolean,false))::int as expired_local_speech
      from app.assistant_jobs j
      left join app.assistant_runs r on r.enterprise_id=j.enterprise_id and r.id=j.run_id
      left join lateral (
        select count(*) as n, count(*) filter (where st.status<>'succeeded') as incomplete
        from app.assistant_run_steps st
        where st.enterprise_id=j.enterprise_id and st.run_id=j.run_id and st.kind='agent_model'
      ) s on true
      where j.status in ('queued','running','failed','indeterminate') ${scoped}`))!;
    const items = await rows(tx, sql`select j.enterprise_id::text as enterprise_id,j.id::text as id,j.kind,j.status,j.attempts,
      j.available_at,j.lease_expires_at,j.provider_started_at,
      coalesce((r.policy_snapshot->>'localSpeech')::boolean,false) as local_speech,
      coalesce(s.n,0) as agent_steps,coalesce(s.incomplete,0) as incomplete_agent_steps
      from app.assistant_jobs j
      left join app.assistant_runs r on r.enterprise_id=j.enterprise_id and r.id=j.run_id
      left join lateral (
        select count(*) as n, count(*) filter (where st.status<>'succeeded') as incomplete
        from app.assistant_run_steps st
        where st.enterprise_id=j.enterprise_id and st.run_id=j.run_id and st.kind='agent_model'
      ) s on true
      where j.status in ('queued','running','failed','indeterminate') ${scoped}
      order by case j.status when 'running' then 0 when 'queued' then 1 else 2 end,j.available_at,j.id
      limit ${previewItemLimit + 1}`);
    const visible = items.slice(0, previewItemLimit).map(row => {
      const decision = classifyPreviewJob({
        status: String(row.status), availableAt: asDate(row.available_at),
        leaseExpiresAt: asDate(row.lease_expires_at), providerStartedAt: asDate(row.provider_started_at),
        agentSteps: int(row.agent_steps), incompleteAgentSteps: int(row.incomplete_agent_steps),
        localSpeech: Boolean(row.local_speech), now,
      });
      return {
        enterpriseId: String(row.enterprise_id), jobId: String(row.id), kind: String(row.kind),
        status: String(row.status), attempts: int(row.attempts),
        availableAt: iso(row.available_at), leaseExpiresAt: iso(row.lease_expires_at),
        providerStartedAt: iso(row.provider_started_at), ...decision,
      };
    });
    const queuedReady = int(counts.queued_ready);
    const expiredWithoutProvider = int(counts.expired_without_provider);
    const expiredWithKnownAgentOutcome = int(counts.expired_known_outcome);
    return {
      generatedAt: now.toISOString(),
      scope: { mode: scopeMode, enterpriseId },
      counts: {
        queued: int(counts.queued), queuedReady,
        running: int(counts.running), runningExpired: int(counts.running_expired),
        failed: int(counts.failed), indeterminate: int(counts.indeterminate),
        expiredWithoutProvider, expiredWithKnownAgentOutcome,
        expiredUnknownProvider: int(counts.expired_unknown), expiredLocalSpeech: int(counts.expired_local_speech),
      },
      reclaimable: {
        queuedReady, expiredWithoutProvider, expiredWithKnownAgentOutcome,
        total: queuedReady + expiredWithoutProvider + expiredWithKnownAgentOutcome,
      },
      terminal: { failed: int(counts.failed), indeterminate: int(counts.indeterminate) },
      items: visible,
      truncated: items.length > previewItemLimit,
    };
  }, { readOnly: true });
}
