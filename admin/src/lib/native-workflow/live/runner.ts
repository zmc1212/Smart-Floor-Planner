import { advance, createRunState, pendingOperation, type WorkflowEvent } from '../advance';
import { WorkflowOperationError, workflowIssue, type WorkflowIssue } from '../errors';
import { validateEffectReceipt } from '../receipts';
import type { PublishedWorkflowVersion } from '../store/types';
import type {
  TriggerEvent,
  WorkflowRunState,
  WorkflowTraceEntry,
  WorkflowValue,
} from '../types';
import { assertSameLiveRunIdentity } from './binding';
import { resolvePublishedTarget } from './published-target';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
  LiveOperationWaiting,
  type LiveBusinessEvent,
  type LiveOperationPorts,
  type LiveOperationRecord,
  type LiveRunBinding,
  type LiveRunContext,
  type LiveRunRecord,
  type LiveRunStatus,
  type LiveRunStore,
  type RuntimeWriteGuard,
} from './types';

export interface LiveRunRegistration {
  readonly published: PublishedWorkflowVersion;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly event: TriggerEvent;
  readonly businessEvent: LiveBusinessEvent;
  readonly store: LiveRunStore;
  readonly writeGuard?: RuntimeWriteGuard;
  readonly runId: string;
  readonly now?: () => string;
}

export interface LiveRunInput extends LiveRunRegistration {
  readonly ports: LiveOperationPorts;
  readonly resume?: boolean;
  readonly wakeEventId?: string;
}

async function registerRun(input: LiveRunRegistration) {
  const { definition, plan, nodeVersions } = resolvePublishedTarget(input.published, input.event);
  const now = input.now?.() ?? new Date().toISOString();
  const binding: LiveRunBinding = {
    runId: input.runId, definitionId: definition.definitionId,
    revision: publishedRevision(definition.revision, input.published.revision), digest: plan.digest, nodeVersions,
    event: structuredClone(input.event), businessEvent: structuredClone(input.businessEvent),
  };
  const record: LiveRunRecord = {
    binding, enterpriseId: input.enterpriseId, projectId: input.projectId, status: 'running',
    state: createRunState(plan, { runId: input.runId, mode: 'live' }),
    trace: [], operations: [], createdAt: now, updatedAt: now,
  };
  const created = await input.store.create(record, input.writeGuard);
  if (!created.created) assertSameLiveRunIdentity(created.record, record);
  return { plan, binding, ...created };
}

/** Reserve the published identity in the same transaction as its business
 * registration. The outbox worker will start the graph on its own lease. */
export async function registerPublishedLiveRun(input: LiveRunRegistration): Promise<LiveRunRecord> {
  return (await registerRun(input)).record;
}

export async function cancelPublishedLiveRun(store: LiveRunStore, runId: string, at: string) {
  const record = await store.get(runId);
  if (!record || !['running', 'waiting'].includes(record.status)) return record;
  const state: WorkflowRunState = { ...record.state, status: 'halted', pendingNodeId: null,
    outcome: 'delegation_cancelled', traceSeq: record.state.traceSeq + 1 };
  return store.update({ ...record, status: 'cancelled', state, updatedAt: at,
    trace: [...record.trace, { seq: state.traceSeq, at, kind: 'run_cancelled',
      nodeId: record.state.pendingNodeId, nodeType: null, mode: 'live' }] });
}

function statusOf(state: WorkflowRunState, unknown: boolean): LiveRunStatus {
  if (unknown) return 'unknown';
  if (state.status === 'running') return 'unknown';
  return state.status;
}

function cloneTrace(trace: readonly WorkflowTraceEntry[]): WorkflowTraceEntry[] {
  return trace.map((entry) => structuredClone(entry));
}

function cloneOperations(operations: readonly LiveOperationRecord[]): LiveOperationRecord[] {
  return operations.map((entry) => structuredClone(entry));
}

/**
 * Executes one published revision, one business event. The compiled plan is
 * captured before the first effect, so later draft edits or publishes cannot
 * change this run. Unknown outcomes stop immediately and are never retried.
 */
export async function runPublishedLive(input: LiveRunInput): Promise<LiveRunRecord> {
  // Same shared check the CLI runs before the first business write. A run that
  // reaches this function again proves the selected version and event still
  // match; no second rule set is maintained here.
  const now = input.now ?? (() => new Date().toISOString());
  const created = await registerRun({ ...input, now });
  const { binding, plan } = created;
  const event = binding.event;
  const context: LiveRunContext = {
    ...binding,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
  };
  let state = structuredClone(created.record.state);
  const trace: WorkflowTraceEntry[] = [];
  const operations: LiveOperationRecord[] = [];
  let unknown = false;

  const snapshot = (createdAt: string): LiveRunRecord => ({
    binding,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
    status: statusOf(state, unknown),
    state: structuredClone(state),
    trace: cloneTrace(trace),
    operations: cloneOperations(operations),
    createdAt,
    updatedAt: now(),
  });

  // The first write is exclusive: a replay of the same runId must observe the
  // original record instead of starting a second execution.
  const canResume = input.resume && event.eventType === 'specialist_followup';
  if (!created.created) {
    if (!canResume || !['waiting', 'running'].includes(created.record.status)) return created.record;
    trace.push(...cloneTrace(created.record.trace));
    operations.push(...cloneOperations(created.record.operations));
    if (input.wakeEventId && state.processedEventIds.includes(input.wakeEventId)) return created.record;
  }
  const createdAt = created.record.createdAt;

  let storeRevision = created.record.storeRevision;
  const persist = async (): Promise<LiveRunRecord> => {
    const record = await input.store.update({
      ...snapshot(createdAt),
      ...(storeRevision === undefined ? {} : { storeRevision }),
    }, input.writeGuard);
    storeRevision = record.storeRevision;
    return record;
  };

  try {
    const started: WorkflowEvent = { type: 'start', at: now(), event };
    if (!state.visitedNodeIds.length) {
      const result = advance(plan, state, started);
      state = result.state;
      trace.push(...cloneTrace(result.trace));
      await persist();
    }
    if (canResume && !created.created && created.record.trace.length && input.wakeEventId) {
      state.traceSeq++;
      trace.push({ seq: state.traceSeq, at: now(), kind: 'run_resumed', nodeId: state.pendingNodeId,
        nodeType: pendingOperation(plan, state)?.nodeType ?? null, mode: 'live', detail: { eventId: input.wakeEventId } });
    }

    while (state.status === 'waiting') {
      const pending = pendingOperation(plan, state);
      if (!pending) {
        unknown = true;
        state.error = workflowIssue('live_runner_stalled', '$', 'run is waiting without a pending operation');
        break;
      }
      const startedAt = now();
      let outputs: Readonly<Record<string, WorkflowValue>> | null = null;
      let failure: WorkflowIssue | null = null;
      let unknownIssue: WorkflowIssue | null = null;
      try {
        outputs = await input.ports.execute(pending, context);
      } catch (error) {
        if (error instanceof LiveOperationFailure) {
          failure = error.issue;
        } else if (error instanceof LiveOperationWaiting && canResume) {
          const last = trace.at(-1);
          if (last?.kind !== 'node_waiting' || last.nodeId !== pending.nodeId) {
            state.traceSeq++;
            trace.push({ seq: state.traceSeq, at: now(), kind: 'node_waiting', nodeId: pending.nodeId,
              nodeType: pending.nodeType, mode: 'live', detail: { code: error.code } });
          }
          if (input.wakeEventId) state.processedEventIds.push(input.wakeEventId);
          return persist();
        } else if (error instanceof LiveOperationUnknownError) {
          unknownIssue = error.issue;
        } else {
          // Specialist effects run within the outbox savepoint. On unexpected errors
          // the whole step rolls back and the existing delivery lease can retry it.
          if (canResume) throw error;
          unknownIssue = workflowIssue(
            'live_operation_unknown',
            `nodes.${pending.nodeId}`,
            error instanceof Error ? error.message.slice(0, 300) : 'operation outcome is unknown',
          );
        }
      }
      const finishedAt = now();
      if (unknownIssue) {
        unknown = true;
        state.error = unknownIssue;
        operations.push({
          nodeId: pending.nodeId,
          capabilityRef: pending.capabilityRef,
          effect: pending.effect,
          nodeVersion: pending.nodeVersion,
          idempotencyKey: pending.idempotencyKey,
          startedAt,
          finishedAt,
          outcome: 'unknown',
          error: unknownIssue,
        });
        break;
      }
      if (!failure && outputs) {
        const node = plan.nodes[pending.nodeId];
        // A returned result is only a success when its receipt is real.
        if (node) failure = validateEffectReceipt(node, outputs, 'live');
      }
      if (failure) {
        operations.push({
          nodeId: pending.nodeId,
          capabilityRef: pending.capabilityRef,
          effect: pending.effect,
          nodeVersion: pending.nodeVersion,
          idempotencyKey: pending.idempotencyKey,
          startedAt,
          finishedAt,
          outcome: 'failed',
          ...(outputs ? { outputs: structuredClone(outputs) } : {}),
          error: failure,
        });
      } else {
        operations.push({
          nodeId: pending.nodeId,
          capabilityRef: pending.capabilityRef,
          effect: pending.effect,
          nodeVersion: pending.nodeVersion,
          idempotencyKey: pending.idempotencyKey,
          startedAt,
          finishedAt,
          outcome: 'succeeded',
          outputs: structuredClone(outputs ?? {}),
        });
      }

      const observation: WorkflowEvent = failure
        ? { type: 'observation', at: finishedAt, nodeId: pending.nodeId, status: 'failed', error: failure }
        : {
            type: 'observation',
            at: finishedAt,
            nodeId: pending.nodeId,
            status: 'succeeded',
            outputs: structuredClone(outputs ?? {}),
          };
      const result = advance(plan, state, observation);
      state = result.state;
      trace.push(...cloneTrace(result.trace));
      await persist();
    }

    if (state.status === 'running') {
      unknown = true;
      state.error = state.error ?? workflowIssue('live_runner_stalled', '$', 'run ended without a terminal state');
    }
    if (input.wakeEventId && !state.processedEventIds.includes(input.wakeEventId)) state.processedEventIds.push(input.wakeEventId);
    return await persist();
  } catch (error) {
    // A concurrent update owns the new checkpoint. Never replace it with an
    // "unknown" status derived from the losing snapshot.
    if (canResume || error instanceof WorkflowOperationError
      && ['runtime_store_conflict', 'runtime_store_lease_lost', 'period_report_schedule_not_active'].includes(error.code)) throw error;
    // The run already exists. A crash here can only be recorded conservatively;
    // nothing is re-executed and no port is called again.
    unknown = true;
    state.status = 'failed';
    state.pendingNodeId = null;
    state.error = workflowIssue(
      'live_runner_error',
      '$',
      error instanceof Error ? error.message.slice(0, 300) : 'live run failed unexpectedly',
    );
    return persist();
  }
}

function publishedRevision(definitionRevision: number, publishedRevision: number): number {
  if (definitionRevision !== publishedRevision) {
    throw new WorkflowOperationError(
      'published_version_invalid',
      409,
      `definition revision ${definitionRevision} does not match published revision ${publishedRevision}`,
    );
  }
  return publishedRevision;
}
