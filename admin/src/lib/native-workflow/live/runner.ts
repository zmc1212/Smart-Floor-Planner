import { advance, createRunState, type WorkflowEvent } from '../advance';
import { compileDefinition } from '../compile';
import { WorkflowOperationError, workflowIssue, type WorkflowIssue } from '../errors';
import type { PublishedWorkflowVersion } from '../store/types';
import type {
  TriggerEvent,
  WorkflowRunState,
  WorkflowTraceEntry,
  WorkflowValue,
} from '../types';
import {
  LiveOperationFailure,
  LiveOperationUnknownError,
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
  readonly ports: LiveOperationPorts;
  readonly store: LiveRunStore;
  readonly runId: string;
  readonly now?: () => string;
}

function boundPlan(published: PublishedWorkflowVersion) {
  const definition = structuredClone(published.definition);
  const plan = compileDefinition(definition);
  if (
    plan.definitionId !== definition.definitionId
    || plan.revision !== published.revision
    || plan.digest !== published.digest
  ) {
    throw new WorkflowOperationError(
      'published_version_invalid',
      409,
      `published ${definition.definitionId}@${published.revision} does not match its compiled digest`,
    );
  }
  const nodeVersions = Object.fromEntries(
    Object.values(plan.nodes).map((node) => [node.nodeId, node.nodeVersion]),
  );
  const recorded = published.nodeVersions;
  const recordedIds = Object.keys(recorded).sort();
  const planIds = Object.keys(nodeVersions).sort();
  if (
    recordedIds.length !== planIds.length
    || recordedIds.some((nodeId, index) => nodeId !== planIds[index] || recorded[nodeId] !== nodeVersions[nodeId])
  ) {
    throw new WorkflowOperationError(
      'published_version_invalid',
      409,
      `published ${definition.definitionId}@${published.revision} node versions do not match its definition`,
    );
  }
  return { definition, plan, nodeVersions };
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
  const { definition, plan, nodeVersions } = boundPlan(input.published);
  if (definition.inputSchema.eventType !== 'stage_changed') {
    throw new WorkflowOperationError(
      'live_event_type_unsupported',
      400,
      'the B4 live adapter only executes published stage_changed definitions',
    );
  }
  if (input.event.eventType !== 'stage_changed') {
    throw new WorkflowOperationError('live_event_type_unsupported', 400, 'event must be stage_changed');
  }

  const now = input.now ?? (() => new Date().toISOString());
  const event = structuredClone(input.event);
  const binding: LiveRunBinding = {
    runId: input.runId,
    definitionId: definition.definitionId,
    revision: publishedRevision(definition.revision, input.published.revision),
    digest: plan.digest,
    nodeVersions,
    event,
  };
  const context: LiveRunContext = {
    ...binding,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
  };
  let state = createRunState(plan, { runId: input.runId, mode: 'live' });
  const trace: WorkflowTraceEntry[] = [];
  const operations: LiveOperationRecord[] = [];
  const createdAt = now();
  let unknown = false;

  const persist = async (): Promise<LiveRunRecord> => {
    const record: LiveRunRecord = {
      binding,
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      status: statusOf(state, unknown),
      state: structuredClone(state),
      trace: cloneTrace(trace),
      operations: cloneOperations(operations),
      createdAt,
      updatedAt: now(),
    };
    await input.store.save(record);
    return record;
  };

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
  return persist();
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
