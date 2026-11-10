import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import { validateDefinition } from '../validate';
import {
  cloneRecord,
  summarizeRecord,
  type PublishedWorkflowVersion,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionStore,
  type WorkflowDefinitionSummary,
} from './types';

const definitionIdPattern = /^[a-z][a-z0-9_-]{2,63}$/;
const STORE_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function draftConflict(record: WorkflowDefinitionRecord): WorkflowOperationError {
  return new WorkflowOperationError('draft_conflict', 409, 'draft revision conflict', {
    currentDraftRevision: record.draft.draftRevision,
  });
}

function recordPath(rootDir: string, definitionId: string): string {
  if (!definitionIdPattern.test(definitionId)) {
    throw new WorkflowOperationError('definition_not_found', 404, `definition ${definitionId} is not a valid id`);
  }
  return path.join(rootDir, `${definitionId}.json`);
}

function parseStoredRecord(text: string, file: string): WorkflowDefinitionRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} is not valid JSON`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} has an invalid shape`);
  }
  const data = raw as Record<string, unknown>;
  if (data.storeVersion !== STORE_VERSION) {
    throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} has an unsupported version`);
  }
  const record = data as unknown as WorkflowDefinitionRecord;
  const draftCheck = validateDefinition(record.draft?.definition);
  if (!draftCheck.ok || draftCheck.definition.definitionId !== record.definitionId) {
    throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} has an invalid draft`);
  }
  if (!Array.isArray(record.versions) || typeof record.draft?.draftRevision !== 'number') {
    throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} has an invalid draft revision`);
  }
  const versions = [...record.versions].sort((left, right) => left.revision - right.revision);
  for (const version of versions) {
    const versionCheck = validateDefinition(version.definition);
    if (!versionCheck.ok || versionCheck.definition.definitionId !== record.definitionId) {
      throw new WorkflowOperationError('store_corrupt', 500, `store file ${file} has an invalid published version`);
    }
  }
  return { ...record, versions };
}

async function readRecord(rootDir: string, definitionId: string): Promise<WorkflowDefinitionRecord | null> {
  const file = recordPath(rootDir, definitionId);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError('store_error', 500, `failed to read store file ${file}`);
  }
  return parseStoredRecord(text, file);
}

async function writeRecord(rootDir: string, record: WorkflowDefinitionRecord): Promise<void> {
  const file = recordPath(rootDir, record.definitionId);
  await mkdir(rootDir, { recursive: true });
  const payload = { storeVersion: STORE_VERSION, ...record };
  try {
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    throw new WorkflowOperationError('store_error', 500, `failed to write store file ${file}`);
  }
}

/**
 * B3 file-backed store under a B-owned directory. It is deliberately not a
 * shared database migration: the integration lead can swap this adapter for a
 * Postgres store behind the same interface.
 */
export function createFileWorkflowStore(options: { readonly rootDir: string }): WorkflowDefinitionStore {
  const rootDir = path.resolve(options.rootDir);

  return {
    async list(): Promise<WorkflowDefinitionSummary[]> {
      await mkdir(rootDir, { recursive: true });
      const entries = await readdir(rootDir, { withFileTypes: true });
      const summaries: WorkflowDefinitionSummary[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const definitionId = entry.name.slice(0, -'.json'.length);
        const record = await readRecord(rootDir, definitionId);
        if (record) summaries.push(summarizeRecord(record));
      }
      return summaries.sort((left, right) => left.definitionId.localeCompare(right.definitionId));
    },

    async get(definitionId: string): Promise<WorkflowDefinitionRecord | null> {
      const record = await readRecord(rootDir, definitionId);
      return record ? cloneRecord(record) : null;
    },

    async create({ definition, now }): Promise<WorkflowDefinitionRecord> {
      return withLock(recordPath(rootDir, definition.definitionId), async () => {
        const existing = await readRecord(rootDir, definition.definitionId);
        if (existing) {
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
        await writeRecord(rootDir, record);
        return cloneRecord(record);
      });
    },

    async saveDraft({ definitionId, definition, expectedDraftRevision, now }): Promise<WorkflowDefinitionRecord> {
      return withLock(recordPath(rootDir, definitionId), async () => {
        const record = await readRecord(rootDir, definitionId);
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
        await writeRecord(rootDir, updated);
        return cloneRecord(updated);
      });
    },

    async appendVersion({ definitionId, expectedDraftRevision, version }): Promise<WorkflowDefinitionRecord> {
      return withLock(recordPath(rootDir, definitionId), async () => {
        const record = await readRecord(rootDir, definitionId);
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
        await writeRecord(rootDir, updated);
        return cloneRecord(updated);
      });
    },
  };
}

/** B-owned store directory; override with NATIVE_WORKFLOW_STORE_DIR. */
export function resolveNativeWorkflowStoreDir(): string {
  const configured = process.env.NATIVE_WORKFLOW_STORE_DIR?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), 'tmp', 'native-workflow-store');
}
