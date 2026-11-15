import { withTenantTransaction } from '@/db/transaction';
import { previewAssistantQueue, type AssistantQueuePreview } from './job-preview';
import { evaluateWorkerSafetyGate, type WorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';
import { checkPilotWorkerAlignment } from '@/lib/xiaok-v1/pilot-worker-alignment';
import { resolvePilotScope, tenantPilotScopeRead,
  type PilotScopeResolutionStatus } from '@/lib/xiaok-v1/pilot-scope-resolver';

/** Read-only startup snapshot for the assistant Worker process.
 *
 * It combines the deployment safety gate, a configuration summary without
 * secrets, the saved pilot scope when applicable and a dry-run queue preview.
 * Nothing here claims a job, marks a provider start, retries a failure or
 * touches a notification. */
export type AssistantWorkerPreflight = {
  checkedAt: string;
  safetyGate: WorkerSafetyGate;
  alignment: {
    status: 'aligned' | 'mismatch' | 'invalid';
    mode: 'enterprise' | 'pilot' | null;
    enterpriseId: string | null;
    pilotId: string | null;
    errorCode: string | null;
  };
  pilotScope: {
    status: PilotScopeResolutionStatus | 'unavailable';
    scopeVersion: number | null;
    projectCount: number;
  } | null;
  queue: AssistantQueuePreview;
};

export async function assistantWorkerPreflight(input: {
  env?: Record<string, string | undefined>;
  now?: Date;
} = {}): Promise<AssistantWorkerPreflight> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const safetyGate = evaluateWorkerSafetyGate(env);
  const alignment = checkPilotWorkerAlignment(env);

  let pilotScope: AssistantWorkerPreflight['pilotScope'] = null;
  if (alignment.mode === 'pilot' && alignment.enterpriseId && alignment.pilotId) {
    try {
      const enterpriseId = alignment.enterpriseId;
      const pilotId = alignment.pilotId;
      const scope = await withTenantTransaction(enterpriseId, tx => resolvePilotScope({
        enterpriseId, pilotId, context: { read: tenantPilotScopeRead(tx), now },
      }), { readOnly: true });
      pilotScope = { status: scope.status, scopeVersion: scope.scopeVersion, projectCount: scope.projectIds.length };
    } catch {
      pilotScope = { status: 'unavailable', scopeVersion: null, projectCount: 0 };
    }
  }

  // The queue preview intentionally covers the same global assistant queue the
  // Worker claims. Scoping it to the pilot enterprise would hide other queued
  // work that a started Worker would still process.
  const queue = await previewAssistantQueue({ now });

  return {
    checkedAt: now.toISOString(),
    safetyGate,
    alignment: {
      status: alignment.status, mode: alignment.mode,
      enterpriseId: alignment.enterpriseId, pilotId: alignment.pilotId,
      errorCode: alignment.errorCode,
    },
    pilotScope,
    queue,
  };
}
