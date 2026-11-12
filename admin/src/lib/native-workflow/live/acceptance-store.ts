/** Acceptance-only definition publishing into an explicit per-run store.
 *
 * A B5.1 acceptance run must not read or write the normal B management store
 * (`tmp/native-workflow-store`). This helper opens the store directory it is
 * given, creates the deterministic template there and publishes revision 1,
 * so the caller can bind the CLI to one fixed definitionId/revision/digest.
 */
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import { createWorkflowService } from '../service';
import { createFileWorkflowStore } from '../store/file-store';
import type { PublishedWorkflowVersion } from '../store/types';
import { createStageReminderDefinition } from '../templates';

export interface PublishAcceptanceDefinitionInput {
  /** Dedicated store directory, never the normal B store. */
  readonly storeDir: string;
  readonly definitionId: string;
  readonly now?: string;
}

export interface AcceptancePublication {
  readonly definitionId: string;
  readonly revision: number;
  readonly digest: string;
  readonly created: boolean;
  readonly version: PublishedWorkflowVersion;
}

export async function publishAcceptanceDefinition(
  input: PublishAcceptanceDefinitionInput,
): Promise<AcceptancePublication> {
  const definition = createStageReminderDefinition();
  if (definition.definitionId !== input.definitionId) {
    throw new WorkflowOperationError(
      'invalid_request',
      400,
      `the acceptance store only publishes ${definition.definitionId}, not ${input.definitionId}`,
    );
  }

  const now = input.now ?? new Date().toISOString();
  const store = createFileWorkflowStore({ rootDir: path.resolve(input.storeDir) });
  const service = createWorkflowService({ store, now: () => now });

  let record = await store.get(input.definitionId);
  if (!record) record = await store.create({ definition, now });
  const saved = await service.saveDraft({
    definitionId: input.definitionId,
    definition,
    expectedDraftRevision: record.draft.draftRevision,
  });
  const published = await service.publishDraft({
    definitionId: input.definitionId,
    expectedDraftRevision: saved.draft.draftRevision,
  });

  return {
    definitionId: published.version.definition.definitionId,
    revision: published.version.revision,
    digest: published.version.digest,
    created: published.created,
    version: published.version,
  };
}
