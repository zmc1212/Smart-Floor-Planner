import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { currentStageEvent } from '@/lib/construction/stage-events';
import { readStageSettings } from '@/lib/construction/stages-store';
import { WorkflowOperationError } from '../errors';
import type { LiveBusinessEvent } from './types';
import { readProjectAccess } from './project-access';

export interface ResolveStageReminderBusinessEventInput {
  readonly actor: ConstructionActor;
  readonly projectId: string;
  readonly stageKey: string;
  /** Stable business event key, independent of runId and published revision. */
  readonly sourceEventKey: string;
  /** Existing outbox event selected by the operator, if any. */
  readonly outboxEventId?: string | null;
}

/**
 * Resolve the fixed business event before any workflow effect. The returned
 * progress revision never changes during the run; a retry or a new published
 * revision must reuse it, and an invalidated event stops.
 */
export async function resolveStageReminderBusinessEvent(
  input: ResolveStageReminderBusinessEventInput,
): Promise<LiveBusinessEvent> {
  const actor = input.actor;
  return withTenantTransaction(actor.enterpriseId, async (tx) => {
    const access = await readProjectAccess(tx, actor, input.projectId, 'share');
    const project = access.project;
    if (project.status !== 'active') {
      throw new WorkflowOperationError('construction_project_inactive', 409, 'construction project is not active');
    }
    if (String(project.current_stage_key) !== input.stageKey) {
      throw new WorkflowOperationError(
        'stage_event_mismatch',
        409,
        `project is at ${String(project.current_stage_key)}, not ${input.stageKey}`,
      );
    }
    const settings = await readStageSettings(tx, actor.enterpriseId);
    const stage = settings.stages.find((candidate) => candidate.key === input.stageKey);
    if (!stage) {
      throw new WorkflowOperationError('construction_stage_unavailable', 422, `stage ${input.stageKey} is not configured`);
    }

    // The stable source-event key is the cross-run anchor. It is independent
    // of runId and workflow revision; a note-only progress change must still
    // find the original outbox event instead of the current revision.
    const bySourceKey = await one(
      tx,
      sql`select * from app.domain_event_outbox
        where enterprise_id=${actor.enterpriseId}
          and type='construction.stage.updated.v1'
          and aggregate_type='construction_project'
          and aggregate_id=${input.projectId}
          and payload->>'sourceEventKey'=${input.sourceEventKey}
        order by id limit 1`,
    );

    if (input.outboxEventId) {
      // The explicit event selects a target, but it may never override an
      // existing source-event key binding to another outbox event.
      if (bySourceKey && String(bySourceKey.id) !== input.outboxEventId) {
        throw new WorkflowOperationError(
          'stage_event_conflict',
          409,
          `source event ${input.sourceEventKey} is already bound to outbox event ${String(bySourceKey.id)}`,
        );
      }
      const event = await one(
        tx,
        sql`select * from app.domain_event_outbox
          where enterprise_id=${actor.enterpriseId} and id=${input.outboxEventId}
            and type='construction.stage.updated.v1'
            and aggregate_type='construction_project' and aggregate_id=${input.projectId}`,
      );
      if (!event) {
        throw new WorkflowOperationError(
          'stage_event_not_found',
          404,
          `stage event ${input.outboxEventId} was not found for project ${input.projectId}`,
        );
      }
      return fromOutbox(
        tx,
        actor.enterpriseId,
        project,
        event,
        input.stageKey,
        settings.version,
        input.sourceEventKey,
      );
    }

    if (bySourceKey) {
      return fromOutbox(
        tx,
        actor.enterpriseId,
        project,
        bySourceKey,
        input.stageKey,
        settings.version,
        input.sourceEventKey,
      );
    }

    const progressRevision = Number(project.progress_revision);
    if (!Number.isSafeInteger(progressRevision) || progressRevision < 0) {
      throw new WorkflowOperationError('stage_event_invalid', 409, 'project progress revision is invalid');
    }
    const existing = await one(
      tx,
      sql`select * from app.domain_event_outbox
        where enterprise_id=${actor.enterpriseId}
          and type='construction.stage.updated.v1'
          and aggregate_type='construction_project'
          and aggregate_id=${input.projectId}
          and aggregate_version=${progressRevision}
        limit 1`,
    );
    if (existing) {
      return fromOutbox(
        tx,
        actor.enterpriseId,
        project,
        existing,
        input.stageKey,
        settings.version,
        input.sourceEventKey,
      );
    }
    return {
      outboxEventId: null,
      progressRevision,
      stageKey: input.stageKey,
      settingsVersion: settings.version,
      source: 'current_project_revision',
    };
  });
}

async function fromOutbox(
  tx: PostgresTransaction,
  enterpriseId: string,
  project: Row,
  event: Row,
  stageKey: string,
  currentSettingsVersion: number,
  sourceEventKey: string,
): Promise<LiveBusinessEvent> {
  const payload = event.payload as Row;
  if (String(payload.stageKey) !== stageKey) {
    throw new WorkflowOperationError(
      'stage_event_conflict',
      409,
      `stage event ${String(event.id)} belongs to ${String(payload.stageKey)}, not ${stageKey}`,
    );
  }
  if (typeof payload.sourceEventKey === 'string' && payload.sourceEventKey !== sourceEventKey) {
    throw new WorkflowOperationError(
      'stage_event_conflict',
      409,
      `stage event ${String(event.id)} is already bound to source event ${payload.sourceEventKey}`,
    );
  }
  const progressRevision = Number(event.aggregate_version);
  if (!Number.isSafeInteger(progressRevision) || progressRevision < 0) {
    throw new WorkflowOperationError('stage_event_invalid', 409, 'stage event progress revision is invalid');
  }
  const current = await currentStageEvent(tx, enterpriseId, String(event.id), true);
  if (!current) {
    throw new WorkflowOperationError(
      'stage_event_invalidated',
      409,
      `stage event ${String(event.id)} is no longer the current stage event for project ${String(project.id)}`,
    );
  }
  const settingsVersion = Number(payload.settingsVersion ?? currentSettingsVersion);
  return {
    outboxEventId: String(event.id),
    progressRevision,
    stageKey,
    settingsVersion: Number.isSafeInteger(settingsVersion) && settingsVersion > 0
      ? settingsVersion
      : currentSettingsVersion,
    source: 'outbox',
  };
}
