/** Shared published-target check for the B live adapter.
 *
 * One published revision is selected by the caller; this module proves that
 * the selected record is internally consistent and can execute the fixed
 * event. The live runner and the period-report entry point both call this
 * exact function, so the CLI precheck and the runner cannot drift apart.
 *
 * Nothing here writes or calls a port: a rejected target must be safe to run
 * before any business binding, run record or enqueue.
 */

import { compileDefinition, type CompiledWorkflowPlan } from '../compile';
import { WorkflowOperationError } from '../errors';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent, WorkflowDefinition } from '../types';

export interface PublishedTarget {
  readonly definition: WorkflowDefinition;
  readonly plan: CompiledWorkflowPlan;
  readonly nodeVersions: Readonly<Record<string, string>>;
}

function invalidVersion(message: string): never {
  throw new WorkflowOperationError('published_version_invalid', 409, message);
}

/**
 * Validate the published revision and its event binding.
 *
 * Checks, in order: the compiled definitionId/revision/digest, the recorded
 * node versions, the supported event type, and the published period kind.
 * Existing error codes (`published_version_invalid`,
 * `live_event_type_unsupported`) are preserved.
 */
export function resolvePublishedTarget(
  published: PublishedWorkflowVersion,
  event: TriggerEvent,
): PublishedTarget {
  const definition = structuredClone(published.definition);
  const plan = compileDefinition(definition);
  if (
    plan.definitionId !== definition.definitionId
    || plan.revision !== published.revision
    || plan.digest !== published.digest
  ) {
    invalidVersion(
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
    invalidVersion(
      `published ${definition.definitionId}@${published.revision} node versions do not match its definition`,
    );
  }

  if (definition.inputSchema.eventType !== event.eventType) {
    throw new WorkflowOperationError(
      'live_event_type_unsupported',
      400,
      `published ${definition.definitionId} accepts ${definition.inputSchema.eventType}, not ${event.eventType}`,
    );
  }
  if (definition.inputSchema.eventType !== 'stage_changed' && definition.inputSchema.eventType !== 'period_report' && definition.inputSchema.eventType !== 'specialist_followup') {
    throw new WorkflowOperationError(
      'live_event_type_unsupported',
      400,
      `the B live adapter does not execute ${definition.inputSchema.eventType} definitions`,
    );
  }
  if (
    definition.inputSchema.eventType === 'period_report'
    && definition.inputSchema.periodKind !== event.periodKind
  ) {
    throw new WorkflowOperationError(
      'live_event_type_unsupported',
      400,
      `published ${definition.definitionId} accepts ${definition.inputSchema.periodKind ?? '(unspecified)'} periods, not ${event.periodKind ?? '(unspecified)'}`,
    );
  }

  return { definition, plan, nodeVersions };
}
