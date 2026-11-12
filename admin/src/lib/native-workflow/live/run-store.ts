import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import { assertSameLiveRunIdentity } from './binding';
import type { LiveRunCreateResult, LiveRunRecord, LiveRunStore } from './types';

const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const STORE_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function runPath(rootDir: string, runId: string): string {
  if (!runIdPattern.test(runId)) {
    throw new WorkflowOperationError('run_not_found', 404, `run ${runId} is not a valid id`);
  }
  return path.join(rootDir, 'runs', `${runId}.json`);
}

function clone(record: LiveRunRecord): LiveRunRecord {
  return structuredClone(record);
}

function serialize(record: LiveRunRecord): string {
  return `${JSON.stringify({ storeVersion: STORE_VERSION, record }, null, 2)}\n`;
}

function parseRecord(text: string, file: string): LiveRunRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowOperationError('run_store_corrupt', 500, `run file ${file} is not valid JSON`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError('run_store_corrupt', 500, `run file ${file} has an invalid shape`);
  }
  const data = raw as Record<string, unknown>;
  const record = data.record as LiveRunRecord | undefined;
  if (data.storeVersion !== STORE_VERSION || !record || typeof record.binding?.runId !== 'string') {
    throw new WorkflowOperationError('run_store_corrupt', 500, `run file ${file} has an unsupported shape`);
  }
  return record;
}

async function readRecord(rootDir: string, runId: string): Promise<LiveRunRecord | null> {
  const file = runPath(rootDir, runId);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError('run_store_error', 500, `failed to read run file ${file}`);
  }
  return parseRecord(text, file);
}

async function writeRecord(rootDir: string, record: LiveRunRecord): Promise<void> {
  const file = runPath(rootDir, record.binding.runId);
  await mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, serialize(record), 'utf8');
    await rename(tempFile, file);
  } catch {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw new WorkflowOperationError('run_store_error', 500, `failed to write run file ${file}`);
  }
}

function runNotFound(runId: string): WorkflowOperationError {
  return new WorkflowOperationError('run_not_found', 404, `run ${runId} was not found`);
}

export function createFileWorkflowRunStore(options: { readonly rootDir: string }): LiveRunStore {
  const rootDir = path.resolve(options.rootDir);

  return {
    async create(record): Promise<LiveRunCreateResult> {
      const file = runPath(rootDir, record.binding.runId);
      return withLock(file, async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(tempFile, serialize(record), 'utf8');
          try {
            // COPYFILE_EXCL fails with EEXIST instead of overwriting an existing run.
            await copyFile(tempFile, file, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await readRecord(rootDir, record.binding.runId);
            if (!existing) throw error;
            return { created: false, record: clone(existing) } satisfies LiveRunCreateResult;
          }
          return { created: true, record: clone(record) } satisfies LiveRunCreateResult;
        } catch (error) {
          if (error instanceof WorkflowOperationError) throw error;
          throw new WorkflowOperationError('run_store_error', 500, `failed to create run file ${file}`);
        } finally {
          await rm(tempFile, { force: true }).catch(() => undefined);
        }
      });
    },

    async update(record): Promise<LiveRunRecord> {
      const file = runPath(rootDir, record.binding.runId);
      return withLock(file, async () => {
        const existing = await readRecord(rootDir, record.binding.runId);
        if (!existing) throw runNotFound(record.binding.runId);
        assertSameLiveRunIdentity(existing, record);
        const next: LiveRunRecord = { ...clone(record), createdAt: existing.createdAt };
        await writeRecord(rootDir, next);
        return clone(next);
      });
    },

    async get(runId): Promise<LiveRunRecord | null> {
      const record = await readRecord(rootDir, runId);
      return record ? clone(record) : null;
    },

    async list(limit = 20): Promise<LiveRunRecord[]> {
      const dir = path.join(rootDir, 'runs');
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir, { withFileTypes: true });
      const records: LiveRunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const runId = entry.name.slice(0, -'.json'.length);
        const record = await readRecord(rootDir, runId);
        if (record) records.push(record);
      }
      return records
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(limit, 100)));
    },
  };
}

export function createMemoryWorkflowRunStore(): LiveRunStore {
  const records = new Map<string, LiveRunRecord>();
  return {
    async create(record) {
      const existing = records.get(record.binding.runId);
      if (existing) return { created: false, record: clone(existing) };
      const stored = clone(record);
      records.set(record.binding.runId, stored);
      return { created: true, record: clone(stored) };
    },
    async update(record) {
      const existing = records.get(record.binding.runId);
      if (!existing) throw runNotFound(record.binding.runId);
      assertSameLiveRunIdentity(existing, record);
      const next: LiveRunRecord = { ...clone(record), createdAt: existing.createdAt };
      records.set(record.binding.runId, next);
      return clone(next);
    },
    async get(runId) {
      const record = records.get(runId);
      return record ? clone(record) : null;
    },
    async list(limit = 20) {
      return [...records.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(limit, 100)))
        .map(clone);
    },
  };
}
