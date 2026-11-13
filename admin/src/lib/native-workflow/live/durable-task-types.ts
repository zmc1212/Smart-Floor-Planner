/** Durable long-running task contract for the native workflow B line.
 *
 * The task state machine is intentionally business-agnostic: it records
 * lifecycle, ownership, attempts, deadlines, partial steps, manual hand-off and
 * compensations, but never decides what a business step means. Host adapters
 * (the tool executor already included) own that interpretation.
 *
 * Every record is tenant-scoped by `enterpriseId`; the file store keeps each
 * tenant in its own directory and refuses a record whose identity does not
 * match that directory.
 */

/** JSON-serializable durable payload; the core never interprets its shape. */
export type DurableTaskDataValue =
  | string
  | number
  | boolean
  | null
  | readonly DurableTaskDataValue[]
  | { readonly [key: string]: DurableTaskDataValue };

export type DurableTaskData = Readonly<Record<string, DurableTaskDataValue>>;

export const DURABLE_TASK_VERSION = 1 as const;

export type DurableTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export const TERMINAL_DURABLE_TASK_STATUSES: readonly DurableTaskStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
];

export function isTerminalDurableTaskStatus(status: DurableTaskStatus): boolean {
  return TERMINAL_DURABLE_TASK_STATUSES.includes(status);
}

/** `business_rejection` is a valid business answer, not an infrastructure fault. */
export type DurableTaskErrorClass = 'transient' | 'permanent' | 'business_rejection';

/** How a task is recovered after its worker died without releasing the lease. */
export type DurableTaskRecoveryMode = 'retry' | 'reconcile';

export interface DurableTaskTimeouts {
  /** Whole-task budget; exceeding it turns the task into `expired`. */
  readonly taskTimeoutMs: number;
  /** One execution/lease budget; exceeding it releases the worker. */
  readonly attemptTimeoutMs: number;
  /** One external call (dispatch/probe/save) budget. */
  readonly externalCallTimeoutMs: number;
}

export interface DurableTaskRetryPolicy {
  /** Total attempts including the first one. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** 0 = no jitter, 0.2 = +/-20%. */
  readonly jitterRatio: number;
  /** Per-tenant sliding window used to stop a retry storm. */
  readonly stormWindowMs: number;
  readonly stormLimit: number;
}

export interface DurableTaskDelegation {
  /** The acting user/admin that originally delegated the work. */
  readonly requestedBy: string;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  /** The assistant run or live workflow run that owns this task. */
  readonly runId: string | null;
  readonly delegationId?: string;
}

export type DurableTaskStepStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export interface DurableTaskStep {
  readonly key: string;
  readonly status: DurableTaskStepStatus;
  readonly attempts: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
  readonly outputs: DurableTaskData | null;
}

export type DurableTaskAttemptOutcome =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'timed_out'
  | 'cancelled';

export interface DurableTaskAttempt {
  readonly attempt: number;
  readonly owner: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: DurableTaskAttemptOutcome;
  readonly errorClass: DurableTaskErrorClass | null;
  readonly errorCode: string | null;
  readonly durationMs: number | null;
}

export interface DurableTaskLease {
  readonly owner: string;
  /** Fencing token; a previous owner can never commit with an older token. */
  readonly token: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
}

export interface DurableTaskManualQueueEntry {
  readonly reason: string;
  readonly code: string | null;
  readonly queuedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolution: 'retry' | 'cancel' | 'close' | null;
}

export type DurableTaskCompensationStatus =
  | 'pending_authorization'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface DurableTaskCompensationAuthorization {
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly reason: string;
}

export interface DurableTaskCompensation {
  readonly compensationId: string;
  readonly stepKey: string;
  readonly action: string;
  /**
   * `requires_authorization` compensations can change an already committed
   * business agreement, so they never run before an explicit authorization.
   */
  readonly effect: 'reversible' | 'requires_authorization';
  readonly status: DurableTaskCompensationStatus;
  readonly authorization: DurableTaskCompensationAuthorization | null;
  readonly attempts: number;
  readonly evidence: DurableTaskData;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
}

export interface DurableTaskLastError {
  readonly class: DurableTaskErrorClass;
  readonly code: string;
  readonly message: string;
}

export interface DurableTaskRecord {
  readonly storeRevision?: number;
  readonly taskVersion: typeof DURABLE_TASK_VERSION;
  readonly taskId: string;
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly kind: string;
  /** Stable dedupe key inside one tenant; a repeat create adopts the original. */
  readonly businessKey: string;
  readonly delegation: DurableTaskDelegation;
  readonly status: DurableTaskStatus;
  readonly recoveryMode: DurableTaskRecoveryMode;
  readonly timeouts: DurableTaskTimeouts;
  readonly retry: DurableTaskRetryPolicy;
  readonly attempts: readonly DurableTaskAttempt[];
  readonly steps: readonly DurableTaskStep[];
  readonly compensations: readonly DurableTaskCompensation[];
  readonly manual: DurableTaskManualQueueEntry | null;
  /** Host-owned durable payload; the core never reads its business meaning. */
  readonly data: DurableTaskData;
  readonly lastError: DurableTaskLastError | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly deadlineAt: string;
  readonly nextAttemptAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly cancelReason: string | null;
  /** Derived from the authoritative store lease on every read. */
  readonly lease: DurableTaskLease | null;
}

export interface DurableTaskListQuery {
  readonly enterpriseId: string;
  readonly taskId?: string;
  readonly statuses?: readonly DurableTaskStatus[];
  readonly kind?: string;
  readonly manualOnly?: boolean;
  /** Worker-side filters for registered tools and reclaimable work. */
  readonly tool?: string;
  readonly readyAt?: Date;
  readonly limit?: number;
}

export interface DurableTaskClaim {
  readonly record: DurableTaskRecord;
  readonly lease: DurableTaskLease;
}

export interface DurableTaskRecoverySummary {
  readonly enterpriseId: string;
  readonly scanned: number;
  readonly reclaimed: number;
  readonly retried: number;
  readonly queued: number;
  readonly expired: number;
  readonly failed: number;
  readonly waiting: number;
  readonly skipped: number;
  readonly errors: readonly { readonly taskId: string; readonly code: string; readonly message: string }[];
}
