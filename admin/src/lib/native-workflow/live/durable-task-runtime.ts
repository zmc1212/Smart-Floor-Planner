/** Durable long-running task runtime for the native workflow B line.
 *
 * Combines a pure lifecycle decision with the tenant-scoped store:
 *   pending -> queued -> running -> succeeded | failed | retrying | waiting
 *   retrying/waiting -> queued (when due) -> running ...
 *   any non-terminal -> cancelled | expired
 *
 * Guarantees:
 * - terminal tasks are never claimed or re-executed by an ordinary retry;
 * - a worker commits only while it owns the current lease token;
 * - a crashed worker is reclaimed only after its lease TTL, and the old token
 *   can never complete, fail or renew afterwards;
 * - retries use bounded exponential backoff and a per-tenant storm guard;
 * - unrecoverable tasks enter a durable manual queue instead of looping;
 * - compensations for already committed business effects never run without an
 *   explicit authorization when the effect is not freely reversible.
 */

import { createHash, randomUUID } from 'node:crypto';
import { WorkflowOperationError } from '../errors';
import {
  DURABLE_TASK_VERSION,
  isTerminalDurableTaskStatus,
  type DurableTaskAttempt,
  type DurableTaskClaim,
  type DurableTaskCompensation,
  type DurableTaskData,
  type DurableTaskDelegation,
  type DurableTaskErrorClass,
  type DurableTaskListQuery,
  type DurableTaskManualQueueEntry,
  type DurableTaskRecord,
  type DurableTaskRecoveryMode,
  type DurableTaskRecoverySummary,
  type DurableTaskRetryPolicy,
  type DurableTaskStep,
  type DurableTaskTimeouts,
} from './durable-task-types';
import type { DurableTaskStore, DurableTaskStoreUpdateOptions } from './durable-task-store';

export const DEFAULT_DURABLE_TASK_TIMEOUTS: DurableTaskTimeouts = {
  taskTimeoutMs: 30 * 60_000,
  attemptTimeoutMs: 5 * 60_000,
  externalCallTimeoutMs: 60_000,
};

export const DEFAULT_DURABLE_TASK_RETRY: DurableTaskRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 300_000,
  jitterRatio: 0.2,
  stormWindowMs: 60_000,
  stormLimit: 20,
};

const ENTERPRISE_PATTERN = /^[1-9]\d{0,18}$/;

export interface DurableTaskRuntimeOptions {
  readonly store: DurableTaskStore;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly newId?: () => string;
}

export interface CreateDurableTaskInput {
  readonly enterpriseId: string;
  readonly projectId?: string | null;
  readonly kind: string;
  readonly businessKey: string;
  readonly delegation: DurableTaskDelegation;
  readonly recoveryMode?: DurableTaskRecoveryMode;
  readonly timeouts?: Partial<DurableTaskTimeouts>;
  readonly retry?: Partial<DurableTaskRetryPolicy>;
  readonly data?: DurableTaskData;
}

export interface DurableTaskLeaseRef {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly owner: string;
  readonly token: string;
}

export interface ClaimDurableTaskInput {
  readonly enterpriseId: string;
  readonly owner: string;
  readonly leaseTtlMs?: number;
  /** Restrict the claim to one task; omitted means the tenant's due queue. */
  readonly taskId?: string;
  readonly expectedRevision?: number;
}

export type DurableTaskHeartbeatResult =
  | { readonly ok: true; readonly record: DurableTaskRecord; readonly leaseExpiresAt: string }
  | {
      readonly ok: false;
      readonly reason:
        | 'lease_lost'
        | 'not_found'
        | 'terminal'
        | 'not_running'
        | 'task_timeout'
        | 'attempt_timeout';
      readonly record: DurableTaskRecord | null;
    };

export interface DurableTaskProgressInput extends DurableTaskLeaseRef {
  readonly steps?: readonly DurableTaskStep[];
  readonly data?: DurableTaskData;
}

export interface CompleteDurableTaskInput extends DurableTaskProgressInput {
  readonly data?: DurableTaskData;
}

export interface FailDurableTaskInput extends DurableTaskProgressInput {
  readonly errorClass: DurableTaskErrorClass;
  readonly code: string;
  readonly message: string;
}

export interface WaitDurableTaskInput extends DurableTaskProgressInput {
  readonly reason: string;
  readonly code?: string;
  readonly wakeAt?: string | null;
}

export interface CancelDurableTaskInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly reason: string;
  readonly by: string;
}

export interface ResolveManualDurableTaskInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly resolution: 'retry' | 'cancel' | 'close';
  readonly resolvedBy: string;
  readonly reason?: string;
}

export interface DurableTaskCompensationInput {
  readonly stepKey: string;
  readonly action: string;
  readonly effect: 'reversible' | 'requires_authorization';
  readonly evidence?: DurableTaskData;
}

export interface PlanDurableTaskCompensationInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly entries: readonly DurableTaskCompensationInput[];
  readonly by: string;
}

export interface AuthorizeDurableTaskCompensationInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly compensationId: string;
  readonly grantedBy: string;
  readonly reason: string;
}

export interface ExecuteDurableTaskCompensationsInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly execute: (input: {
    readonly enterpriseId: string;
    readonly projectId: string | null;
    readonly taskId: string;
    readonly compensation: DurableTaskCompensation;
  }) => Promise<void>;
}

export interface DurableTaskCompensationResult {
  readonly record: DurableTaskRecord;
  readonly executed: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface DurableTaskRuntime {
  now(): Date;
  newId(): string;
  create(input: CreateDurableTaskInput): Promise<{ readonly created: boolean; readonly record: DurableTaskRecord }>;
  enqueue(input: { readonly enterpriseId: string; readonly taskId: string }): Promise<DurableTaskRecord>;
  get(enterpriseId: string, taskId: string): Promise<DurableTaskRecord | null>;
  list(query: DurableTaskListQuery): Promise<DurableTaskRecord[]>;
  claim(input: ClaimDurableTaskInput): Promise<DurableTaskClaim | null>;
  acquire(input: DurableTaskLeaseRef & { readonly ttlMs?: number }): Promise<DurableTaskClaim | null>;
  release(input: DurableTaskLeaseRef): Promise<void>;
  heartbeat(input: DurableTaskLeaseRef): Promise<DurableTaskHeartbeatResult>;
  checkpoint(input: DurableTaskProgressInput): Promise<DurableTaskRecord>;
  complete(input: CompleteDurableTaskInput): Promise<DurableTaskRecord>;
  fail(input: FailDurableTaskInput): Promise<DurableTaskRecord>;
  wait(input: WaitDurableTaskInput): Promise<DurableTaskRecord>;
  cancel(input: CancelDurableTaskInput): Promise<DurableTaskRecord>;
  appendData(input: { readonly enterpriseId: string; readonly taskId: string; readonly data: DurableTaskData; readonly expectedRevision?: number }): Promise<DurableTaskRecord>;
  recover(enterpriseId: string, query?: Omit<DurableTaskListQuery, 'enterpriseId'>): Promise<DurableTaskRecoverySummary>;
  recoverAll(enterpriseIds: readonly string[]): Promise<DurableTaskRecoverySummary[]>;
  resolveManual(input: ResolveManualDurableTaskInput): Promise<DurableTaskRecord>;
  planCompensation(input: PlanDurableTaskCompensationInput): Promise<DurableTaskRecord>;
  authorizeCompensation(input: AuthorizeDurableTaskCompensationInput): Promise<DurableTaskRecord>;
  executeCompensations(input: ExecuteDurableTaskCompensationsInput): Promise<DurableTaskCompensationResult>;
}

/** Deterministic task id keeps repeated delegation idempotent across restarts. */
export function durableTaskId(enterpriseId: string, kind: string, businessKey: string): string {
  const digest = createHash('sha256').update(`${enterpriseId}\u0000${kind}\u0000${businessKey}`).digest('hex');
  return `task-${digest.slice(0, 32)}`;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new WorkflowOperationError('durable_task_input_invalid', 422, `${label} must not be empty`);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorkflowOperationError(
      'durable_task_input_invalid',
      422,
      `${label} must be a positive integer`,
    );
  }
  return value;
}

function normalizeTimeouts(input?: Partial<DurableTaskTimeouts>): DurableTaskTimeouts {
  const value = { ...DEFAULT_DURABLE_TASK_TIMEOUTS, ...input };
  positiveInteger(value.taskTimeoutMs, 'taskTimeoutMs');
  positiveInteger(value.attemptTimeoutMs, 'attemptTimeoutMs');
  positiveInteger(value.externalCallTimeoutMs, 'externalCallTimeoutMs');
  if (value.attemptTimeoutMs > value.taskTimeoutMs) {
    throw new WorkflowOperationError(
      'durable_task_input_invalid',
      422,
      'attemptTimeoutMs must not exceed taskTimeoutMs',
    );
  }
  return value;
}

function normalizeRetry(input?: Partial<DurableTaskRetryPolicy>): DurableTaskRetryPolicy {
  const value = { ...DEFAULT_DURABLE_TASK_RETRY, ...input };
  positiveInteger(value.maxAttempts, 'maxAttempts');
  if (!Number.isSafeInteger(value.baseDelayMs) || value.baseDelayMs < 0) {
    throw new WorkflowOperationError('durable_task_input_invalid', 422, 'baseDelayMs must be a non-negative integer');
  }
  positiveInteger(value.maxDelayMs, 'maxDelayMs');
  if (!Number.isFinite(value.jitterRatio) || value.jitterRatio < 0 || value.jitterRatio > 1) {
    throw new WorkflowOperationError('durable_task_input_invalid', 422, 'jitterRatio must be between 0 and 1');
  }
  positiveInteger(value.stormWindowMs, 'stormWindowMs');
  positiveInteger(value.stormLimit, 'stormLimit');
  return value;
}

function codeOf(error: unknown): string {
  if (error instanceof WorkflowOperationError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code: string }).code);
  }
  return 'compensation_failed';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unexpected error';
}

export function createDurableTaskRuntime(options: DurableTaskRuntimeOptions): DurableTaskRuntime {
  const store = options.store;
  const clock = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const newId = options.newId ?? (() => randomUUID());

  function nowIso(): string {
    return clock().toISOString();
  }

  function backoffMs(policy: DurableTaskRetryPolicy, attempt: number): number {
    const exponential = Math.min(
      policy.maxDelayMs,
      policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
    );
    const jitter = policy.jitterRatio * (random() * 2 - 1);
    return Math.max(0, Math.round(exponential * (1 + jitter)));
  }

  function stormBlocked(
    record: DurableTaskRecord,
    now: Date,
    tasks: readonly DurableTaskRecord[],
  ): boolean {
    const windowStart = now.getTime() - record.retry.stormWindowMs;
    let recent = 1; // the failure deciding this retry
    for (const task of tasks) {
      if (task.enterpriseId !== record.enterpriseId) continue;
      for (const attempt of task.attempts) {
        if (attempt.errorClass !== 'transient' || !attempt.finishedAt) continue;
        if (Date.parse(attempt.finishedAt) >= windowStart) recent += 1;
      }
    }
    return recent >= record.retry.stormLimit;
  }

  function manualEntry(reason: string, code: string | null, now: Date): DurableTaskManualQueueEntry {
    return {
      reason,
      code,
      queuedAt: now.toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    };
  }

  function replaceAttempt(
    attempts: readonly DurableTaskAttempt[],
    patch: Partial<DurableTaskAttempt> & { readonly attempt?: number },
  ): readonly DurableTaskAttempt[] {
    const index = attempts.length - 1;
    if (index < 0) return attempts;
    const current = attempts[index]!;
    return [...attempts.slice(0, index), { ...current, ...patch }];
  }

  function lastAttempt(record: DurableTaskRecord): DurableTaskAttempt | null {
    return record.attempts.length ? record.attempts[record.attempts.length - 1]! : null;
  }

  function mergeSteps(
    current: readonly DurableTaskStep[],
    incoming: readonly DurableTaskStep[] | undefined,
    nowIsoValue: string,
  ): readonly DurableTaskStep[] {
    if (!incoming?.length) return current;
    const merged = new Map(current.map((step) => [step.key, step]));
    for (const step of incoming) {
      assertNonEmpty(step.key, 'step.key');
      const previous = merged.get(step.key);
      merged.set(step.key, {
        ...step,
        attempts: Math.max(step.attempts, previous?.attempts ?? 0),
        startedAt: step.startedAt ?? nowIsoValue,
        finishedAt: step.finishedAt ?? (step.status === 'succeeded' || step.status === 'failed' || step.status === 'skipped' ? nowIsoValue : null),
      });
    }
    return [...merged.values()];
  }

  function mergeData(current: DurableTaskData, patch: DurableTaskData | undefined): DurableTaskData {
    return patch ? { ...current, ...patch } : current;
  }

  async function requireRecord(enterpriseId: string, taskId: string): Promise<DurableTaskRecord> {
    const record = await store.get(enterpriseId, taskId);
    if (!record) {
      throw new WorkflowOperationError('durable_task_not_found', 404, `durable task ${taskId} was not found`);
    }
    return record;
  }

  async function renewOwnership(record: DurableTaskRecord, ref: DurableTaskLeaseRef): Promise<void> {
    await store.renewLease({
      enterpriseId: ref.enterpriseId,
      taskId: ref.taskId,
      owner: ref.owner,
      token: ref.token,
      ttlMs: record.timeouts.attemptTimeoutMs,
      now: clock(),
    });
  }

  async function releaseLeaseRef(ref: DurableTaskLeaseRef): Promise<void> {
    await store.releaseLease({
      enterpriseId: ref.enterpriseId,
      taskId: ref.taskId,
      token: ref.token,
    });
  }

  async function releaseBeforeUpdate(enterpriseId: string, taskId: string): Promise<void> {
    if (!store.atomicLeaseUpdates) {
      await store.releaseLease({ enterpriseId, taskId, token: '', force: true });
    }
  }

  async function expireRecord(
    record: DurableTaskRecord, now: Date, code: string, fence?: DurableTaskLeaseRef,
  ): Promise<DurableTaskRecord> {
    const attempt = lastAttempt(record);
    await releaseBeforeUpdate(record.enterpriseId, record.taskId);
    return store.update({
      ...record,
      status: 'expired',
      updatedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      nextAttemptAt: null,
      attempts: replaceAttempt(record.attempts, {
        outcome: 'timed_out',
        finishedAt: now.toISOString(),
        durationMs: attempt ? now.getTime() - Date.parse(attempt.startedAt) : null,
        errorClass: 'permanent',
        errorCode: code,
      }),
      lastError: { class: 'permanent', code, message: `task ${code}` },
      manual: record.kind === 'tool.call' ? record.manual ?? manualEntry('task_timeout', code, now) : record.manual,
      lease: null,
    }, { fence, clearLease: fence ? 'owned' : 'expired' });
  }

  async function retryOrFail(
    record: DurableTaskRecord,
    now: Date,
    errorClass: DurableTaskErrorClass,
    code: string,
    message: string,
    ownership: DurableTaskStoreUpdateOptions,
  ): Promise<DurableTaskRecord> {
    if (errorClass === 'permanent' || errorClass === 'business_rejection') {
      return store.update({
        ...record,
        status: 'failed',
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        nextAttemptAt: null,
        manual: errorClass === 'permanent'
          ? record.manual ?? manualEntry('permanent_failure', code, now)
          : record.manual,
        lastError: { class: errorClass, code, message },
        lease: null,
      }, ownership);
    }
    if (record.attempts.length >= record.retry.maxAttempts) {
      return store.update({
        ...record,
        status: 'failed',
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        nextAttemptAt: null,
        manual: record.manual ?? manualEntry('retry_exhausted', code, now),
        lastError: { class: errorClass, code, message },
        lease: null,
      }, ownership);
    }
    const tenantTasks = await store.list({ enterpriseId: record.enterpriseId, limit: 500 });
    if (stormBlocked(record, now, tenantTasks)) {
      return store.update({
        ...record,
        status: 'failed',
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        nextAttemptAt: null,
        manual: record.manual ?? manualEntry('retry_storm', code, now),
        lastError: { class: errorClass, code: 'retry_storm', message: 'retry storm guard stopped this task' },
        lease: null,
      }, ownership);
    }
    const delay = backoffMs(record.retry, record.attempts.length);
    return store.update({
      ...record,
      status: 'retrying',
      updatedAt: now.toISOString(),
      finishedAt: null,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
      lastError: { class: errorClass, code, message },
      lease: null,
    }, ownership);
  }

  function claimable(record: DurableTaskRecord, now: Date): boolean {
    const due = record.nextAttemptAt === null || Date.parse(record.nextAttemptAt) <= now.getTime();
    if (record.status === 'queued') return due;
    if (record.status === 'retrying') return due;
    if (record.status === 'waiting') return record.nextAttemptAt !== null && due;
    return false;
  }

  async function claimRecord(
    enterpriseId: string,
    record: DurableTaskRecord,
    owner: string,
    leaseTtlMs: number,
    now: Date,
    expectedRevision?: number,
  ): Promise<DurableTaskClaim | null> {
    const token = newId();
    const acquired = await store.acquireLease({
      enterpriseId,
      taskId: record.taskId,
      owner,
      token,
      ttlMs: leaseTtlMs,
      now,
    });
    if (!acquired.acquired || !acquired.lease) return null;
    try {
      const latest = await store.get(enterpriseId, record.taskId);
      if (!latest || !claimable(latest, now) || isTerminalDurableTaskStatus(latest.status)
        || (expectedRevision !== undefined && latest.storeRevision !== expectedRevision)) {
        await store.releaseLease({ enterpriseId, taskId: record.taskId, token });
        return null;
      }
      const attempt: DurableTaskAttempt = {
        attempt: latest.attempts.length + 1,
        owner,
        startedAt: now.toISOString(),
        finishedAt: null,
        outcome: 'running',
        errorClass: null,
        errorCode: null,
        durationMs: null,
      };
      const updated = await store.update({
        ...latest,
        status: 'running',
        startedAt: latest.startedAt ?? now.toISOString(),
        attempts: [...latest.attempts, attempt],
        updatedAt: now.toISOString(),
        finishedAt: null,
        lease: null,
      }, { fence: { owner, token } });
      return { record: updated, lease: acquired.lease };
    } catch (error) {
      await store.releaseLease({ enterpriseId, taskId: record.taskId, token }).catch(() => undefined);
      throw error;
    }
  }

  async function handleAttemptTimeout(
    record: DurableTaskRecord,
    now: Date,
    code: string,
    fence?: DurableTaskLeaseRef,
  ): Promise<DurableTaskRecord> {
    const ownership = { fence, clearLease: fence ? 'owned' : 'expired' } as const;
    const attempt = lastAttempt(record);
    const timedOut = replaceAttempt(record.attempts, {
      outcome: 'timed_out',
      finishedAt: now.toISOString(),
      durationMs: attempt ? now.getTime() - Date.parse(attempt.startedAt) : null,
      errorClass: 'transient',
      errorCode: code,
    });
    if (Date.parse(record.deadlineAt) <= now.getTime()) {
      return expireRecord({ ...record, attempts: timedOut }, now, 'task_timeout', fence);
    }
    if (record.recoveryMode === 'reconcile' && (code === 'lease_expired' || record.kind === 'tool.call')) {
      return store.update({
        ...record,
        attempts: timedOut,
        status: 'waiting',
        updatedAt: now.toISOString(),
        nextAttemptAt: record.kind === 'tool.call' ? now.toISOString() : null,
        lastError: {
          class: 'transient',
          code: 'recovery_required',
          message: 'the worker died; the external outcome must be reconciled before retry',
        },
        lease: null,
      }, ownership);
    }
    return retryOrFail(
      { ...record, attempts: timedOut },
      now,
      'transient',
      code,
      'the attempt did not finish inside its budget',
      ownership,
    );
  }

  const runtime: DurableTaskRuntime = {
    now: clock,
    newId,

    async create(input) {      if (!ENTERPRISE_PATTERN.test(input.enterpriseId)) {
        throw new WorkflowOperationError(
          'durable_task_tenant_invalid',
          422,
          `enterprise id ${JSON.stringify(input.enterpriseId)} is not a positive integer id`,
        );
      }
      assertNonEmpty(input.kind, 'kind');
      assertNonEmpty(input.businessKey, 'businessKey');
      assertNonEmpty(input.delegation.requestedBy, 'delegation.requestedBy');
      const now = clock();
      const timeouts = normalizeTimeouts(input.timeouts);
      const retry = normalizeRetry(input.retry);
      const record: DurableTaskRecord = {
        taskVersion: DURABLE_TASK_VERSION,
        taskId: durableTaskId(input.enterpriseId, input.kind, input.businessKey),
        enterpriseId: input.enterpriseId,
        projectId: input.projectId ?? null,
        kind: input.kind,
        businessKey: input.businessKey,
        delegation: { ...input.delegation },
        status: 'pending',
        recoveryMode: input.recoveryMode ?? 'retry',
        timeouts,
        retry,
        attempts: [],
        steps: [],
        compensations: [],
        manual: null,
        data: input.data ?? {},
        lastError: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        startedAt: null,
        finishedAt: null,
        deadlineAt: new Date(now.getTime() + timeouts.taskTimeoutMs).toISOString(),
        nextAttemptAt: now.toISOString(),
        cancelRequestedAt: null,
        cancelReason: null,
        lease: null,
      };
      const created = await store.create(record);
      return { created: created.created, record: created.record };
    },

    async enqueue(input) {
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (record.status !== 'pending') return record;
      return store.update({
        ...record,
        status: 'queued',
        updatedAt: nowIso(),
        nextAttemptAt: nowIso(),
        lease: null,
      });
    },

    async get(enterpriseId, taskId) {
      return store.get(enterpriseId, taskId);
    },

    async list(query) {
      return store.list(query);
    },

    async claim(input) {
      const now = clock();
      const leaseTtlMs = positiveInteger(input.leaseTtlMs ?? 120_000, 'leaseTtlMs');
      const specific = input.taskId ? await store.get(input.enterpriseId, input.taskId) : null;
      const records = input.taskId ? (specific ? [specific] : [])
        : await store.list({ enterpriseId: input.enterpriseId, limit: 500 });
      const due = records
        .filter((record) => !isTerminalDurableTaskStatus(record.status) && claimable(record, now))
        .sort((left, right) =>
          (left.nextAttemptAt ?? left.createdAt).localeCompare(right.nextAttemptAt ?? right.createdAt)
          || left.createdAt.localeCompare(right.createdAt)
          || left.taskId.localeCompare(right.taskId));
      for (const record of due) {
        if (Date.parse(record.deadlineAt) <= now.getTime()) {
          await expireRecord(record, now, 'task_timeout');
          continue;
        }
        const claimed = await claimRecord(input.enterpriseId, record, input.owner, leaseTtlMs, now, input.expectedRevision)
          .catch((error: unknown) => {
            // A task cancelled or completed between the scan and the claim is
            // simply no longer a candidate; corruption still surfaces.
            if (
              error instanceof WorkflowOperationError
              && (error.code === 'durable_task_terminal' || error.code === 'durable_task_conflict')
            ) {
              return null;
            }
            throw error;
          });
        if (claimed) return claimed;
      }
      return null;
    },

    async acquire(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (isTerminalDurableTaskStatus(record.status)) return null;
      const acquired = await store.acquireLease({
        enterpriseId: input.enterpriseId,
        taskId: input.taskId,
        owner: input.owner,
        token: input.token,
        ttlMs: positiveInteger(input.ttlMs ?? record.timeouts.attemptTimeoutMs, 'ttlMs'),
        now,
      });
      if (!acquired.acquired || !acquired.lease) return null;
      const latest = await requireRecord(input.enterpriseId, input.taskId);
      if (latest.lease?.token !== acquired.lease.token) return null;
      return { record: latest, lease: acquired.lease };
    },

    async release(input) {
      await releaseLeaseRef(input);
    },

    async heartbeat(input) {
      const now = clock();
      let lease;
      try {
        const record = await requireRecord(input.enterpriseId, input.taskId);
        lease = await store.renewLease({
          enterpriseId: input.enterpriseId,
          taskId: input.taskId,
          owner: input.owner,
          token: input.token,
          ttlMs: record.timeouts.attemptTimeoutMs,
          now,
        });
      } catch (error) {
        if (error instanceof WorkflowOperationError && error.code === 'durable_task_lease_lost') {
          return { ok: false, reason: 'lease_lost', record: await store.get(input.enterpriseId, input.taskId) };
        }
        throw error;
      }
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (isTerminalDurableTaskStatus(record.status)) {
        await releaseLeaseRef(input);
        return { ok: false, reason: 'terminal', record };
      }
      if (record.status !== 'running') {
        return { ok: false, reason: 'not_running', record };
      }
      if (Date.parse(record.deadlineAt) <= now.getTime()) {
        const expired = await expireRecord(record, now, 'task_timeout', input);
        return { ok: false, reason: 'task_timeout', record: expired };
      }
      const attempt = lastAttempt(record);
      if (!attempt || attempt.outcome !== 'running'
        || now.getTime() - Date.parse(attempt.startedAt) >= record.timeouts.attemptTimeoutMs) {
        const timedOut = await handleAttemptTimeout(record, now, 'attempt_timeout', input);
        await releaseLeaseRef(input).catch(() => undefined);
        return { ok: false, reason: 'attempt_timeout', record: timedOut };
      }
      return { ok: true, record, leaseExpiresAt: lease.expiresAt };
    },

    async checkpoint(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      await renewOwnership(record, input);
      if (record.status !== 'running' && record.status !== 'waiting') {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} is not running`,
        );
      }
      return store.update({
        ...record,
        steps: mergeSteps(record.steps, input.steps, now.toISOString()),
        data: mergeData(record.data, input.data),
        updatedAt: now.toISOString(),
        lease: null,
      }, { fence: input });
    },

    async complete(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      await renewOwnership(record, input);
      if (isTerminalDurableTaskStatus(record.status)) {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} is already ${record.status}`,
        );
      }
      if (record.status !== 'running' && record.status !== 'waiting') {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} cannot complete from ${record.status}`,
        );
      }
      if (Date.parse(record.deadlineAt) <= now.getTime()) {
        const expired = await expireRecord(record, now, 'task_timeout', input);
        await releaseLeaseRef(input).catch(() => undefined);
        return expired;
      }
      const attempt = lastAttempt(record);
      const attempts = attempt && attempt.outcome === 'running'
        ? replaceAttempt(record.attempts, {
            outcome: 'succeeded',
            finishedAt: now.toISOString(),
            durationMs: now.getTime() - Date.parse(attempt.startedAt),
          })
        : [
            ...record.attempts,
            {
              attempt: record.attempts.length + 1,
              owner: input.owner,
              startedAt: now.toISOString(),
              finishedAt: now.toISOString(),
              outcome: 'succeeded' as const,
              errorClass: null,
              errorCode: null,
              durationMs: 0,
            },
          ];
      const updated = await store.update({
        ...record,
        status: 'succeeded',
        attempts,
        steps: mergeSteps(record.steps, input.steps, now.toISOString()),
        data: mergeData(record.data, input.data),
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        nextAttemptAt: null,
        lastError: null,
        lease: null,
      }, { fence: input, clearLease: 'owned' });
      if (!store.atomicLeaseUpdates) await releaseLeaseRef(input);
      return updated;
    },

    async fail(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      await renewOwnership(record, input);
      if (isTerminalDurableTaskStatus(record.status)) {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} is already ${record.status}`,
        );
      }
      const attempt = lastAttempt(record);
      const attempts = attempt && attempt.outcome === 'running'
        ? replaceAttempt(record.attempts, {
            outcome: 'failed',
            finishedAt: now.toISOString(),
            durationMs: now.getTime() - Date.parse(attempt.startedAt),
            errorClass: input.errorClass,
            errorCode: input.code,
          })
        : [
            ...record.attempts,
            {
              attempt: record.attempts.length + 1,
              owner: input.owner,
              startedAt: now.toISOString(),
              finishedAt: now.toISOString(),
              outcome: 'failed' as const,
              errorClass: input.errorClass,
              errorCode: input.code,
              durationMs: 0,
            },
          ];
      const failed = await retryOrFail(
        {
          ...record,
          attempts,
          steps: mergeSteps(record.steps, input.steps, now.toISOString()),
          data: mergeData(record.data, input.data),
          updatedAt: now.toISOString(),
        },
        now,
        input.errorClass,
        input.code,
        input.message,
        { fence: input, clearLease: 'owned' },
      );
      if (!store.atomicLeaseUpdates) await releaseLeaseRef(input);
      return failed;
    },

    async wait(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      await renewOwnership(record, input);
      if (isTerminalDurableTaskStatus(record.status)
        || (record.status !== 'running' && record.status !== 'waiting')) {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} cannot wait from ${record.status}`,
        );
      }
      const attempt = lastAttempt(record);
      const attempts = attempt && attempt.outcome === 'running'
        ? replaceAttempt(record.attempts, {
            outcome: 'unknown',
            finishedAt: now.toISOString(),
            durationMs: now.getTime() - Date.parse(attempt.startedAt),
            errorCode: input.code ?? null,
          })
        : record.attempts;
      const updated = await store.update({
        ...record,
        status: 'waiting',
        attempts,
        steps: mergeSteps(record.steps, input.steps, now.toISOString()),
        data: mergeData(record.data, input.data),
        updatedAt: now.toISOString(),
        nextAttemptAt: input.wakeAt ?? null,
        lastError: {
          class: 'transient',
          code: input.code ?? 'waiting',
          message: input.reason,
        },
        lease: null,
      }, { fence: input, clearLease: 'owned' });
      if (!store.atomicLeaseUpdates) await releaseLeaseRef(input);
      return updated;
    },

    async cancel(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (isTerminalDurableTaskStatus(record.status)) return record;
      await releaseBeforeUpdate(input.enterpriseId, input.taskId);
      const attempt = lastAttempt(record);
      const attempts = attempt && attempt.outcome === 'running'
        ? replaceAttempt(record.attempts, {
            outcome: 'cancelled',
            finishedAt: now.toISOString(),
            durationMs: now.getTime() - Date.parse(attempt.startedAt),
            errorCode: 'cancelled',
          })
        : record.attempts;
      return store.update({
        ...record,
        status: 'cancelled',
        attempts,
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        nextAttemptAt: null,
        cancelRequestedAt: now.toISOString(),
        cancelReason: input.reason,
        lease: null,
      }, { clearLease: 'force' });
    },

    async appendData(input) {
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (input.expectedRevision !== undefined && record.storeRevision !== input.expectedRevision) {
        throw new WorkflowOperationError('durable_task_conflict', 409, 'task changed before appending an observation');
      }
      return store.update({
        ...record,
        data: mergeData(record.data, input.data),
        updatedAt: nowIso(),
        lease: null,
      });
    },

    async recover(enterpriseId, query = {}) {
      const now = clock();
      const records = await store.list({ limit: 500, ...query, enterpriseId });
      const summary = {
        enterpriseId,
        scanned: records.length,
        reclaimed: 0,
        retried: 0,
        queued: 0,
        expired: 0,
        failed: 0,
        waiting: 0,
        skipped: 0,
        errors: [] as { taskId: string; code: string; message: string }[],
      };
      for (const record of records) {
        try {
          if (isTerminalDurableTaskStatus(record.status)) {
            if (record.lease || await store.readLease(enterpriseId, record.taskId)) {
              await store.releaseLease({ enterpriseId, taskId: record.taskId, token: '', force: true });
            }
            summary.skipped += 1;
            continue;
          }
          if (Date.parse(record.deadlineAt) <= now.getTime()) {
            await expireRecord(record, now, 'task_timeout');
            summary.expired += 1;
            continue;
          }
          if (record.status === 'running') {
            const lease = await store.readLease(enterpriseId, record.taskId);
            if (lease && Date.parse(lease.expiresAt) > now.getTime()) {
              summary.skipped += 1;
              continue;
            }
            await releaseBeforeUpdate(enterpriseId, record.taskId);
            const recovered = await handleAttemptTimeout(record, now, 'lease_expired');
            summary.reclaimed += 1;
            if (recovered.status === 'retrying') summary.retried += 1;
            else if (recovered.status === 'failed') summary.failed += 1;
            else if (recovered.status === 'expired') summary.expired += 1;
            else if (recovered.status === 'waiting') summary.waiting += 1;
            continue;
          }
          if (
            (record.status === 'pending' || record.status === 'retrying' || (record.status === 'waiting' && record.kind !== 'tool.call'))
            && record.nextAttemptAt !== null
            && Date.parse(record.nextAttemptAt) <= now.getTime()
          ) {
            await store.update({
              ...record,
              status: 'queued',
              updatedAt: now.toISOString(),
              nextAttemptAt: now.toISOString(),
              lease: null,
            });
            summary.queued += 1;
            continue;
          }
          summary.skipped += 1;
        } catch (error) {
          summary.errors.push({ taskId: record.taskId, code: codeOf(error), message: messageOf(error) });
        }
      }
      return summary;
    },

    async recoverAll(enterpriseIds) {
      const summaries: DurableTaskRecoverySummary[] = [];
      for (const enterpriseId of [...new Set(enterpriseIds)]) {
        try {
          summaries.push(await runtime.recover(enterpriseId));
        } catch (error) {
          summaries.push({
            enterpriseId,
            scanned: 0,
            reclaimed: 0,
            retried: 0,
            queued: 0,
            expired: 0,
            failed: 0,
            waiting: 0,
            skipped: 0,
            errors: [{ taskId: '', code: codeOf(error), message: messageOf(error) }],
          });
        }
      }
      return summaries;
    },

    async resolveManual(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (!record.manual) {
        throw new WorkflowOperationError(
          'durable_task_manual_missing',
          409,
          `durable task ${input.taskId} is not waiting in the manual queue`,
        );
      }
      const manual: DurableTaskManualQueueEntry = {
        ...record.manual,
        resolvedAt: now.toISOString(),
        resolvedBy: input.resolvedBy,
        resolution: input.resolution,
      };
      if (input.resolution === 'retry') {
        if (record.status === 'succeeded' || record.status === 'cancelled') {
          throw new WorkflowOperationError(
            'durable_task_state_invalid',
            409,
            `durable task ${input.taskId} cannot be retried from ${record.status}`,
          );
        }
        return store.update({
          ...record,
          status: record.kind === 'tool.call' && (record.data.dispatch || record.data.receipt) ? 'waiting' : 'queued',
          manual,
          updatedAt: now.toISOString(),
          finishedAt: null,
          nextAttemptAt: now.toISOString(),
          deadlineAt: new Date(now.getTime() + record.timeouts.taskTimeoutMs).toISOString(),
          cancelRequestedAt: null,
          cancelReason: null,
          lease: null,
        }, { allowTerminalTransition: true });
      }
      if (input.resolution === 'cancel') {
        await releaseBeforeUpdate(input.enterpriseId, input.taskId);
        return store.update({
          ...record,
          status: 'cancelled',
          manual,
          updatedAt: now.toISOString(),
          finishedAt: now.toISOString(),
          nextAttemptAt: null,
          cancelRequestedAt: now.toISOString(),
          cancelReason: input.reason ?? 'manual cancellation',
          lease: null,
        }, { allowTerminalTransition: true, clearLease: 'force' });
      }
      return store.update({
        ...record,
        manual,
        updatedAt: now.toISOString(),
        lease: null,
      });
    },

    async planCompensation(input) {
      const now = clock();
      const record = await requireRecord(input.enterpriseId, input.taskId);
      if (!isTerminalDurableTaskStatus(record.status) || record.status === 'succeeded') {
        throw new WorkflowOperationError(
          'durable_task_state_invalid',
          409,
          `durable task ${input.taskId} is ${record.status}; compensation needs a failed, cancelled or expired task`,
        );
      }
      assertNonEmpty(input.by, 'by');
      const existing = new Set(record.compensations.map((item) => `${item.stepKey}\u0000${item.action}`));
      const additions: DurableTaskCompensation[] = [];
      for (const entry of input.entries) {
        assertNonEmpty(entry.stepKey, 'compensation.stepKey');
        assertNonEmpty(entry.action, 'compensation.action');
        const key = `${entry.stepKey}\u0000${entry.action}`;
        if (existing.has(key)) continue;
        existing.add(key);
        const compensationId = `comp-${createHash('sha256')
          .update(`${input.taskId}\u0000${entry.stepKey}\u0000${entry.action}`)
          .digest('hex')
          .slice(0, 24)}`;
        additions.push({
          compensationId,
          stepKey: entry.stepKey,
          action: entry.action,
          effect: entry.effect,
          status: entry.effect === 'requires_authorization' ? 'pending_authorization' : 'ready',
          authorization: null,
          attempts: 0,
          evidence: entry.evidence ?? {},
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          finishedAt: null,
          errorCode: null,
        });
      }
      if (!additions.length) return record;
      return store.update({
        ...record,
        compensations: [...record.compensations, ...additions],
        updatedAt: now.toISOString(),
        lease: null,
      });
    },

    async authorizeCompensation(input) {
      const now = clock();
      assertNonEmpty(input.grantedBy, 'grantedBy');
      assertNonEmpty(input.reason, 'reason');
      const record = await requireRecord(input.enterpriseId, input.taskId);
      const compensation = record.compensations.find((item) => item.compensationId === input.compensationId);
      if (!compensation) {
        throw new WorkflowOperationError(
          'durable_task_compensation_missing',
          404,
          `compensation ${input.compensationId} was not found`,
        );
      }
      if (compensation.status !== 'pending_authorization') return record;
      return store.update({
        ...record,
        compensations: record.compensations.map((item) => item.compensationId === input.compensationId
          ? {
              ...item,
              status: 'ready' as const,
              authorization: {
                grantedBy: input.grantedBy,
                grantedAt: now.toISOString(),
                reason: input.reason,
              },
              updatedAt: now.toISOString(),
            }
          : item),
        updatedAt: now.toISOString(),
        lease: null,
      });
    },

    async executeCompensations(input) {
      const now = clock();
      let record = await requireRecord(input.enterpriseId, input.taskId);
      let executed = 0;
      let failed = 0;
      let skipped = 0;
      for (const compensation of record.compensations) {
        if (compensation.status !== 'ready') {
          if (compensation.status === 'pending_authorization') skipped += 1;
          continue;
        }
        const running: DurableTaskCompensation = {
          ...compensation,
          status: 'running',
          attempts: compensation.attempts + 1,
          updatedAt: now.toISOString(),
        };
        record = await store.update({
          ...record,
          compensations: record.compensations.map((item) =>
            item.compensationId === running.compensationId ? running : item),
          updatedAt: now.toISOString(),
          lease: null,
        });
        try {
          await input.execute({
            enterpriseId: record.enterpriseId,
            projectId: record.projectId,
            taskId: record.taskId,
            compensation: running,
          });
          const succeeded: DurableTaskCompensation = {
            ...running,
            status: 'succeeded',
            updatedAt: nowIso(),
            finishedAt: nowIso(),
            errorCode: null,
          };
          record = await store.update({
            ...record,
            compensations: record.compensations.map((item) =>
              item.compensationId === succeeded.compensationId ? succeeded : item),
            updatedAt: nowIso(),
            lease: null,
          });
          executed += 1;
        } catch (error) {
          const failedCompensation: DurableTaskCompensation = {
            ...running,
            status: 'failed',
            updatedAt: nowIso(),
            finishedAt: nowIso(),
            errorCode: codeOf(error),
          };
          record = await store.update({
            ...record,
            compensations: record.compensations.map((item) =>
              item.compensationId === failedCompensation.compensationId ? failedCompensation : item),
            updatedAt: nowIso(),
            lease: null,
          });
          failed += 1;
        }
      }
      if (failed > 0) {
        // A failed compensation is a new manual condition even when the task
        // already had an earlier permanent-failure entry.
        record = await store.update({
          ...record,
          manual: {
            reason: 'compensation_failed',
            code: 'compensation_failed',
            queuedAt: record.manual?.resolvedAt
              ? now.toISOString()
              : record.manual?.queuedAt ?? now.toISOString(),
            resolvedAt: null,
            resolvedBy: null,
            resolution: null,
          },
          updatedAt: now.toISOString(),
          lease: null,
        });
      }
      return { record, executed, failed, skipped };
    },
  };
  return runtime;
}
