import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import type { LiveRunBinding, LiveRunRecord } from './types';

function eventKey(event: TriggerEvent): string {
  return [
    event.eventId,
    event.eventType,
    event.occurredAt,
    event.stageKey ?? '',
    event.stageLabel ?? '',
    event.periodKind ?? '',
    event.periodStart ?? '',
    event.periodEnd ?? '',
  ].join('\u0000');
}

function nodeVersionsKey(versions: Readonly<Record<string, string>>): string {
  return Object.keys(versions)
    .sort()
    .map((nodeId) => `${nodeId}=${versions[nodeId]}`)
    .join('\u0000');
}

export function sameLiveBinding(left: LiveRunBinding, right: LiveRunBinding): boolean {
  if (!left.businessEvent || !right.businessEvent) return false;
  return left.runId === right.runId
    && left.definitionId === right.definitionId
    && left.revision === right.revision
    && left.digest === right.digest
    && nodeVersionsKey(left.nodeVersions) === nodeVersionsKey(right.nodeVersions)
    && eventKey(left.event) === eventKey(right.event)
    && left.businessEvent.outboxEventId === right.businessEvent.outboxEventId
    && left.businessEvent.progressRevision === right.businessEvent.progressRevision
    && left.businessEvent.stageKey === right.businessEvent.stageKey
    && left.businessEvent.settingsVersion === right.businessEvent.settingsVersion
    && left.businessEvent.source === right.businessEvent.source
    && left.businessEvent.periodKind === right.businessEvent.periodKind
    && left.businessEvent.periodStart === right.businessEvent.periodStart
    && left.businessEvent.periodEnd === right.businessEvent.periodEnd;
}

export function sameLiveRunIdentity(left: LiveRunRecord, right: LiveRunRecord): boolean {
  return left.enterpriseId === right.enterpriseId
    && left.projectId === right.projectId
    && sameLiveBinding(left.binding, right.binding);
}

/**
 * A runId is permanently bound to one enterprise/project/event/published
 * revision. A retry may replay the same identity; it may never rebind it.
 */
export function assertSameLiveRunIdentity(existing: LiveRunRecord, candidate: LiveRunRecord): void {
  if (!sameLiveRunIdentity(existing, candidate)) {
    throw new WorkflowOperationError(
      'run_binding_conflict',
      409,
      `run ${candidate.binding.runId} is already bound to a different enterprise, project, event or published revision`,
    );
  }
}
