/** One CLI-executed period report, in the order the B5 contract requires.
 *
 * The order is load-bearing and shared by the CLI and its tests:
 *   1. trusted-clock period-end check (no database work),
 *   2. published definition resolution (the selected revision),
 *   3. shared published-target check (compile/digest/nodeVersions/eventType/
 *      periodKind) before any business write,
 *   4. management authorization, staff receiver checks (worker or designer) or
 *      the boss owner check, and the enterprise-scoped binding,
 *   5. the live runner with that same selected version and event.
 *
 * A rejected target therefore cannot reach `ensureFollowupBinding`, the run
 * store or the first port operation (enqueue).
 */

import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
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
  RuntimeWriteGuard,
} from './types';
import {
  prepareBossPeriodReport,
  type BossReceiverDependencies,
  type BossReceiverEvidence,
} from './boss-receiver';
import {
  prepareStaffPeriodReport,
  type StaffReceiverDependencies,
  type StaffReceiverEvidence,
  type StaffReceiverKind,
} from './staff-receiver';

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
  readonly writeGuard?: RuntimeWriteGuard;
  readonly runId: string;
}

export interface PeriodReportEntryDependencies {
  /** Trusted server clock; tests pin it. */
  readonly now?: () => Date;
  readonly staff?: StaffReceiverDependencies;
  readonly boss?: BossReceiverDependencies;
}

export interface PeriodReportEntryResult {
  readonly period: FixedPeriod;
  readonly staff: StaffReceiverEvidence | null;
  readonly boss: BossReceiverEvidence | null;
  readonly businessEvent: LiveBusinessEvent;
  readonly record: LiveRunRecord;
}

const RECEIVER_KINDS: ReadonlySet<string> = new Set(['customer', 'worker', 'designer', 'boss']);

/** An unknown host receiver kind must never fall back to the owner path. */
function assertKnownReceiver(receiver: LivePeriodReceiver): void {
  if (!RECEIVER_KINDS.has(receiver.kind)) {
    throw new WorkflowOperationError(
      'receiver_kind_invalid',
      422,
      `receiver kind ${JSON.stringify(receiver.kind)} is not supported`,
    );
  }
}

function staffKind(receiver: LivePeriodReceiver): StaffReceiverKind | null {
  return receiver.kind === 'worker' || receiver.kind === 'designer' ? receiver.kind : null;
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
    ...(receiver.kind !== 'customer' ? { receiver } : {}),
  };
}

export async function runPeriodReportEntry(
  input: PeriodReportEntryInput,
  dependencies: PeriodReportEntryDependencies = {},
): Promise<PeriodReportEntryResult> {
  const now = dependencies.now ?? (() => new Date());
  assertKnownReceiver(input.receiver);
  // Every receiver must pass the trusted-clock period-end check before the
  // published definition/target is resolved.
  let period = parseFixedPeriod(input.event, now());

  const published = await input.loadPublished();
  resolvePublishedTarget(published, input.event);

  // The staff receiver is authorized and bound last: management access, staff
  // availability, then the enterprise-scoped binding create. A rejected
  // target, executor or receiver leaves no conversation/binding/participant
  // behind.
  let staff: StaffReceiverEvidence | null = null;
  let boss: BossReceiverEvidence | null = null;
  const kind = staffKind(input.receiver);
  if (kind) {
    if (!input.receiver.adminId) {
      throw new WorkflowOperationError(
        `${kind}_receiver_unavailable`,
        422,
        `a ${kind} receiver requires an admin id`,
      );
    }
    const prepared = await prepareStaffPeriodReport({
      enterpriseId: input.enterpriseId,
      actor: input.actor,
      projectId: input.projectId,
      receiverKind: kind,
      adminId: input.receiver.adminId,
      event: input.event,
    }, { ...dependencies.staff, writeGuard: input.writeGuard });
    period = prepared.period;
    staff = prepared.staff;
  } else if (input.receiver.kind === 'boss') {
    if (!input.receiver.adminId) {
      throw new WorkflowOperationError(
        'boss_receiver_unavailable',
        422,
        'a boss receiver requires an admin id',
      );
    }
    // The boss is the existing enterprise owner, not a project staff member:
    // this branch never reads construction_members or customer_access.
    const prepared = await prepareBossPeriodReport({
      enterpriseId: input.enterpriseId,
      actor: input.actor,
      projectId: input.projectId,
      adminId: input.receiver.adminId,
      event: input.event,
    }, { ...dependencies.boss, writeGuard: input.writeGuard });
    period = prepared.period;
    boss = prepared.boss;
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
    writeGuard: input.writeGuard,
    runId: input.runId,
  });

  return { period, staff, boss, businessEvent, record };
}
