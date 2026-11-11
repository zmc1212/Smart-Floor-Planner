/** B5.3 read-only status contract for one period-report workflow run.
 *
 * The contract separates three things that must never be conflated:
 * - the immutable workflow run record (definition/revision/digest and the raw
 *   operation trace, including an honest delivery_not_confirmed while the
 *   Worker is still processing);
 * - the current business progress read from construction_reports,
 *   construction_report_versions, the facts/body runs and jobs and the delivery
 *   receipt;
 * - the current source/access availability rules owned by the construction
 *   report service.
 *
 * Nothing in this file writes business data or re-executes ports. Implemented
 * by the B5.3 status reader; this file only freezes the shared shapes.
 */
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import {
  followupAvailable,
  projectReportFacts,
  type ReportFacts,
} from '@/lib/construction/report-scope';
import { WorkflowOperationError } from '../errors';
import { isPlainObject } from '../guards';
import { readProjectAccess } from './project-access';
import { resolveNativeWorkflowRunDir } from './run-dir';
import { createFileWorkflowRunStore } from './run-store';
import type { LiveRunRecord, LiveRunStatus } from './types';

export const PERIOD_REPORT_STATUS_CONTRACT = 'period-report-run-status-v1';

/** Period kinds the B-line report adapter can bind. */
export type PeriodKind = 'daily' | 'weekly';

export type PeriodStepState = 'queued' | 'running' | 'ready' | 'failed' | 'unknown';

export type PeriodDeliveryState = 'waiting' | 'delivered' | 'revoked' | 'muted' | 'unknown';

export type PeriodAvailabilityState =
  | 'available'
  | 'access_revoked'
  | 'source_unavailable'
  | 'unknown';

export type PeriodOverallState =
  | 'queued'
  | 'processing'
  | 'completed'
  /** Facts and body are ready, but delivery is muted/revoked: no more work. */
  | 'stopped'
  | 'failed'
  | 'unknown'
  | 'unavailable';

export interface PeriodRunBindingView {
  readonly runId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  /** Filled from the current project row; never from the definition. */
  readonly projectName: string;
  readonly definitionId: string;
  readonly definitionRevision: number;
  readonly digest: string;
  readonly periodKind: PeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly reportId: string;
  readonly reportRevision: number;
  readonly reportKey: string;
  readonly factsRunId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly savedReused: boolean;
}

export interface PeriodJobView {
  readonly jobId: string | null;
  readonly status: string | null;
  readonly attempts: number;
  readonly providerStartedAt: string | null;
}

export interface PeriodFactsView {
  readonly state: PeriodStepState;
  readonly runId: string;
  readonly runStatus: string | null;
  readonly versionStatus: string | null;
  readonly generatedAt: string | null;
  readonly errorCode: string | null;
  readonly job: PeriodJobView;
}

export interface PeriodBodyView {
  readonly state: 'waiting' | PeriodStepState;
  readonly runId: string | null;
  readonly runStatus: string | null;
  readonly knowledgeStatus: string | null;
  readonly generatedAt: string | null;
  readonly errorCode: string | null;
  readonly job: PeriodJobView;
}

export interface PeriodDeliveryView {
  readonly state: PeriodDeliveryState;
  readonly deliveryState: string | null;
  readonly messageId: string | null;
  readonly conversationId: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
}

export interface PeriodAvailabilityView {
  readonly state: PeriodAvailabilityState;
  readonly reason: string;
}

export interface PeriodRawOperation {
  readonly nodeId: string;
  readonly capabilityRef: string;
  readonly outcome: 'succeeded' | 'failed' | 'unknown';
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/** Immutable workflow evidence; a new published revision never rewrites it. */
export interface PeriodRawRunView {
  readonly status: LiveRunStatus;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly updatedAt: string;
  readonly operations: readonly PeriodRawOperation[];
}

export interface PeriodReportProgress {
  readonly overall: PeriodOverallState;
  readonly completed: boolean;
  readonly processing: boolean;
  readonly facts: PeriodFactsView;
  readonly body: PeriodBodyView;
  readonly delivery: PeriodDeliveryView;
  readonly availability: PeriodAvailabilityView;
  readonly reasons: readonly string[];
}

/** API response. `bound:false` means no confirmed save receipt exists yet. */
export interface PeriodReportRunObservation {
  readonly contract: typeof PERIOD_REPORT_STATUS_CONTRACT;
  readonly observedAt: string;
  readonly bound: boolean;
  readonly binding: PeriodRunBindingView | null;
  readonly progress: PeriodReportProgress | null;
  readonly raw: PeriodRawRunView;
  readonly reasons: readonly string[];
}

/** Raw rows read inside the tenant transaction. No row is mutated. */
export interface PeriodReportBusinessSnapshot {
  readonly report: {
    readonly id: string;
    readonly binding_id: string;
    readonly report_key: string;
    readonly kind: string;
    readonly period_start: string;
    readonly period_end: string;
    readonly latest_revision: number;
  } | null;
  readonly version: {
    readonly revision: number;
    readonly status: string;
    readonly generated_at: string | null;
    readonly body_present: boolean;
    readonly knowledge_status: string;
    readonly body_run_id: string | null;
    readonly body_error_code: string | null;
    readonly body_attempts: number;
  } | null;
  readonly factsRun: {
    readonly id: string;
    readonly status: string;
    readonly error_code: string | null;
  } | null;
  readonly factsJob: PeriodJobView | null;
  readonly bodyRun: {
    readonly id: string;
    readonly status: string;
    readonly error_code: string | null;
  } | null;
  readonly bodyJob: PeriodJobView | null;
  readonly delivery: {
    readonly state: string;
    readonly message_id: string | null;
    readonly delivered_at: string | null;
    readonly read_at: string | null;
  } | null;
  readonly message: {
    readonly id: string;
    readonly conversation_id: string;
    readonly purpose: string;
    readonly seq: string | null;
  } | null;
  readonly binding: {
    readonly id: string;
    readonly project_id: string;
    readonly conversation_id: string;
    readonly audience: string;
    readonly status: string;
    readonly user_id: string | null;
  } | null;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly customer_access: boolean;
    readonly current_stage_key: string | null;
  } | null;
  readonly conversation: {
    readonly id: string;
    readonly status: string;
    readonly retention_redacted: boolean;
  } | null;
  readonly followup_available: boolean;
  /** Project ids still valid under the existing report facts/scope rules. */
  readonly source_project_ids: readonly string[];
  /** Non-null when the read itself could not complete inside the transaction. */
  readonly read_error: string | null;
}

export interface PeriodReportStatusReaderOptions {
  readonly runId: string;
  readonly viewer: { readonly enterpriseId: string; readonly adminId: string };
  readonly runStore?: import('./types').LiveRunStore;
  readonly loadSnapshot?: (
    transaction: import('@/db/transaction').PostgresTransaction,
    binding: PeriodRunBindingView,
  ) => Promise<PeriodReportBusinessSnapshot>;
  /**
   * Offline seam for the unbound path only. Production omits it and the reader
   * runs the real project authorization; tests may inject it because they have
   * no tenant transaction. It is never an authorization proof for the route.
   */
  readonly authorizeUnbound?: (scope: {
    readonly enterpriseId: string;
    readonly adminId: string;
    readonly projectId: string;
  }) => Promise<void>;
  readonly now?: () => Date;
}

export type PeriodReportRunStoreRecord = LiveRunRecord;

// ---------------------------------------------------------------------------
// Implementation (B5.3)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The injected snapshot loader is an offline seam: it must not use this value. */
const INJECTED_TRANSACTION = {} as PostgresTransaction;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function uniqueReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons)];
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function emptyJob(): PeriodJobView {
  return { jobId: null, status: null, attempts: 0, providerStartedAt: null };
}

function jobView(row: Row | null | undefined): PeriodJobView {
  if (!row) return emptyJob();
  return {
    jobId: text(row.id),
    status: text(row.status),
    attempts: Number(row.attempts ?? 0),
    providerStartedAt: iso(row.provider_started_at),
  };
}

function emptySnapshot(readError: string | null): PeriodReportBusinessSnapshot {
  return {
    report: null,
    version: null,
    factsRun: null,
    factsJob: null,
    bodyRun: null,
    bodyJob: null,
    delivery: null,
    message: null,
    binding: null,
    project: null,
    conversation: null,
    followup_available: false,
    source_project_ids: [],
    read_error: readError,
  };
}

function supportedPeriodKind(value: unknown): value is PeriodKind {
  return value === 'daily' || value === 'weekly';
}

/** Shanghai midnight of a YYYY-MM-DD calendar date, in epoch milliseconds. */
function shanghaiMidnight(day: string): number | null {
  if (!CALENDAR_DAY.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) - SHANGHAI_OFFSET_MS;
}

/**
 * The stored report boundary for a period: the Shanghai midnight of
 * `periodEnd`. A daily period end is exclusive (next midnight); a weekly
 * period end already names the exclusive next Monday.
 */
function periodEndInstant(periodEnd: string, kind: PeriodKind): number | null {
  const midnight = shanghaiMidnight(periodEnd);
  if (midnight === null) return null;
  return kind === 'weekly' ? midnight : midnight + DAY_MS;
}

function instantMatches(value: string, expected: number | null): boolean {
  if (expected === null) return false;
  const actual = new Date(value).getTime();
  return Number.isFinite(actual) && actual === expected;
}

/**
 * Extract the immutable run binding from the last save operation. This is pure:
 * no clock, no storage, no database. The receipt is the only place where the
 * report identity and the saved-reuse flag are allowed to come from.
 */
export function extractPeriodReportRunBinding(record: LiveRunRecord): {
  ok: boolean;
  reasons: readonly string[];
  binding: PeriodRunBindingView | null;
} {
  const reasons: string[] = [];
  const event = record.binding.event;
  const business = record.binding.businessEvent;

  if (!nonEmptyString(record.binding.runId)) reasons.push('run_id_missing');
  if (!nonEmptyString(record.enterpriseId)) reasons.push('enterprise_id_missing');
  if (!nonEmptyString(record.projectId)) reasons.push('project_id_missing');
  if (!nonEmptyString(record.binding.definitionId)) reasons.push('definition_id_missing');
  if (!positiveInteger(record.binding.revision)) reasons.push('definition_revision_invalid');
  if (!nonEmptyString(record.binding.digest)) reasons.push('digest_missing');

  if (event.eventType !== 'period_report') reasons.push('period_event_mismatch');
  const eventKind = event.periodKind;
  const confirmedKind = supportedPeriodKind(business.periodKind) ? business.periodKind : null;
  if (confirmedKind === null || !supportedPeriodKind(eventKind)) {
    reasons.push('period_kind_unsupported');
  } else if (eventKind !== confirmedKind) {
    reasons.push('period_event_mismatch');
  }
  if (
    !nonEmptyString(event.periodStart)
    || !nonEmptyString(event.periodEnd)
    || event.periodStart !== business.periodStart
    || event.periodEnd !== business.periodEnd
  ) {
    reasons.push('period_event_mismatch');
  }

  const lastSave = [...record.operations]
    .reverse()
    .find((operation) => operation.capabilityRef === 'save.period_report');
  if (!lastSave || lastSave.outcome !== 'succeeded') {
    reasons.push('save_not_succeeded');
    return { ok: false, reasons: uniqueReasons(reasons), binding: null };
  }

  const receipt = lastSave.outputs?.saveReceipt;
  if (!isPlainObject(receipt)) {
    reasons.push('save_receipt_missing');
    return { ok: false, reasons: uniqueReasons(reasons), binding: null };
  }
  if (receipt.simulated !== false) reasons.push('save_simulated');
  if (!nonEmptyString(receipt.reportId)) reasons.push('report_id_missing');
  if (!positiveInteger(receipt.revision)) reasons.push('report_revision_invalid');
  if (!nonEmptyString(receipt.runId)) reasons.push('facts_run_id_missing');
  if (!nonEmptyString(receipt.reportKey)) reasons.push('report_key_missing');
  if (!nonEmptyString(receipt.bindingId)) reasons.push('binding_id_missing');
  if (!nonEmptyString(receipt.conversationId)) reasons.push('conversation_id_missing');
  if (typeof receipt.reused !== 'boolean') reasons.push('save_receipt_invalid');
  if (reasons.length) {
    return { ok: false, reasons: uniqueReasons(reasons), binding: null };
  }

  return {
    ok: true,
    reasons: [],
    binding: {
      runId: record.binding.runId,
      enterpriseId: record.enterpriseId,
      projectId: record.projectId,
      // The reader fills this from the current project row, never the definition.
      projectName: '',
      definitionId: record.binding.definitionId,
      definitionRevision: record.binding.revision,
      digest: record.binding.digest,
      // The confirmed business event owns the kind; the event must agree.
      periodKind: confirmedKind ?? 'daily',
      periodStart: event.periodStart!,
      periodEnd: event.periodEnd!,
      reportId: String(receipt.reportId),
      reportRevision: Number(receipt.revision),
      reportKey: String(receipt.reportKey),
      factsRunId: String(receipt.runId),
      bindingId: String(receipt.bindingId),
      conversationId: String(receipt.conversationId),
      savedReused: receipt.reused === true,
    },
  };
}

function isFailedStatus(status: string | null): boolean {
  return status === 'failed' || status === 'cancelled';
}

function isUnknownStatus(status: string | null): boolean {
  return status === 'indeterminate' || status === 'unknown';
}

function mapFactsStep(
  binding: PeriodRunBindingView,
  version: NonNullable<PeriodReportBusinessSnapshot['version']>,
  run: NonNullable<PeriodReportBusinessSnapshot['factsRun']> | null,
  job: PeriodJobView | null,
): PeriodFactsView {
  const runStatus = run?.status ?? null;
  const jobStatus = job?.status ?? null;
  let state: PeriodStepState;
  if (isUnknownStatus(runStatus) || isUnknownStatus(jobStatus)) {
    state = 'unknown';
  } else if (isFailedStatus(runStatus) || isFailedStatus(jobStatus)) {
    state = 'failed';
  } else if (
    version.status === 'queued'
    && (runStatus === null || runStatus === 'queued')
    && (jobStatus === null || jobStatus === 'queued')
  ) {
    state = 'queued';
  } else if (version.status === 'facts_ready' && runStatus === 'succeeded') {
    state = 'ready';
  } else if (runStatus === 'running' || jobStatus === 'running') {
    state = 'running';
  } else if (version.status !== 'facts_ready') {
    state = 'running';
  } else {
    state = 'unknown';
  }
  return {
    state,
    runId: run?.id ?? binding.factsRunId,
    runStatus,
    versionStatus: version.status,
    generatedAt: version.generated_at,
    errorCode: run?.error_code ?? null,
    job: job ?? emptyJob(),
  };
}

function mapBodyStep(
  version: NonNullable<PeriodReportBusinessSnapshot['version']>,
  run: NonNullable<PeriodReportBusinessSnapshot['bodyRun']> | null,
  job: PeriodJobView | null,
): PeriodBodyView {
  const runStatus = run?.status ?? null;
  const jobStatus = job?.status ?? null;
  let state: PeriodBodyView['state'];
  if (!version.body_run_id) {
    // Facts admission can fail before a body run exists; the version still
    // carries knowledge_status='failed' and body_error_code. That is a
    // confirmed failure, not a normal wait.
    state = version.knowledge_status === 'failed' || version.body_error_code
      ? 'failed'
      : 'waiting';
  } else if (!run) {
    // The version points at a body run that no longer exists: this is an
    // unknown outcome, not a normal wait.
    state = 'unknown';
  } else if (
    isUnknownStatus(runStatus)
    || isUnknownStatus(jobStatus)
    || (version.knowledge_status === 'ready' && !version.body_present)
  ) {
    state = 'unknown';
  } else if (
    isFailedStatus(runStatus)
    || isFailedStatus(jobStatus)
    || version.knowledge_status === 'failed'
  ) {
    state = 'failed';
  } else if (version.knowledge_status === 'ready' && version.body_present) {
    state = 'ready';
  } else if (runStatus === 'running' || jobStatus === 'running') {
    state = 'running';
  } else if (
    runStatus === 'queued'
    || jobStatus === 'queued'
    || (version.knowledge_status === 'queued' && runStatus === 'succeeded')
  ) {
    state = 'queued';
  } else {
    state = 'unknown';
  }
  return {
    state,
    runId: version.body_run_id ?? run?.id ?? null,
    runStatus,
    knowledgeStatus: version.knowledge_status,
    // The frozen snapshot has no body timestamp; never borrow the facts time.
    generatedAt: null,
    errorCode: run?.error_code ?? version.body_error_code ?? null,
    job: job ?? emptyJob(),
  };
}

function mapDeliveryStep(
  binding: PeriodRunBindingView,
  snapshot: PeriodReportBusinessSnapshot,
): PeriodDeliveryView {
  const delivery = snapshot.delivery;
  if (!delivery) {
    return {
      state: 'waiting',
      deliveryState: null,
      messageId: null,
      conversationId: null,
      deliveredAt: null,
      readAt: null,
    };
  }
  const view = {
    deliveryState: delivery.state,
    messageId: delivery.message_id,
    conversationId: snapshot.message?.conversation_id ?? null,
    deliveredAt: delivery.delivered_at,
    readAt: delivery.read_at,
  };
  if (delivery.state === 'pending' || delivery.state === 'held') {
    return { ...view, state: 'waiting' };
  }
  if (delivery.state === 'delivered') {
    const message = snapshot.message;
    const confirmed = nonEmptyString(delivery.message_id)
      && message !== null
      && message.id === delivery.message_id
      && message.conversation_id === binding.conversationId
      && message.purpose === 'construction.report.facts';
    return { ...view, state: confirmed ? 'delivered' : 'unknown' };
  }
  if (delivery.state === 'revoked') return { ...view, state: 'revoked' };
  if (delivery.state === 'muted') return { ...view, state: 'muted' };
  return { ...view, state: 'unknown' };
}

function mapAvailability(
  binding: PeriodRunBindingView,
  snapshot: PeriodReportBusinessSnapshot,
  factsReady: boolean,
): PeriodAvailabilityView {
  if (snapshot.read_error) return { state: 'unknown', reason: 'read_error' };
  const record = snapshot.binding;
  if (!record) return { state: 'access_revoked', reason: 'binding_missing' };
  if (record.status !== 'enabled') return { state: 'access_revoked', reason: 'binding_disabled' };
  if (record.audience !== 'customer') {
    return { state: 'access_revoked', reason: 'audience_not_customer' };
  }
  // Deleting a follow-up and explicitly resuming it reuses the same binding row
  // with a new conversation. The save receipt still points at the old
  // generation, so the old report must not be projected as available again.
  if (record.conversation_id !== binding.conversationId) {
    return { state: 'access_revoked', reason: 'binding_generation_changed' };
  }
  const conversation = snapshot.conversation;
  if (!conversation) return { state: 'access_revoked', reason: 'conversation_missing' };
  if (conversation.retention_redacted) {
    return { state: 'access_revoked', reason: 'conversation_redacted' };
  }
  const project = snapshot.project;
  if (!project) return { state: 'access_revoked', reason: 'project_missing' };
  if (project.customer_access !== true) {
    return { state: 'access_revoked', reason: 'customer_access_revoked' };
  }
  if (snapshot.followup_available !== true) {
    return { state: 'access_revoked', reason: 'followup_unavailable' };
  }
  if (
    factsReady
    && (snapshot.source_project_ids.length === 0
      || !snapshot.source_project_ids.includes(binding.projectId))
  ) {
    return { state: 'source_unavailable', reason: 'source_project_revoked' };
  }
  return { state: 'available', reason: 'available' };
}

function bindingMismatchReasons(
  binding: PeriodRunBindingView,
  snapshot: PeriodReportBusinessSnapshot,
): string[] {
  const reasons: string[] = [];
  const report = snapshot.report;
  if (!report) {
    reasons.push('report_missing');
  } else {
    if (report.id !== binding.reportId || report.binding_id !== binding.bindingId) {
      reasons.push('report_binding_mismatch');
    }
    if (report.report_key !== binding.reportKey) {
      reasons.push('report_binding_mismatch');
      reasons.push('report_key_mismatch');
    }
    if (report.kind !== binding.periodKind) {
      reasons.push('report_binding_mismatch');
      reasons.push('report_kind_mismatch');
    }
    if (!instantMatches(report.period_start, shanghaiMidnight(binding.periodStart))) {
      reasons.push('report_binding_mismatch');
      reasons.push('report_period_mismatch');
    }
    if (!instantMatches(report.period_end, periodEndInstant(binding.periodEnd, binding.periodKind))) {
      reasons.push('report_binding_mismatch');
      reasons.push('report_period_mismatch');
    }
  }
  const version = snapshot.version;
  if (!version) {
    reasons.push('version_missing');
  } else {
    if (version.revision !== binding.reportRevision) reasons.push('version_binding_mismatch');
    if (version.body_run_id && snapshot.bodyRun && snapshot.bodyRun.id !== version.body_run_id) {
      reasons.push('version_binding_mismatch');
    }
  }
  if (snapshot.factsRun && snapshot.factsRun.id !== binding.factsRunId) {
    reasons.push('facts_binding_mismatch');
  }
  return uniqueReasons(reasons);
}

function unknownProgress(
  binding: PeriodRunBindingView,
  reasons: readonly string[],
  availabilityReason: string,
): PeriodReportProgress {
  return {
    overall: 'unknown',
    completed: false,
    processing: false,
    facts: {
      state: 'unknown',
      runId: binding.factsRunId,
      runStatus: null,
      versionStatus: null,
      generatedAt: null,
      errorCode: null,
      job: emptyJob(),
    },
    body: {
      state: 'unknown',
      runId: null,
      runStatus: null,
      knowledgeStatus: null,
      generatedAt: null,
      errorCode: null,
      job: emptyJob(),
    },
    delivery: {
      state: 'unknown',
      deliveryState: null,
      messageId: null,
      conversationId: null,
      deliveredAt: null,
      readAt: null,
    },
    availability: { state: 'unknown', reason: availabilityReason },
    reasons: uniqueReasons(reasons),
  };
}

/**
 * Map the current business rows to a progress view. Pure: no clock, no storage,
 * no database. A row that does not match the run binding is never reported as
 * this run's state.
 */
export function mapPeriodReportRunStatus(input: {
  record: LiveRunRecord;
  binding: PeriodRunBindingView;
  snapshot: PeriodReportBusinessSnapshot;
  observedAt: string;
}): PeriodReportProgress {
  const binding = input.binding;
  const snapshot = input.snapshot;

  if (snapshot.read_error) {
    return unknownProgress(binding, ['read_error'], 'read_error');
  }
  const mismatches = bindingMismatchReasons(binding, snapshot);
  if (mismatches.length) {
    return unknownProgress(binding, mismatches, 'binding_mismatch');
  }

  const version = snapshot.version!;
  const facts = mapFactsStep(binding, version, snapshot.factsRun, snapshot.factsJob);
  const body = mapBodyStep(version, snapshot.bodyRun, snapshot.bodyJob);
  const delivery = mapDeliveryStep(binding, snapshot);
  const availability = mapAvailability(binding, snapshot, facts.state === 'ready');

  const reasons: string[] = [];
  if (facts.state === 'failed') reasons.push('facts_failed');
  if (facts.state === 'unknown') reasons.push('facts_unknown');
  if (body.state === 'failed') reasons.push('body_failed');
  if (body.state === 'unknown') reasons.push('body_unknown');
  if (delivery.state === 'unknown') reasons.push('delivery_unknown');
  if (delivery.state === 'muted') reasons.push('delivery_muted');
  if (delivery.state === 'revoked') reasons.push('delivery_revoked');
  if (availability.state !== 'available') {
    reasons.push(availability.state);
    reasons.push(availability.reason);
  }

  // Availability dominates: an old report whose destination generation moved
  // stays unavailable even when its historical delivery evidence says
  // "delivered". A confirmed failure is never hidden by a stopped delivery.
  const contentReady = facts.state === 'ready' && body.state === 'ready';
  let overall: PeriodOverallState;
  if (availability.state === 'access_revoked' || availability.state === 'source_unavailable') {
    overall = 'unavailable';
  } else if (facts.state === 'failed' || body.state === 'failed') {
    overall = 'failed';
  } else if (
    facts.state === 'unknown'
    || body.state === 'unknown'
    || delivery.state === 'unknown'
    || availability.state === 'unknown'
  ) {
    overall = 'unknown';
  } else if (!contentReady) {
    // Facts or body are still queued/running/waiting. Content generation is the
    // active work, so a muted/revoked delivery cannot stop the observation yet.
    overall = 'processing';
  } else if (delivery.state === 'delivered') {
    overall = 'completed';
  } else if (delivery.state === 'muted' || delivery.state === 'revoked') {
    // Facts and body are ready and nothing will be delivered or retried.
    overall = 'stopped';
  } else {
    // Content is ready; only a pending/held delivery is still outstanding.
    overall = 'processing';
  }

  return {
    overall,
    completed: overall === 'completed',
    processing: overall === 'queued' || overall === 'processing',
    facts,
    body,
    delivery,
    availability,
    reasons: uniqueReasons(reasons),
  };
}

function buildRawRunView(record: LiveRunRecord): PeriodRawRunView {
  return {
    status: record.status,
    errorCode: record.state.error?.code ?? null,
    errorMessage: record.state.error?.message ?? null,
    updatedAt: record.updatedAt,
    operations: record.operations.map((operation) => ({
      nodeId: operation.nodeId,
      capabilityRef: operation.capabilityRef,
      outcome: operation.outcome,
      errorCode: operation.error?.code ?? null,
      errorMessage: operation.error?.message ?? null,
    })),
  };
}

/** Read-only snapshot queries. Any failure is reported as data, never thrown. */
async function readSnapshotRows(
  tx: PostgresTransaction,
  binding: PeriodRunBindingView,
): Promise<PeriodReportBusinessSnapshot> {
  try {
    const reportRow = await one(
      tx,
      sql`select id,binding_id,report_key,kind,period_start,period_end,latest_revision
        from app.construction_reports
        where enterprise_id=${binding.enterpriseId} and id=${binding.reportId}
        limit 1`,
    );
    if (!reportRow) return emptySnapshot(null);
    const report = {
      id: String(reportRow.id),
      binding_id: String(reportRow.binding_id),
      report_key: String(reportRow.report_key),
      kind: String(reportRow.kind),
      period_start: iso(reportRow.period_start) ?? String(reportRow.period_start),
      period_end: iso(reportRow.period_end) ?? String(reportRow.period_end),
      latest_revision: Number(reportRow.latest_revision),
    };

    const versionRow = await one(
      tx,
      sql`select revision,status,generated_at,body is not null as body_present,
          knowledge_status,body_run_id,body_error_code,body_attempts,run_id,facts
        from app.construction_report_versions
        where enterprise_id=${binding.enterpriseId} and report_id=${binding.reportId}
          and revision=${binding.reportRevision}
        limit 1`,
    );
    if (!versionRow) {
      return { ...emptySnapshot(null), report };
    }

    const factsRunRow = await one(
      tx,
      sql`select id,status,error_code from app.assistant_runs
        where enterprise_id=${binding.enterpriseId} and id=${String(versionRow.run_id)}
        limit 1`,
    );
    const factsJobRow = await one(
      tx,
      sql`select id,status,attempts,provider_started_at from app.assistant_jobs
        where enterprise_id=${binding.enterpriseId} and run_id=${String(versionRow.run_id)}
        limit 1`,
    );
    const bodyRunRow = versionRow.body_run_id
      ? await one(
          tx,
          sql`select id,status,error_code from app.assistant_runs
            where enterprise_id=${binding.enterpriseId} and id=${String(versionRow.body_run_id)}
            limit 1`,
        )
      : undefined;
    const bodyJobRow = versionRow.body_run_id
      ? await one(
          tx,
          sql`select id,status,attempts,provider_started_at from app.assistant_jobs
            where enterprise_id=${binding.enterpriseId} and run_id=${String(versionRow.body_run_id)}
            limit 1`,
        )
      : undefined;
    const deliveryRow = await one(
      tx,
      sql`select state,message_id,delivered_at,read_at from app.construction_report_deliveries
        where enterprise_id=${binding.enterpriseId} and report_id=${binding.reportId}
          and revision=${Number(versionRow.revision)} and binding_id=${binding.bindingId}
        limit 1`,
    );
    const messageRow = deliveryRow?.message_id
      ? await one(
          tx,
          sql`select id,conversation_id,purpose,seq from app.assistant_messages
            where enterprise_id=${binding.enterpriseId} and id=${String(deliveryRow.message_id)}
            limit 1`,
        )
      : undefined;
    const bindingRow = await one(
      tx,
      sql`select * from app.construction_followup_bindings
        where enterprise_id=${binding.enterpriseId} and id=${binding.bindingId}
        limit 1`,
    );
    const projectRow = await one(
      tx,
      sql`select id,name,status,customer_access,current_stage_key from app.construction_projects
        where enterprise_id=${binding.enterpriseId} and id=${binding.projectId}
        limit 1`,
    );
    const conversationRow = await one(
      tx,
      sql`select id,status,coalesce((entry_snapshot->>'retentionRedacted')='true',false) as retention_redacted
        from app.assistant_conversations
        where enterprise_id=${binding.enterpriseId} and id=${binding.conversationId}
        limit 1`,
    );

    const followup = bindingRow
      ? await followupAvailable(tx, binding.enterpriseId, bindingRow)
      : false;
    let sourceProjectIds: readonly string[] = [];
    if (versionRow.status === 'facts_ready' && versionRow.facts && bindingRow) {
      const generatedAt = asDate(versionRow.generated_at);
      if (generatedAt) {
        const scoped = await projectReportFacts(
          tx,
          binding.enterpriseId,
          bindingRow,
          versionRow.facts as ReportFacts,
          generatedAt,
        );
        sourceProjectIds = scoped.projects.map((project) => project.id);
      }
    }

    return {
      report,
      version: {
        revision: Number(versionRow.revision),
        status: String(versionRow.status),
        generated_at: iso(versionRow.generated_at),
        body_present: versionRow.body_present === true,
        knowledge_status: String(versionRow.knowledge_status),
        body_run_id: text(versionRow.body_run_id),
        body_error_code: text(versionRow.body_error_code),
        body_attempts: Number(versionRow.body_attempts ?? 0),
      },
      factsRun: factsRunRow
        ? {
            id: String(factsRunRow.id),
            status: String(factsRunRow.status),
            error_code: text(factsRunRow.error_code),
          }
        : null,
      factsJob: factsJobRow ? jobView(factsJobRow) : null,
      bodyRun: bodyRunRow
        ? {
            id: String(bodyRunRow.id),
            status: String(bodyRunRow.status),
            error_code: text(bodyRunRow.error_code),
          }
        : null,
      bodyJob: bodyJobRow ? jobView(bodyJobRow) : null,
      delivery: deliveryRow
        ? {
            state: String(deliveryRow.state),
            message_id: text(deliveryRow.message_id),
            delivered_at: iso(deliveryRow.delivered_at),
            read_at: iso(deliveryRow.read_at),
          }
        : null,
      message: messageRow
        ? {
            id: String(messageRow.id),
            conversation_id: String(messageRow.conversation_id),
            purpose: String(messageRow.purpose),
            seq: text(messageRow.seq),
          }
        : null,
      binding: bindingRow
        ? {
            id: String(bindingRow.id),
            project_id: String(bindingRow.project_id),
            conversation_id: String(bindingRow.conversation_id),
            audience: String(bindingRow.audience),
            status: String(bindingRow.status),
            user_id: text(bindingRow.user_id),
          }
        : null,
      project: projectRow
        ? {
            id: String(projectRow.id),
            name: String(projectRow.name ?? ''),
            status: String(projectRow.status),
            customer_access: projectRow.customer_access === true,
            current_stage_key: text(projectRow.current_stage_key),
          }
        : null,
      conversation: conversationRow
        ? {
            id: String(conversationRow.id),
            status: String(conversationRow.status),
            retention_redacted: conversationRow.retention_redacted === true,
          }
        : null,
      followup_available: followup,
      source_project_ids: sourceProjectIds,
      read_error: null,
    };
  } catch {
    // A read failure is data for the status view; it must never masquerade as
    // success or surface as a business write error.
    return emptySnapshot('read_failed');
  }
}

/** Any active project member may read; platform admins keep constructionAccess. */
async function assertProjectRead(
  enterpriseId: string,
  adminId: string,
  projectId: string,
): Promise<void> {
  await withTenantTransaction(enterpriseId, async (tx) => {
    await readProjectAccess(
      tx,
      { enterpriseId, adminId },
      projectId,
      'share',
    );
  });
}

async function accessAndSnapshot(
  binding: PeriodRunBindingView,
  viewerAdminId: string,
): Promise<PeriodReportBusinessSnapshot> {
  return withTenantTransaction(binding.enterpriseId, async (tx) => {
    // The authorization and the status queries share one transaction, so a
    // membership change cannot slip between the check and the read.
    await readProjectAccess(
      tx,
      { enterpriseId: binding.enterpriseId, adminId: viewerAdminId },
      binding.projectId,
      'share',
    );
    return readSnapshotRows(tx, binding);
  });
}

/**
 * Read one period-report run without mutating anything. It never executes
 * ports, enqueues jobs, writes reports/messages or retries a run.
 */
export async function readPeriodReportRunStatus(
  options: PeriodReportStatusReaderOptions,
): Promise<PeriodReportRunObservation> {
  const now = options.now ?? (() => new Date());
  const runStore = options.runStore
    ?? createFileWorkflowRunStore({ rootDir: resolveNativeWorkflowRunDir() });
  const record = await runStore.get(options.runId);
  if (!record) {
    throw new WorkflowOperationError('run_not_found', 404, `run ${options.runId} was not found`);
  }

  const extracted = extractPeriodReportRunBinding(record);
  // Tenant scope comes from the host viewer, never from the record or a client.
  if (record.enterpriseId !== options.viewer.enterpriseId) {
    throw new WorkflowOperationError(
      'run_enterprise_forbidden',
      403,
      `run ${options.runId} belongs to another enterprise`,
    );
  }
  // The run record's own project identity is the only source for the business
  // authorization; it is never taken from the request or the receipt. A run
  // without it cannot prove any project scope and is not readable.
  if (!nonEmptyString(record.projectId)) {
    throw new WorkflowOperationError(
      'run_scope_unavailable',
      404,
      `run ${options.runId} has no project scope to authorize`,
    );
  }
  const observedAt = now().toISOString();
  const raw = buildRawRunView(record);

  if (!extracted.ok || !extracted.binding) {
    // Even an unbound run exposes its trace, so the current viewer must pass
    // the same project authorization before any trace is returned.
    if (options.authorizeUnbound) {
      await options.authorizeUnbound({
        enterpriseId: record.enterpriseId,
        adminId: options.viewer.adminId,
        projectId: record.projectId,
      });
    } else {
      await assertProjectRead(record.enterpriseId, options.viewer.adminId, record.projectId);
    }
    return {
      contract: PERIOD_REPORT_STATUS_CONTRACT,
      observedAt,
      bound: false,
      binding: null,
      progress: null,
      raw,
      reasons: extracted.reasons,
    };
  }

  const binding = extracted.binding;
  let snapshot: PeriodReportBusinessSnapshot;
  if (options.loadSnapshot) {
    // Offline/test seam: the injected loader owns its authorized read scope,
    // because it cannot open a tenant transaction without a database.
    try {
      snapshot = await options.loadSnapshot(INJECTED_TRANSACTION, binding);
    } catch {
      snapshot = emptySnapshot('read_failed');
    }
  } else {
    snapshot = await accessAndSnapshot(binding, options.viewer.adminId);
  }

  const hydrated: PeriodRunBindingView = {
    ...binding,
    projectName: snapshot.project?.name ?? '',
  };
  const progress = mapPeriodReportRunStatus({
    record,
    binding: hydrated,
    snapshot,
    observedAt,
  });
  return {
    contract: PERIOD_REPORT_STATUS_CONTRACT,
    observedAt,
    bound: true,
    binding: hydrated,
    progress,
    raw,
    reasons: progress.reasons,
  };
}
