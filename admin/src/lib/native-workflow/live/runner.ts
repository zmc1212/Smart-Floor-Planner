import { advance, createRunState, type WorkflowEvent } from '../advance';
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
  type LiveBusinessEvent,
  type LiveOperationPorts,
  type LiveOperationRecord,
  type LiveRunBinding,
  type LiveRunContext,
  type LiveRunRecord,
  type LiveRunStatus,
  type LiveRunStore,
} from './types';

export interface LiveRunInput {
  readonly published: PublishedWorkflowVersion;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly event: TriggerEvent;
  readonly businessEvent: LiveBusinessEvent;
  readonly ports: LiveOperationPorts;
  readonly store: LiveRunStore;
  readonly runId: string;
  readonly now?: () => string;
}

function statusOf(state: WorkflowRunState, unknown: boolean): LiveRunStatus {
  if (unknown) return 'unknown';
  if (state.status === 'running' || state.status === 'waiting') return 'unknown';
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
  const { definition, plan, nodeVersions } = resolvePublishedTarget(input.published, input.event);

  const now = input.now ?? (() => new Date().toISOString());
  const event = structuredClone(input.event);
  const binding: LiveRunBinding = {
    runId: input.runId,
    definitionId: definition.definitionId,
    revision: publishedRevision(definition.revision, input.published.revision),
    digest: plan.digest,
    nodeVersions,
    event,
    businessEvent: structuredClone(input.businessEvent),
  };
  const context: LiveRunContext = {
    ...binding,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
  };
  let state = createRunState(plan, { runId: input.runId, mode: 'live' });
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
  const initial: LiveRunRecord = { ...snapshot(now()), status: 'running' };
  const created = await input.store.create(initial);
  if (!created.created) {
    assertSameLiveRunIdentity(created.record, initial);
    return created.record;
  }
  const createdAt = created.record.createdAt;

  const persist = async (): Promise<LiveRunRecord> => input.store.update(snapshot(createdAt));

  try {
    const started: WorkflowEvent = { type: 'start', at: now(), event };
    let result = advance(plan, state, started);
    state = result.state;
    trace.push(...cloneTrace(result.trace));
    await persist();

    while (state.status === 'waiting') {
      const pending = result.pending[0];
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
        } else if (error instanceof LiveOperationUnknownError) {
          unknownIssue = error.issue;
        } else {
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
      result = advance(plan, state, observation);
      state = result.state;
      trace.push(...cloneTrace(result.trace));
      await persist();
    }

    if (state.status === 'running') {
      unknown = true;
      state.error = state.error ?? workflowIssue('live_runner_stalled', '$', 'run ended without a terminal state');
    }
    return await persist();
  } catch (error) {
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
