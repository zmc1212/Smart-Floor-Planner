import type { WorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';

/** The only scope a business task may run in. The safety gate currently opens
 * only for a pilot, so an open gate always yields one enterprise. */
export type WorkerTaskScope = {
  enabled: boolean;
  enterpriseId: string | null;
  pilotId: string | null;
  scope: { enterpriseId: string } | undefined;
};

export function workerTaskScope(gate: WorkerSafetyGate): WorkerTaskScope {
  const enabled = gate.status === 'open';
  const enterpriseId = enabled ? gate.enterpriseId : null;
  return {
    enabled,
    enterpriseId,
    pilotId: enabled ? gate.pilotId : null,
    scope: enterpriseId ? { enterpriseId } : undefined,
  };
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
