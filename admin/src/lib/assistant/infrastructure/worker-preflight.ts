import { withTenantTransaction } from '@/db/transaction';
import { previewAssistantQueue, type AssistantQueuePreview } from './job-preview';
import { previewWorkerSideEffects, type WorkerSideEffectsPreview } from './worker-side-effects';
import { workerTaskScope } from './worker-scope';
import { type WorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';
import { checkPilotWorkerAlignment } from '@/lib/xiaok-v1/pilot-worker-alignment';
import { resolvePilotScope, tenantPilotScopeRead,
  type PilotScopeResolutionStatus } from '@/lib/xiaok-v1/pilot-scope-resolver';
import { resolveWorkerDeployment, type WorkerDeployment,
  type WorkerRuntimeConfig } from '@/lib/xiaok-v1/worker-runtime-config';

/** Read-only startup snapshot for the assistant Worker process.
 *
 * It combines the deployment safety gate, a configuration summary without
 * secrets, the saved pilot scope when applicable and a dry-run queue preview.
 * Nothing here claims a job, marks a provider start, retries a failure or
 * touches a notification. */
export type AssistantWorkerPreflight = {
  checkedAt: string;
  safetyGate: WorkerSafetyGate;
  /** Where the gate came from: the saved platform switch or, until the first
   * save, the legacy deployment environment. */
  deployment: {
    source: 'database' | 'environment';
    config: WorkerRuntimeConfig | null;
  };
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
  resolveWorkerDeployment?: () => Promise<WorkerDeployment>;
} = {}): Promise<AssistantWorkerPreflight> {
  const baseEnv = input.env ?? process.env;
  const now = input.now ?? new Date();
  const deployment = await (input.resolveWorkerDeployment
    ?? (() => resolveWorkerDeployment({ env: baseEnv })))();
  const env = deployment.env;
  const safetyGate = deployment.gate;
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
  // shows the active Worker's pilot jobs and shared consultations.
  const queue = await previewAssistantQueue({ now });
  const scopedQueue = safetyGate.enterpriseId
    ? await previewAssistantQueue({
      enterpriseId: safetyGate.enterpriseId, ...workerTaskScope(safetyGate).assistantQueueScope, now,
    })
    : null;
  const sideEffects = await previewWorkerSideEffects({ env, now, deployment });

  return {
    checkedAt: now.toISOString(),
    safetyGate,
    deployment: { source: deployment.source, config: deployment.config },
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
