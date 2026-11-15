import { withTenantTransaction } from '@/db/transaction';
import { previewAssistantQueue, type AssistantQueuePreview } from './job-preview';
import { previewWorkerSideEffects, type WorkerSideEffectsPreview } from './worker-side-effects';
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
  scopedQueue: AssistantQueuePreview | null;
  sideEffects: WorkerSideEffectsPreview;
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

  // The global preview keeps out-of-scope backlog visible. The scoped preview
  // shows exactly what a started Worker may claim in pilot mode.
  const queue = await previewAssistantQueue({ now });
  const scopedQueue = safetyGate.enterpriseId
    ? await previewAssistantQueue({ enterpriseId: safetyGate.enterpriseId, now })
    : null;
  const sideEffects = await previewWorkerSideEffects({ env, now });

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
    scopedQueue,
    sideEffects,
  };
}
