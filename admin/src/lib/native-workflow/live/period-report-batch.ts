/** One host action, one project, one ended period, four fixed receivers.
 *
 * The batch is a thin host coordinator around the existing single-receiver
 * entry (`runPeriodReportEntry`) and ports (`createPeriodReportPorts`). It does
 * not compose a shared report, copy a body, discover receivers, create a
 * second queue or touch the Workflow definition:
 *
 *   1. trusted-clock period check (no database work),
 *   2. one selected published revision + shared published-target precheck,
 *   3. executor write permission and the single report plan (new requests only),
 *   4. one host manifest with four reserved sub-runIds,
 *   5. the existing entry/ports per receiver, in host-fixed order,
 *   6. read-only status observation for every executed sub-run.
 *
 * Receiver identity is explicit: customer by the existing project customer
 * binding, worker/designer/boss by the host admin ids. The workflow definition
 * never selects or widens a receiver. Each receiver keeps its own binding,
 * conversation, facts, report/version/body, message and read receipt.
 */

import { randomUUID } from 'node:crypto';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { isPlainObject } from '../guards';
import { WorkflowOperationError } from '../errors';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent, WorkflowValue } from '../types';
import { parseFixedPeriod, type FixedPeriod } from './period-event';
import { resolvePublishedTarget } from './published-target';
import {
  runPeriodReportEntry,
  type PeriodReportEntryInput,
  type PeriodReportEntryResult,
} from './period-report-entry';
import {
  assertPeriodReportBatchExecutor,
  assertPeriodReportBatchPlan,
  type PeriodReportBatchPlanEvidence,
  type PeriodReportBatchPreflightInput,
} from './period-report-batch-preflight';
import {
  assertBatchRequestId,
  type PeriodReportBatchStore,
} from './period-report-batch-store';
import {
  readPeriodReportRunStatus,
  type PeriodReportRunObservation,
  type PeriodOverallState,
} from './period-report-status';
import type {
  LiveOperationPorts,
  LivePeriodReceiver,
  LiveRunRecord,
  LiveRunStore,
} from './types';

export const BATCH_RECEIVER_ORDER = ['customer', 'worker', 'designer', 'boss'] as const;
export type PeriodReportBatchReceiverKind = (typeof BATCH_RECEIVER_ORDER)[number];

export interface PeriodReportBatchReceiver {
  readonly kind: PeriodReportBatchReceiverKind;
  readonly adminId?: string;
}

export interface PeriodReportBatchReceiverIdentity {
  readonly kind: PeriodReportBatchReceiverKind;
  readonly adminId: string | null;
}

export type PeriodReportBatchEntryState =
  | 'not_started'
  | 'processing'
  | 'completed'
  | 'stopped'
  | 'unavailable'
  | 'failed'
  | 'unknown';

export type PeriodReportBatchState =
  | 'running'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'unknown';

export interface PeriodReportBatchReceipt {
  readonly reportId: string;
  readonly revision: number;
  readonly runId: string;
  readonly reportKey: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly reused: boolean;
}

export interface PeriodReportBatchDelivery {
  readonly delivered: boolean;
  readonly status: string | null;
  readonly messageId: string | null;
  readonly conversationId: string | null;
}

export interface PeriodReportBatchObservation {
  readonly observedAt: string;
  readonly bound: boolean;
  readonly overall: PeriodOverallState | null;
  readonly reasons: readonly string[];
  readonly availability: string | null;
  readonly availabilityReason: string | null;
  readonly factsState: string | null;
  readonly bodyState: string | null;
  readonly deliveryState: string | null;
  readonly deliveryMessageId: string | null;
  readonly deliveryConversationId: string | null;
}

export interface PeriodReportBatchEntry {
  readonly kind: PeriodReportBatchReceiverKind;
  readonly adminId: string | null;
  /** Reserved before execution; stable across re-entry of the same request. */
  readonly runId: string;
  readonly executed: boolean;
  readonly state: PeriodReportBatchEntryState;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly saveReceipt: PeriodReportBatchReceipt | null;
  readonly deliveryReceipt: PeriodReportBatchDelivery | null;
  readonly observation: PeriodReportBatchObservation | null;
  readonly updatedAt: string;
}

export interface PeriodReportBatchManifest {
  readonly manifestVersion: 1;
  readonly requestId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly actorAdminId: string;
  readonly event: TriggerEvent;
  readonly period: {
    readonly kind: FixedPeriod['kind'];
    readonly periodStart: string;
    readonly periodEnd: string;
  };
  readonly published: {
    readonly definitionId: string;
    readonly revision: number;
    readonly digest: string;
    readonly nodeVersions: Readonly<Record<string, string>>;
  };
  readonly receivers: readonly {
    readonly kind: PeriodReportBatchReceiverKind;
    readonly adminId: string | null;
    readonly runId: string;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: PeriodReportBatchState;
  readonly entries: readonly PeriodReportBatchEntry[];
  readonly reasons: readonly string[];
}

export interface PeriodReportBatchInput {
  readonly requestId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly actor: ConstructionActor;
  readonly event: TriggerEvent;
  readonly receivers: readonly PeriodReportBatchReceiver[];
  readonly loadPublished: () => Promise<PublishedWorkflowVersion>;
  readonly portsFor: (receiver: LivePeriodReceiver) => LiveOperationPorts;
  readonly runStore: LiveRunStore;
  readonly batchStore: PeriodReportBatchStore;
}

export interface PeriodReportBatchDependencies {
  readonly now?: () => Date;
  readonly preflight?: (
    input: PeriodReportBatchPreflightInput,
  ) => Promise<PeriodReportBatchPlanEvidence>;
  readonly authorize?: (input: PeriodReportBatchPreflightInput) => Promise<void>;
  readonly runReceiver?: (input: PeriodReportEntryInput) => Promise<PeriodReportEntryResult>;
  readonly observe?: (input: {
    readonly runId: string;
    readonly viewer: { readonly enterpriseId: string; readonly adminId: string };
  }) => Promise<PeriodReportRunObservation>;
}

export interface PeriodReportBatchResult {
  readonly manifest: PeriodReportBatchManifest;
  /** True when this call created the manifest and ran the first round. */
  readonly created: boolean;
  /** True when an existing request was only authorized and observed. */
  readonly observedOnly: boolean;
  readonly preflight: PeriodReportBatchPlanEvidence | null;
}

const RECEIVER_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'customer_receiver_unavailable',
  'worker_receiver_unavailable',
  'designer_receiver_unavailable',
  'boss_receiver_unavailable',
  'period_report_receiver_unavailable',
]);

/** A crashed coordinator's lease is taken over only after this window. */
const BATCH_LEASE_TTL_MS = 10 * 60_000;

function fail(code: string, status: number, message: string, details?: unknown): never {
  throw new WorkflowOperationError(code, status, message, details);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function assertReceiverShape(
  receivers: readonly PeriodReportBatchReceiver[],
): PeriodReportBatchReceiverIdentity[] {
  if (receivers.length !== BATCH_RECEIVER_ORDER.length) {
    fail(
      'period_report_batch_receivers_invalid',
      422,
      'the joint batch requires exactly customer, worker, designer and boss',
    );
  }
  return receivers.map((receiver, index) => {
    const expected = BATCH_RECEIVER_ORDER[index];
    if (receiver.kind !== expected) {
      fail(
        'period_report_batch_receivers_invalid',
        422,
        `receiver ${index + 1} must be ${expected}, not ${String(receiver.kind)}`,
      );
    }
    if (expected === 'customer') {
      if (receiver.adminId !== undefined) {
        fail(
          'period_report_batch_receivers_invalid',
          422,
          'the customer receiver is resolved from the project customer binding and must not carry an admin id',
        );
      }
      return { kind: expected, adminId: null };
    }
    if (!nonEmptyString(receiver.adminId) || !/^[1-9]\d{0,18}$/.test(receiver.adminId)) {
      fail(
        'period_report_batch_receivers_invalid',
        422,
        `the ${expected} receiver requires a positive admin id`,
      );
    }
    return { kind: expected, adminId: receiver.adminId };
  });
}

function assertExecutorSeparation(
  actor: ConstructionActor,
  receivers: readonly PeriodReportBatchReceiverIdentity[],
): void {
  const boss = receivers.find((receiver) => receiver.kind === 'boss');
  if (boss && boss.adminId === actor.adminId) {
    fail(
      'period_report_batch_receivers_invalid',
      422,
      'the boss receiver must differ from the management executor',
    );
  }
}

function subRunId(requestId: string, kind: PeriodReportBatchReceiverKind): string {
  const runId = `${requestId}-${kind}`;
  if (runId.length > 128) {
    fail(
      'period_report_batch_request_invalid',
      422,
      `batch request id ${JSON.stringify(requestId)} is too long for sub-run ids`,
    );
  }
  return runId;
}

function liveReceiver(identity: PeriodReportBatchReceiverIdentity): LivePeriodReceiver {
  return identity.kind === 'customer'
    ? { kind: 'customer' }
    : { kind: identity.kind, adminId: identity.adminId! };
}

function sameIdentity(
  left: PeriodReportBatchReceiverIdentity[],
  right: PeriodReportBatchReceiverIdentity[],
): boolean {
  return left.length === right.length
    && left.every((receiver, index) =>
      receiver.kind === right[index].kind && receiver.adminId === right[index].adminId);
}

function assertSameBatchIdentity(
  existing: PeriodReportBatchManifest,
  expected: {
    readonly requestId: string;
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly actorAdminId: string;
    readonly event: TriggerEvent;
    readonly published: PeriodReportBatchManifest['published'];
    readonly receivers: readonly PeriodReportBatchReceiverIdentity[];
  },
): void {
  const mismatches: string[] = [];
  if (existing.enterpriseId !== expected.enterpriseId) mismatches.push('enterpriseId');
  if (existing.projectId !== expected.projectId) mismatches.push('projectId');
  if (existing.actorAdminId !== expected.actorAdminId) mismatches.push('actorAdminId');
  if (existing.event.eventType !== expected.event.eventType) mismatches.push('eventType');
  if (existing.event.eventId !== expected.event.eventId) mismatches.push('eventId');
  if (existing.event.occurredAt !== expected.event.occurredAt) mismatches.push('occurredAt');
  if (existing.event.periodKind !== expected.event.periodKind) mismatches.push('periodKind');
  if (existing.event.periodStart !== expected.event.periodStart) mismatches.push('periodStart');
  if (existing.event.periodEnd !== expected.event.periodEnd) mismatches.push('periodEnd');
  if (existing.published.definitionId !== expected.published.definitionId) {
    mismatches.push('definitionId');
  }
  if (existing.published.revision !== expected.published.revision) {
    mismatches.push('definitionRevision');
  }
  if (existing.published.digest !== expected.published.digest) mismatches.push('digest');
  if (
    !sameNodeVersions(existing.published.nodeVersions, expected.published.nodeVersions)
  ) {
    mismatches.push('nodeVersions');
  }
  if (!sameIdentity(
    existing.receivers.map((receiver) => ({ kind: receiver.kind, adminId: receiver.adminId })),
    [...expected.receivers],
  )) {
    mismatches.push('receivers');
  }
  if (mismatches.length) {
    fail(
      'period_report_batch_conflict',
      409,
      `batch request ${expected.requestId} is already bound to a different ${mismatches.join(', ')}`,
      { requestId: expected.requestId, mismatches },
    );
  }
}

function sameNodeVersions(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftIds = Object.keys(left).sort();
  const rightIds = Object.keys(right).sort();
  return leftIds.length === rightIds.length
    && leftIds.every((nodeId, index) => nodeId === rightIds[index] && left[nodeId] === right[nodeId]);
}

function receiptObject(value: WorkflowValue | undefined): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function saveReceiptOf(record: LiveRunRecord): PeriodReportBatchReceipt | null {
  const operation = [...record.operations]
    .reverse()
    .find((candidate) => candidate.capabilityRef === 'save.period_report');
  const receipt = receiptObject(operation?.outputs?.saveReceipt);
  // `saved` is the operation's confirmation port; the receipt itself only
  // carries the report identity.
  if (!receipt || operation?.outcome !== 'succeeded' || operation.outputs?.saved !== true) {
    return null;
  }
  if (
    !nonEmptyString(receipt.reportId)
    || typeof receipt.revision !== 'number'
    || !nonEmptyString(receipt.runId)
    || !nonEmptyString(receipt.reportKey)
    || !nonEmptyString(receipt.bindingId)
    || !nonEmptyString(receipt.conversationId)
  ) {
    return null;
  }
  return {
    reportId: String(receipt.reportId),
    revision: Number(receipt.revision),
    runId: String(receipt.runId),
    reportKey: String(receipt.reportKey),
    bindingId: String(receipt.bindingId),
    conversationId: String(receipt.conversationId),
    reused: receipt.reused === true,
  };
}

function deliveryReceiptOf(record: LiveRunRecord): PeriodReportBatchDelivery | null {
  const operation = [...record.operations]
    .reverse()
    .find((candidate) => candidate.capabilityRef === 'deliver.inapp');
  const receipt = receiptObject(operation?.outputs?.deliveryReceipt);
  if (!receipt) return null;
  return {
    delivered: operation?.outputs?.delivered === true && receipt.status === 'delivered',
    status: nonEmptyString(receipt.status) ? String(receipt.status) : null,
    messageId: nonEmptyString(receipt.messageId) ? String(receipt.messageId) : null,
    conversationId: nonEmptyString(receipt.conversationId)
      ? String(receipt.conversationId)
      : null,
  };
}

/** A receiver status from the existing port failure message. */
function receiverStatusFromMessage(message: string): string {
  const match = /^period report receiver is (.+)$/u.exec(message.trim());
  return match ? match[1] : 'receiver_unavailable';
}

interface RecordClassification {
  readonly state: PeriodReportBatchEntryState;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly saveReceipt: PeriodReportBatchReceipt | null;
  readonly deliveryReceipt: PeriodReportBatchDelivery | null;
}

/**
 * Classify one finished sub-run from its immutable trace only.
 *
 * A real save receipt plus `delivery_not_confirmed` is asynchronous progress:
 * the existing Worker may still be processing. It is never a final failure and
 * is never rewritten as delivered. Any unknown outcome or any failure outside
 * that delivery wait blocks the rest of the batch.
 */
function classifyRunRecord(record: LiveRunRecord): RecordClassification {
  const saveReceipt = saveReceiptOf(record);
  const deliveryReceipt = deliveryReceiptOf(record);
  const unknownOperation = record.operations.find((operation) => operation.outcome === 'unknown');
  if (record.status === 'unknown' || unknownOperation) {
    return {
      state: 'unknown',
      reason: unknownOperation?.error?.code ?? record.state.error?.code ?? 'run_unknown',
      errorCode: unknownOperation?.error?.code ?? record.state.error?.code ?? null,
      saveReceipt,
      deliveryReceipt,
    };
  }
  if (record.status === 'running') {
    // The runner's exclusive first write persists before any port runs, so a
    // record still marked `running` proves the sub-run exists but never began.
    // Re-entry must not re-create or re-execute it (the runner would only
    // return this same record), and guessing success or failure would lie.
    return {
      state: 'unknown',
      reason: 'run_created_not_executed',
      errorCode: null,
      saveReceipt,
      deliveryReceipt,
    };
  }
  const failed = record.operations.filter((operation) => operation.outcome === 'failed');
  if (saveReceipt) {
    const blocking = failed.filter((operation) =>
      !(operation.capabilityRef === 'deliver.inapp'
        && operation.error?.code === 'delivery_not_confirmed'));
    if (blocking.length) {
      return {
        state: 'failed',
        reason: blocking[0]?.error?.code ?? 'operation_failed',
        errorCode: blocking[0]?.error?.code ?? null,
        saveReceipt,
        deliveryReceipt,
      };
    }
    return {
      state: record.status === 'completed' ? 'completed' : 'processing',
      reason: record.status === 'completed' ? null : 'delivery_pending',
      errorCode: null,
      saveReceipt,
      deliveryReceipt,
    };
  }
  const firstFailure = failed[0];
  if (firstFailure?.error?.code === 'period_report_receiver_unavailable') {
    return {
      state: 'unavailable',
      reason: receiverStatusFromMessage(firstFailure.error.message),
      errorCode: firstFailure.error.code,
      saveReceipt: null,
      deliveryReceipt,
    };
  }
  return {
    state: record.status === 'completed' ? 'completed' : 'failed',
    reason: firstFailure?.error?.code ?? record.state.error?.code ?? `run_${record.status}`,
    errorCode: firstFailure?.error?.code ?? record.state.error?.code ?? null,
    saveReceipt: null,
    deliveryReceipt,
  };
}

interface ErrorClassification {
  readonly state: 'unavailable' | 'failed' | 'unknown';
  readonly reason: string;
  readonly errorCode: string | null;
}

function classifyEntryError(error: unknown): ErrorClassification {
  if (error instanceof WorkflowOperationError) {
    if (RECEIVER_UNAVAILABLE_CODES.has(error.code)) {
      return { state: 'unavailable', reason: error.code, errorCode: error.code };
    }
    return { state: 'failed', reason: error.code, errorCode: error.code };
  }
  return {
    state: 'unknown',
    reason: error instanceof Error ? error.message.slice(0, 300) : 'live_operation_unknown',
    errorCode: null,
  };
}

/**
 * A reserved sub-runId may only recover the run this request reserved. A record
 * with another enterprise/project/event/target/receiver is a conflict, never a
 * recoverable sub-run, so a stray file cannot be adopted into this batch.
 */
function assertRecoverableRun(
  record: LiveRunRecord,
  manifest: PeriodReportBatchManifest,
  entry: PeriodReportBatchEntry,
): void {
  const mismatches: string[] = [];
  if (record.binding.runId !== entry.runId) mismatches.push('runId');
  if (record.enterpriseId !== manifest.enterpriseId) mismatches.push('enterpriseId');
  if (record.projectId !== manifest.projectId) mismatches.push('projectId');
  if (record.binding.definitionId !== manifest.published.definitionId) {
    mismatches.push('definitionId');
  }
  if (record.binding.revision !== manifest.published.revision) {
    mismatches.push('definitionRevision');
  }
  if (record.binding.digest !== manifest.published.digest) mismatches.push('digest');
  if (!sameNodeVersions(record.binding.nodeVersions, manifest.published.nodeVersions)) {
    mismatches.push('nodeVersions');
  }
  const event = record.binding.event;
  if (event.eventId !== manifest.event.eventId) mismatches.push('eventId');
  if (event.eventType !== manifest.event.eventType) mismatches.push('eventType');
  if (event.occurredAt !== manifest.event.occurredAt) mismatches.push('occurredAt');
  if (event.periodKind !== manifest.event.periodKind) mismatches.push('periodKind');
  if (event.periodStart !== manifest.event.periodStart) mismatches.push('periodStart');
  if (event.periodEnd !== manifest.event.periodEnd) mismatches.push('periodEnd');
  const business = record.binding.businessEvent;
  if (
    business.periodKind !== manifest.event.periodKind
    || business.periodStart !== manifest.event.periodStart
    || business.periodEnd !== manifest.event.periodEnd
  ) {
    mismatches.push('businessEvent');
  }
  const receiver = business.receiver;
  if (entry.kind === 'customer') {
    if (receiver !== undefined) mismatches.push('receiver');
  } else if (receiver?.kind !== entry.kind || (receiver.adminId ?? null) !== entry.adminId) {
    mismatches.push('receiver');
  }
  if (mismatches.length) {
    fail(
      'period_report_batch_conflict',
      409,
      `run ${entry.runId} is already bound to a different ${mismatches.join(', ')}`,
      { requestId: manifest.requestId, runId: entry.runId, mismatches },
    );
  }
}

function observationSummary(observation: PeriodReportRunObservation): PeriodReportBatchObservation {
  const progress = observation.progress;
  return {
    observedAt: observation.observedAt,
    bound: observation.bound,
    overall: progress?.overall ?? null,
    reasons: progress?.reasons ?? observation.reasons,
    availability: progress?.availability.state ?? null,
    availabilityReason: progress?.availability.reason ?? null,
    factsState: progress?.facts.state ?? null,
    bodyState: progress?.body.state ?? null,
    deliveryState: progress?.delivery.state ?? null,
    deliveryMessageId: progress?.delivery.messageId ?? null,
    deliveryConversationId: progress?.delivery.conversationId ?? null,
  };
}

function stateFromOverall(
  overall: PeriodOverallState,
): { state: PeriodReportBatchEntryState; reason: string | null } {
  if (overall === 'completed') return { state: 'completed', reason: null };
  if (overall === 'processing') {
    return { state: 'processing', reason: 'delivery_pending' };
  }
  if (overall === 'stopped') return { state: 'stopped', reason: 'delivery_stopped' };
  if (overall === 'unavailable') return { state: 'unavailable', reason: 'access_unavailable' };
  if (overall === 'failed') return { state: 'failed', reason: 'report_failed' };
  return { state: 'unknown', reason: 'status_unknown' };
}

function observationReceipt(
  observation: PeriodReportRunObservation,
): PeriodReportBatchReceipt | null {
  const binding = observation.binding;
  if (!observation.bound || !binding) return null;
  return {
    reportId: binding.reportId,
    revision: binding.reportRevision,
    runId: binding.factsRunId,
    reportKey: binding.reportKey,
    bindingId: binding.bindingId,
    conversationId: binding.conversationId,
    reused: binding.savedReused,
  };
}

function observationDelivery(
  observation: PeriodReportRunObservation,
): PeriodReportBatchDelivery | null {
  if (!observation.bound || !observation.progress) return null;
  const delivery = observation.progress.delivery;
  return {
    delivered: delivery.state === 'delivered',
    status: delivery.deliveryState,
    messageId: delivery.messageId,
    conversationId: delivery.conversationId,
  };
}

function batchState(entries: readonly PeriodReportBatchEntry[]): PeriodReportBatchState {
  if (entries.some((entry) => entry.state === 'failed')) return 'failed';
  if (entries.some((entry) => entry.state === 'unknown')) return 'unknown';
  if (entries.every((entry) => entry.state === 'completed')) return 'completed';
  if (entries.some((entry) => entry.state === 'processing')) return 'processing';
  if (entries.some((entry) =>
    entry.state === 'unavailable' || entry.state === 'stopped')) {
    return 'partial';
  }
  return 'failed';
}

function batchReasons(entries: readonly PeriodReportBatchEntry[]): string[] {
  const reasons = entries
    .filter((entry) => entry.state !== 'completed')
    .map((entry) => `${entry.kind}:${entry.reason ?? entry.state}`);
  return [...new Set(reasons)];
}

function withEntry(
  manifest: PeriodReportBatchManifest,
  index: number,
  entry: PeriodReportBatchEntry,
  at: string,
): PeriodReportBatchManifest {
  const entries = manifest.entries.map((candidate, candidateIndex) =>
    candidateIndex === index ? entry : candidate);
  return {
    ...manifest,
    updatedAt: at,
    status: batchState(entries),
    entries,
    reasons: batchReasons(entries),
  };
}

function initialEntry(
  receiver: PeriodReportBatchReceiverIdentity,
  runId: string,
  at: string,
): PeriodReportBatchEntry {
  return {
    kind: receiver.kind,
    adminId: receiver.adminId,
    runId,
    executed: false,
    state: 'not_started',
    reason: null,
    errorCode: null,
    saveReceipt: null,
    deliveryReceipt: null,
    observation: null,
    updatedAt: at,
  };
}

/** Observe every executed sub-run; never executes ports or writes business rows. */
async function observeEntries(
  manifest: PeriodReportBatchManifest,
  observe: NonNullable<PeriodReportBatchDependencies['observe']>,
  viewer: { readonly enterpriseId: string; readonly adminId: string },
  now: () => Date,
  batchStore: PeriodReportBatchStore,
): Promise<PeriodReportBatchManifest> {
  let current = manifest;
  for (let index = 0; index < current.entries.length; index += 1) {
    const entry = current.entries[index];
    if (!entry.executed) continue;
    const at = now().toISOString();
    let next: PeriodReportBatchEntry;
    try {
      const observation = await observe({ runId: entry.runId, viewer });
      const summary = observationSummary(observation);
      // A failed or unknown workflow trace stays authoritative: a later
      // business read may add evidence but never turns it into a clean success.
      const protectedState = entry.state === 'failed' || entry.state === 'unknown';
      const mapped = protectedState
        ? { state: entry.state, reason: entry.reason }
        : observation.bound && observation.progress
          ? stateFromOverall(observation.progress.overall)
          : { state: entry.state, reason: entry.reason };
      const mappedReason = mapped.state === 'completed'
        ? null
        : mapped.state === 'unavailable' && summary.availabilityReason
          ? summary.availabilityReason
          : mapped.reason ?? (summary.reasons.length ? summary.reasons.join(',') : entry.reason);
      const observedDelivery = observationDelivery(observation);
      next = {
        ...entry,
        state: mapped.state,
        reason: mappedReason,
        errorCode: entry.errorCode,
        saveReceipt: entry.saveReceipt ?? observationReceipt(observation),
        // The original raw trace may honestly end at delivery_not_confirmed.
        // A bound business observation is the current receipt; keep the old
        // one only while the observation is unbound.
        deliveryReceipt: observedDelivery ?? entry.deliveryReceipt,
        observation: summary,
        updatedAt: at,
      };
    } catch (error) {
      const code = error instanceof WorkflowOperationError ? error.code : 'status_read_failed';
      next = {
        ...entry,
        state: entry.state === 'not_started' ? 'unknown' : entry.state,
        reason: entry.reason ?? code,
        errorCode: entry.errorCode ?? (error instanceof WorkflowOperationError ? code : null),
        updatedAt: at,
      };
    }
    current = withEntry(current, index, next, at);
    current = await batchStore.update(current);
  }
  return current;
}

/**
 * Run or observe one host-fixed four-receiver period report action.
 *
 * A brand-new request preflights the executor/plan, creates the host manifest
 * and executes the receivers in the fixed order. A repeated request authorizes
 * the executor, recovers every sub-run that exists in the real run store and
 * only dispatches receivers that provably never started: no second report,
 * task, message or provider call is started for an existing sub-run.
 */
export async function runPeriodReportBatch(
  input: PeriodReportBatchInput,
  dependencies: PeriodReportBatchDependencies = {},
): Promise<PeriodReportBatchResult> {
  const now = dependencies.now ?? (() => new Date());
  assertBatchRequestId(input.requestId);
  const receivers = assertReceiverShape(input.receivers);
  assertExecutorSeparation(input.actor, receivers);

  // The fixed period and the published target are checked before any host
  // manifest, binding or business write, exactly like the single entry.
  const period = parseFixedPeriod(input.event, now());
  const published = await input.loadPublished();
  resolvePublishedTarget(published, input.event);

  const publishedIdentity = {
    definitionId: published.definition.definitionId,
    revision: published.revision,
    digest: published.digest,
    nodeVersions: published.nodeVersions,
  };
  const expectedIdentity = {
    requestId: input.requestId,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
    actorAdminId: input.actor.adminId,
    event: input.event,
    published: publishedIdentity,
    receivers,
  };
  const preflightInput: PeriodReportBatchPreflightInput = {
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
    actor: input.actor,
    receivers: input.receivers,
  };
  const authorize = dependencies.authorize ?? assertPeriodReportBatchExecutor;
  const observe = dependencies.observe ?? ((options) => readPeriodReportRunStatus({
    ...options,
    runStore: input.runStore,
    now,
  }));
  const runReceiver = dependencies.runReceiver ?? runPeriodReportEntry;

  let manifest: PeriodReportBatchManifest;
  let created = false;
  let preflight: PeriodReportBatchPlanEvidence | null = null;
  const existing = await input.batchStore.get(input.requestId);
  if (existing) {
    assertSameBatchIdentity(existing, expectedIdentity);
    await authorize(preflightInput);
    manifest = existing;
  } else {
    preflight = await (dependencies.preflight ?? assertPeriodReportBatchPlan)(preflightInput);
    const createdAt = now().toISOString();
    const initial: PeriodReportBatchManifest = {
      manifestVersion: 1,
      requestId: input.requestId,
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      actorAdminId: input.actor.adminId,
      event: structuredClone(input.event),
      period: {
        kind: period.kind,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
      published: publishedIdentity,
      receivers: receivers.map((receiver) => ({
        kind: receiver.kind,
        adminId: receiver.adminId,
        runId: subRunId(input.requestId, receiver.kind),
      })),
      createdAt,
      updatedAt: createdAt,
      status: 'running',
      entries: receivers.map((receiver) =>
        initialEntry(receiver, subRunId(input.requestId, receiver.kind), createdAt)),
      reasons: [],
    };
    const first = await input.batchStore.create(initial);
    if (!first.created) {
      assertSameBatchIdentity(first.manifest, expectedIdentity);
      await authorize(preflightInput);
      manifest = first.manifest;
      preflight = null;
    } else {
      manifest = first.manifest;
      created = true;
    }
  }

  // Only one host process may recover or dispatch this request. A stale lease
  // from a crashed process is taken over after its TTL; until then a concurrent
  // caller returns the manifest as stored and starts nothing.
  const leaseOwner = `${process.pid}:${randomUUID()}`;
  const leased = await input.batchStore.acquire(input.requestId, {
    owner: leaseOwner,
    now,
    ttlMs: BATCH_LEASE_TTL_MS,
  });
  if (!leased) {
    return { manifest, created, observedOnly: true, preflight };
  }

  try {
    const advanced = await advanceBatch({
      manifest,
      input,
      receivers,
      published,
      now,
      runReceiver,
    });
    const observed = await observeEntries(
      advanced.manifest,
      observe,
      { enterpriseId: input.enterpriseId, adminId: input.actor.adminId },
      now,
      input.batchStore,
    );
    return {
      manifest: observed,
      created,
      observedOnly: !created && !advanced.dispatched,
      preflight,
    };
  } finally {
    // The TTL is the fallback if this release cannot run; hiding a release
    // error must not turn an already committed recovery into a failed request.
    await input.batchStore.release(input.requestId, leaseOwner).catch(() => undefined);
  }
}

interface AdvanceBatchInput {
  readonly manifest: PeriodReportBatchManifest;
  readonly input: PeriodReportBatchInput;
  readonly receivers: readonly PeriodReportBatchReceiverIdentity[];
  readonly published: PublishedWorkflowVersion;
  readonly now: () => Date;
  readonly runReceiver: (input: PeriodReportEntryInput) => Promise<PeriodReportEntryResult>;
}

/**
 * Reconcile one manifest with the real run store, then dispatch only receivers
 * whose reserved sub-run provably never started.
 *
 * The manifest's `executed` flag is not evidence: a crash between the run's
 * exclusive create and the manifest write leaves it false while the sub-run
 * exists. Every reserved runId is therefore looked up first. An existing run is
 * classified from its immutable trace (never re-created, re-enqueued, re-composed
 * or re-delivered), `running` stays unresolved, and `failed`/`unknown` stay
 * blocking. A receiver is dispatched only when its run is absent and this same
 * manifest never recorded a previous attempt for it.
 */
async function advanceBatch(input: AdvanceBatchInput): Promise<{
  manifest: PeriodReportBatchManifest;
  dispatched: boolean;
}> {
  let current = input.manifest;
  let blocked = false;
  let dispatched = false;
  for (let index = 0; index < input.receivers.length; index += 1) {
    const at = input.now().toISOString();
    const entry = current.entries[index];
    if (blocked) {
      if (!entry.executed && entry.state === 'not_started' && entry.reason !== 'batch_blocked') {
        current = await input.input.batchStore.update(withEntry(current, index, {
          ...entry,
          reason: 'batch_blocked',
          updatedAt: at,
        }, at));
      }
      continue;
    }
    const record = await input.input.runStore.get(entry.runId);
    if (record) {
      assertRecoverableRun(record, current, entry);
      const classification = classifyRunRecord(record);
      const recovered: PeriodReportBatchEntry = {
        ...entry,
        executed: true,
        state: classification.state,
        reason: classification.reason,
        errorCode: classification.errorCode,
        // The run trace owns a receipt it actually produced; a receipt already
        // recorded in the manifest is never dropped by an interrupted trace.
        saveReceipt: classification.saveReceipt ?? entry.saveReceipt,
        deliveryReceipt: classification.deliveryReceipt ?? entry.deliveryReceipt,
        updatedAt: at,
      };
      current = await input.input.batchStore.update(withEntry(current, index, recovered, at));
      if (recovered.state === 'failed' || recovered.state === 'unknown') blocked = true;
      continue;
    }
    if (entry.executed) {
      // The manifest recorded execution but the trace vanished. Re-dispatching
      // could duplicate an effect whose outcome can no longer be read.
      if (entry.state === 'failed' || entry.state === 'unknown') blocked = true;
      continue;
    }
    if (entry.state !== 'not_started' || entry.reason !== null) {
      // A previous attempt failed before it created a run (an unavailable
      // staff/boss receiver, for example). That persisted attempt blocks a
      // second dispatch; it is not a missing receiver.
      if (entry.state === 'failed' || entry.state === 'unknown') blocked = true;
      continue;
    }

    const receiver = liveReceiver(input.receivers[index]);
    let next: PeriodReportBatchEntry;
    dispatched = true;
    try {
      const result = await input.runReceiver({
        loadPublished: async () => input.published,
        enterpriseId: input.input.enterpriseId,
        projectId: input.input.projectId,
        actor: input.input.actor,
        event: input.input.event,
        receiver,
        ports: input.input.portsFor(receiver),
        store: input.input.runStore,
        runId: entry.runId,
      });
      const classification = classifyRunRecord(result.record);
      next = {
        ...entry,
        executed: true,
        state: classification.state,
        reason: classification.reason,
        errorCode: classification.errorCode,
        saveReceipt: classification.saveReceipt,
        deliveryReceipt: classification.deliveryReceipt,
        updatedAt: at,
      };
      if (classification.state === 'failed' || classification.state === 'unknown') blocked = true;
    } catch (error) {
      const classification = classifyEntryError(error);
      next = {
        ...entry,
        executed: false,
        state: classification.state,
        reason: classification.reason,
        errorCode: classification.errorCode,
        updatedAt: at,
      };
      if (classification.state === 'failed' || classification.state === 'unknown') blocked = true;
    }
    current = await input.input.batchStore.update(withEntry(current, index, next, at));
  }
  return { manifest: current, dispatched };
}
