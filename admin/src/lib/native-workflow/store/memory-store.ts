import { WorkflowOperationError } from '../errors';
import {
  cloneRecord,
  summarizeRecord,
  type PublishedWorkflowVersion,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionStore,
  type WorkflowDefinitionSummary,
} from './types';

function draftConflict(record: WorkflowDefinitionRecord): WorkflowOperationError {
  return new WorkflowOperationError('draft_conflict', 409, 'draft revision conflict', {
    currentDraftRevision: record.draft.draftRevision,
  });
}

/** In-memory store for tests and local composition; no persistence. */
export function createMemoryWorkflowStore(): WorkflowDefinitionStore {
  const records = new Map<string, WorkflowDefinitionRecord>();

  return {
    async list(): Promise<WorkflowDefinitionSummary[]> {
      return [...records.values()]
        .map((record) => summarizeRecord(record))
        .sort((left, right) => left.definitionId.localeCompare(right.definitionId));
    },

    async get(definitionId: string): Promise<WorkflowDefinitionRecord | null> {
      const record = records.get(definitionId);
      return record ? cloneRecord(record) : null;
    },

    async create({ definition, now }): Promise<WorkflowDefinitionRecord> {
      if (records.has(definition.definitionId)) {
        throw new WorkflowOperationError('definition_exists', 409, `definition ${definition.definitionId} already exists`);
      }
      const record: WorkflowDefinitionRecord = {
        definitionId: definition.definitionId,
        draft: {
          definition: structuredClone(definition),
          draftRevision: 1,
          updatedAt: now,
          basePublishedRevision: 0,
        },
        versions: [],
      };
      records.set(definition.definitionId, record);
      return cloneRecord(record);
    },

    async saveDraft({ definitionId, definition, expectedDraftRevision, now }): Promise<WorkflowDefinitionRecord> {
      const record = records.get(definitionId);
      if (!record) {
        throw new WorkflowOperationError('definition_not_found', 404, `definition ${definitionId} was not found`);
      }
      if (record.draft.draftRevision !== expectedDraftRevision) throw draftConflict(record);
      const updated: WorkflowDefinitionRecord = {
        ...record,
        draft: {
          definition: structuredClone(definition),
          draftRevision: record.draft.draftRevision + 1,
          updatedAt: now,
          basePublishedRevision: record.versions[record.versions.length - 1]?.revision ?? 0,
        },
      };
      records.set(definitionId, updated);
      return cloneRecord(updated);
    },

    async appendVersion({ definitionId, expectedDraftRevision, version }): Promise<WorkflowDefinitionRecord> {
      const record = records.get(definitionId);
      if (!record) {
        throw new WorkflowOperationError('definition_not_found', 404, `definition ${definitionId} was not found`);
      }
      if (record.draft.draftRevision !== expectedDraftRevision) throw draftConflict(record);
      const latestRevision = record.versions[record.versions.length - 1]?.revision ?? 0;
      if (version.revision !== latestRevision + 1) {
        throw new WorkflowOperationError('version_conflict', 409, 'published version is not the next revision', {
          latestPublishedRevision: latestRevision,
        });
      }
      const published: PublishedWorkflowVersion = structuredClone(version);
      const updated: WorkflowDefinitionRecord = {
        ...record,
        versions: [...record.versions, published],
      };
      records.set(definitionId, updated);
      return cloneRecord(updated);
    },
  };
}
