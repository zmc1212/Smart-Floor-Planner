import type { WorkflowIssue } from '../errors';
import type {
  PendingOperation,
  TriggerEvent,
  WorkflowRunState,
  WorkflowTraceEntry,
  WorkflowValue,
} from '../types';

/** The fixed server-side business event identity used by save/delivery/retry.
 *
 * Stage reminders bind the construction stage event. Period reports have no
 * outbox stage event: their fixed identity is the business period itself, so
 * the stage fields carry neutral values and the period fields are authoritative.
 */
export interface LiveBusinessEvent {
  readonly outboxEventId: string | null;
  readonly progressRevision: number;
  readonly stageKey: string;
  readonly settingsVersion: number;
  readonly source: 'outbox' | 'current_project_revision';
  readonly periodKind?: 'daily' | 'weekly';
  readonly periodStart?: string;
  readonly periodEnd?: string;
}

/** Immutable version and business-event binding captured when a run starts. */
export interface LiveRunBinding {
  readonly runId: string;
  readonly definitionId: string;
  readonly revision: number;
  readonly digest: string;
  readonly nodeVersions: Readonly<Record<string, string>>;
  readonly event: TriggerEvent;
  readonly businessEvent: LiveBusinessEvent;
}

/** Host identity and business scope. A definition can never override these. */
export interface LiveRunContext extends LiveRunBinding {
  readonly enterpriseId: string;
  readonly projectId: string;
}

export type LiveRunStatus = 'running' | 'waiting' | 'completed' | 'halted' | 'failed' | 'unknown';

export type LiveOperationOutcome = 'succeeded' | 'failed' | 'unknown';

export interface LiveOperationRecord {
  readonly nodeId: string;
  readonly capabilityRef: string;
  readonly effect: PendingOperation['effect'];
  readonly nodeVersion: string;
  readonly idempotencyKey: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: LiveOperationOutcome;
  readonly outputs?: Readonly<Record<string, WorkflowValue>>;
  readonly error?: WorkflowIssue;
}

/** Queryable, B-owned execution record. Business truth stays in the outbox. */
export interface LiveRunRecord {
  readonly binding: LiveRunBinding;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly status: LiveRunStatus;
  readonly state: WorkflowRunState;
  readonly trace: readonly WorkflowTraceEntry[];
  readonly operations: readonly LiveOperationRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LiveRunCreateResult {
  readonly created: boolean;
  readonly record: LiveRunRecord;
}

export interface LiveRunStore {
  /** Exclusive first write. An existing runId returns the original record. */
  create(record: LiveRunRecord): Promise<LiveRunCreateResult>;
  /** Checkpoint update; must reject a different event/project/revision. */
  update(record: LiveRunRecord): Promise<LiveRunRecord>;
  get(runId: string): Promise<LiveRunRecord | null>;
  list(limit?: number): Promise<LiveRunRecord[]>;
}

/**
 * Host ports for live effects. Implementations must use existing business
 * services and return their real records/receipts.
 */
export interface LiveOperationPorts {
  execute(
    operation: PendingOperation,
    context: LiveRunContext,
  ): Promise<Readonly<Record<string, WorkflowValue>>>;
}

/** A known business failure; the transaction has rolled back. */
export class LiveOperationFailure extends Error {
  readonly issue: WorkflowIssue;

  constructor(issue: WorkflowIssue) {
    super(issue.message);
    this.name = 'LiveOperationFailure';
    this.issue = issue;
  }
}

/** The effect may have committed; never retry automatically. */
export class LiveOperationUnknownError extends Error {
  readonly issue: WorkflowIssue;

  constructor(issue: WorkflowIssue) {
    super(issue.message);
    this.name = 'LiveOperationUnknownError';
    this.issue = issue;
  }
}
