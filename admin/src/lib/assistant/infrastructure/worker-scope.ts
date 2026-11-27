import { sql } from 'drizzle-orm';
import type { WorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';

/** The only scope a business task may run in. The safety gate currently opens
 * only for a pilot, so an open gate always yields one enterprise. */
export type WorkerTaskScope = {
  enabled: boolean;
  enterpriseId: string | null;
  pilotId: string | null;
  scope: { enterpriseId: string } | undefined;
  assistantQueueScope: AssistantQueueScope | undefined;
};

export function workerTaskScope(gate: WorkerSafetyGate): WorkerTaskScope {
  const enabled = gate.status === 'open';
  const enterpriseId = enabled ? gate.enterpriseId : null;
  return {
    enabled,
    enterpriseId,
    pilotId: enabled ? gate.pilotId : null,
    scope: enterpriseId ? { enterpriseId } : undefined,
    assistantQueueScope: enterpriseId ? { enterpriseId, includeSharedConsultations: true } : undefined,
  };
}

export type AssistantQueueScope = {
  enterpriseId?: string | null;
  includeSharedConsultations?: boolean;
};

/** A local transcription run stores its protocol and configuration as JSON. */
export const localSpeechRunFilter = sql`coalesce(r.purpose='speech.transcribe'
  and r.policy_snapshot #>> '{localSpeech,protocol}'='local-speech-v1',false)`;

/** Filters an assistant_jobs row aliased as j. The shared lane is limited to
 * the customer's own consultation replies, regenerations and voice drafts. */
export function assistantQueueFilter(scope?: AssistantQueueScope) {
  const enterpriseId = scope?.enterpriseId?.trim();
  if (!enterpriseId) return sql``;
  if (!scope?.includeSharedConsultations) return sql`and j.enterprise_id=${enterpriseId}`;

  return sql`and (j.enterprise_id=${enterpriseId} or (j.kind='chat_turn' and exists (
    select 1 from app.assistant_runs r
    join app.assistant_conversations c on c.enterprise_id=r.enterprise_id and c.id=r.conversation_id
    where r.enterprise_id=j.enterprise_id and r.id=j.run_id
      and c.purpose='customer_consultation'
      and r.policy_snapshot #>> '{actor,principal,kind}' = 'user'
      and (
        (r.trigger_kind='user_message' and r.purpose in ('reply','reply.regenerate'))
        or (r.trigger_kind='domain_event' and ${localSpeechRunFilter})
      )
  )))`;
}

export type NativeWorkflowScope = {
  allowed: boolean;
  reason: 'pilot_enterprise' | 'pilot_scope_not_configured' | 'pilot_scope_override' | 'worker_safety_gate' | 'not_enabled';
  enterpriseIds: string[];
};

/** Native workflow keeps its own explicit allowlist. In pilot mode that list
 * must contain exactly the pilot enterprise: a list with another enterprise is
 * skipped instead of silently sending reminders or writing workflow data
 * outside the pilot. */
export function nativeWorkflowScope(ids: readonly string[], pilotEnterpriseId: string | null,
  enabled: boolean): NativeWorkflowScope {
  if (!enabled) return { allowed: false, reason: 'not_enabled', enterpriseIds: [...ids] };
  if (!pilotEnterpriseId) return { allowed: true, reason: 'pilot_enterprise', enterpriseIds: [...ids] };
  if (!ids.length) return { allowed: false, reason: 'pilot_scope_not_configured', enterpriseIds: [] };
  return ids.every(enterpriseId => enterpriseId === pilotEnterpriseId)
    ? { allowed: true, reason: 'pilot_enterprise', enterpriseIds: [...ids] }
    : { allowed: false, reason: 'pilot_scope_override', enterpriseIds: [...ids] };
}
