/** One CLI-executed period report, in the order the B5 contract requires.
 *
 * The order is load-bearing and shared by the CLI and its tests:
 *   1. trusted-clock period-end check (no database work),
 *   2. published definition resolution (the selected revision),
 *   3. shared published-target check (compile/digest/nodeVersions/eventType/
 *      periodKind) before any business write,
 *   4. management authorization, worker checks and the enterprise-scoped
 *      worker binding,
 *   5. the live runner with that same selected version and event.
 *
 * A rejected target therefore cannot reach `ensureFollowupBinding`, the run
 * store or the first port operation (enqueue).
 */

import type { ConstructionActor } from '@/lib/construction/contracts';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod, type FixedPeriod } from './period-event';
import { resolvePublishedTarget } from './published-target';
import { runPublishedLive } from './runner';
import type {
  LiveBusinessEvent,
  LiveOperationPorts,
  LivePeriodReceiver,
  LiveRunRecord,
  LiveRunStore,
} from './types';
import {
  prepareWorkerPeriodReport,
  type WorkerReceiverDependencies,
  type WorkerReceiverEvidence,
} from './worker-receiver';

export interface PeriodReportEntryInput {
  /** Resolves the one published revision this run is allowed to execute. */
  readonly loadPublished: () => Promise<PublishedWorkflowVersion>;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly actor: ConstructionActor;
  readonly event: TriggerEvent;
  readonly receiver: LivePeriodReceiver;
  readonly ports: LiveOperationPorts;
  readonly store: LiveRunStore;
  readonly runId: string;
}

export interface PeriodReportEntryDependencies {
  /** Trusted server clock; tests pin it. */
  readonly now?: () => Date;
  readonly worker?: WorkerReceiverDependencies;
}

export interface PeriodReportEntryResult {
  readonly period: FixedPeriod;
  readonly worker: WorkerReceiverEvidence | null;
  readonly businessEvent: LiveBusinessEvent;
  readonly record: LiveRunRecord;
}

function periodReportBusinessEvent(
  period: FixedPeriod,
  receiver: LivePeriodReceiver,
): LiveBusinessEvent {
  return {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: '',
    settingsVersion: 0,
    source: 'current_project_revision',
    periodKind: period.kind,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    ...(receiver.kind === 'worker' ? { receiver } : {}),
  };
}

export async function runPeriodReportEntry(
  input: PeriodReportEntryInput,
  dependencies: PeriodReportEntryDependencies = {},
): Promise<PeriodReportEntryResult> {
  const now = dependencies.now ?? (() => new Date());
  // Both receivers must pass the trusted-clock period-end check before the
  // published definition/target is resolved.
  let period = parseFixedPeriod(input.event, now());

  const published = await input.loadPublished();
  resolvePublishedTarget(published, input.event);

  // The worker receiver is authorized and bound last: management access,
  // staff availability, then the enterprise-scoped binding create. A rejected
  // target or executor leaves no conversation/binding/participant behind.
  let worker: WorkerReceiverEvidence | null = null;
  if (input.receiver.kind === 'worker' && input.receiver.adminId) {
    const prepared = await prepareWorkerPeriodReport({
      enterpriseId: input.enterpriseId,
      actor: input.actor,
      projectId: input.projectId,
      workerId: input.receiver.adminId,
      event: input.event,
    }, dependencies.worker);
    period = prepared.period;
    worker = prepared.worker;
  }

  const businessEvent = periodReportBusinessEvent(period, input.receiver);
  const record = await runPublishedLive({
    published,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
    event: input.event,
    businessEvent,
    ports: input.ports,
    store: input.store,
    runId: input.runId,
  });

  return { period, worker, businessEvent, record };
}
