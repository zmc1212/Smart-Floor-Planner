/** Tenant-scoped durable task store for the native workflow B line.
 *
 * Layout under one root:
 *   tenants/<enterpriseId>/tasks/<taskId>.json   task record
 *   tenants/<enterpriseId>/leases/<taskId>.json  authoritative lease
 *
 * Persistence reuses the B-store convention: a unique same-directory temporary
 * file, a complete write, then an atomic rename; `create` is exclusive via
 * COPYFILE_EXCL. The lease is an exclusive `wx` file with an expiry, so a
 * crashed worker's task is reclaimable only after its TTL, and a stale worker
 * can never renew or release a newer owner's lease.
 *
 * The lease file is the ownership authority; the `lease` field returned on a
 * record is derived from it and never trusted from the caller.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import {
  DURABLE_TASK_VERSION,
  isTerminalDurableTaskStatus,
  type DurableTaskLease,
  type DurableTaskListQuery,
  type DurableTaskRecord,
} from './durable-task-types';

export const DURABLE_TASK_STORE_VERSION = 1;
const ENTERPRISE_PATTERN = /^[1-9]\d{0,18}$/;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const locks = new Map<string, Promise<unknown>>();

export interface DurableTaskCreateResult {
  readonly created: boolean;
  readonly record: DurableTaskRecord;
}

export interface DurableTaskLeaseInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly owner: string;
  readonly token: string;
  readonly ttlMs: number;
  readonly now: Date;
}

export interface DurableTaskLeaseResult {
  readonly acquired: boolean;
  readonly lease: DurableTaskLease | null;
}

export interface DurableTaskReleaseInput {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly token: string;
  /** Operator cancellation releases a lease it does not own. */
  readonly force?: boolean;
}

export interface DurableTaskStore {
  create(record: DurableTaskRecord): Promise<DurableTaskCreateResult>;
  /** `allowTerminalTransition` is reserved for an explicit operator resolution. */
  update(
    record: DurableTaskRecord,
    options?: { readonly allowTerminalTransition?: boolean },
  ): Promise<DurableTaskRecord>;
  get(enterpriseId: string, taskId: string): Promise<DurableTaskRecord | null>;
  list(query: DurableTaskListQuery): Promise<DurableTaskRecord[]>;
  acquireLease(input: DurableTaskLeaseInput): Promise<DurableTaskLeaseResult>;
  renewLease(input: DurableTaskLeaseInput): Promise<DurableTaskLease>;
  releaseLease(input: DurableTaskReleaseInput): Promise<void>;
  readLease(enterpriseId: string, taskId: string): Promise<DurableTaskLease | null>;
}

/** The B-owned durable task root. */
export function resolveNativeWorkflowTaskDir(): string {
  return process.env.NATIVE_WORKFLOW_TASK_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-tasks');
}

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function assertEnterpriseId(value: string): void {
  if (!ENTERPRISE_PATTERN.test(value)) {
    throw new WorkflowOperationError(
      'durable_task_tenant_invalid',
      422,
      `enterprise id ${JSON.stringify(value)} is not a positive integer id`,
    );
  }
}

function assertTaskId(value: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new WorkflowOperationError(
      'durable_task_id_invalid',
      422,
      `task id ${JSON.stringify(value)} is not a valid id`,
    );
  }
}

function tenantDir(rootDir: string, enterpriseId: string): string {
  assertEnterpriseId(enterpriseId);
  return path.join(rootDir, 'tenants', enterpriseId);
}

function taskPath(rootDir: string, enterpriseId: string, taskId: string): string {
  assertTaskId(taskId);
  return path.join(tenantDir(rootDir, enterpriseId), 'tasks', `${taskId}.json`);
}

function leasePath(rootDir: string, enterpriseId: string, taskId: string): string {
  assertTaskId(taskId);
  return path.join(tenantDir(rootDir, enterpriseId), 'leases', `${taskId}.json`);
}

function clone(record: DurableTaskRecord): DurableTaskRecord {
  return structuredClone(record);
}

function serialize(record: DurableTaskRecord): string {
  const persisted: Record<string, unknown> = { ...record };
  // The lease file is authoritative; never duplicate it in the task record.
  delete persisted.lease;
  return `${JSON.stringify({ storeVersion: DURABLE_TASK_STORE_VERSION, record: persisted }, null, 2)}\n`;
}

function parseRecord(text: string, file: string): DurableTaskRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowOperationError(
      'durable_task_store_corrupt',
      500,
      `durable task file ${file} is not valid JSON`,
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError(
      'durable_task_store_corrupt',
      500,
      `durable task file ${file} has an invalid shape`,
    );
  }
  const data = raw as Record<string, unknown>;
  const record = data.record as DurableTaskRecord | undefined;
  if (
    data.storeVersion !== DURABLE_TASK_STORE_VERSION
    || !record
    || record.taskVersion !== DURABLE_TASK_VERSION
    || typeof record.taskId !== 'string'
    || typeof record.enterpriseId !== 'string'
    || typeof record.status !== 'string'
  ) {
    throw new WorkflowOperationError(
      'durable_task_store_corrupt',
      500,
      `durable task file ${file} has an unsupported shape`,
    );
  }
  return { ...record, lease: null };
}

async function readRecord(rootDir: string, enterpriseId: string, taskId: string): Promise<DurableTaskRecord | null> {
  const file = taskPath(rootDir, enterpriseId, taskId);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError(
      'durable_task_store_error',
      500,
      `failed to read durable task file ${file}`,
    );
  }
  const record = parseRecord(text, file);
  if (record.enterpriseId !== enterpriseId || record.taskId !== taskId) {
    throw new WorkflowOperationError(
      'durable_task_forbidden',
      403,
      `durable task ${taskId} does not belong to enterprise ${enterpriseId}`,
    );
  }
  return record;
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tempFile, contents, 'utf8');
    await rename(tempFile, file);
  } catch {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw new WorkflowOperationError(
      'durable_task_store_error',
      500,
      `failed to write durable task file ${file}`,
    );
  }
}

function parseLease(text: string): DurableTaskLease | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof raw.owner !== 'string'
      || typeof raw.token !== 'string'
      || typeof raw.acquiredAt !== 'string'
      || typeof raw.expiresAt !== 'string'
      || typeof raw.heartbeatAt !== 'string'
    ) {
      return null;
    }
    return {
      owner: raw.owner,
      token: raw.token,
      acquiredAt: raw.acquiredAt,
      expiresAt: raw.expiresAt,
      heartbeatAt: raw.heartbeatAt,
    };
  } catch {
    // A torn or foreign lease is stale; the exclusive create decides the winner.
    return null;
  }
}

async function readLeaseFile(file: string): Promise<DurableTaskLease | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError(
      'durable_task_store_error',
      500,
      `failed to read durable task lease ${file}`,
    );
  }
  return parseLease(text);
}

function leaseActive(lease: DurableTaskLease | null, now: Date): boolean {
  return Boolean(lease && Date.parse(lease.expiresAt) > now.getTime());
}

function assertSameCreateScope(existing: DurableTaskRecord, candidate: DurableTaskRecord): void {
  const mismatches: string[] = [];
  if (existing.taskId !== candidate.taskId) mismatches.push('taskId');
  if (existing.enterpriseId !== candidate.enterpriseId) mismatches.push('enterpriseId');
  if (existing.projectId !== candidate.projectId) mismatches.push('projectId');
  if (existing.kind !== candidate.kind) mismatches.push('kind');
  if (existing.businessKey !== candidate.businessKey) mismatches.push('businessKey');
  if (mismatches.length) conflict(candidate.taskId, mismatches);
}

function assertSameIdentity(existing: DurableTaskRecord, candidate: DurableTaskRecord): void {
  const mismatches: string[] = [];
  if (existing.taskId !== candidate.taskId) mismatches.push('taskId');
  if (existing.enterpriseId !== candidate.enterpriseId) mismatches.push('enterpriseId');
  if (existing.projectId !== candidate.projectId) mismatches.push('projectId');
  if (existing.kind !== candidate.kind) mismatches.push('kind');
  if (existing.businessKey !== candidate.businessKey) mismatches.push('businessKey');
  if (existing.createdAt !== candidate.createdAt) mismatches.push('createdAt');
  if (JSON.stringify(existing.delegation) !== JSON.stringify(candidate.delegation)) {
    mismatches.push('delegation');
  }
  if (mismatches.length) conflict(candidate.taskId, mismatches);
}

function conflict(taskId: string, mismatches: readonly string[]): never {
  throw new WorkflowOperationError(
    'durable_task_conflict',
    409,
    `durable task ${taskId} is already bound to a different ${mismatches.join(', ')}`,
    { taskId, mismatches },
  );
}

function leaseLost(taskId: string): WorkflowOperationError {
  return new WorkflowOperationError(
    'durable_task_lease_lost',
    409,
    `durable task ${taskId} is no longer owned by this worker`,
  );
}

function attachLease(record: DurableTaskRecord, lease: DurableTaskLease | null): DurableTaskRecord {
  return { ...clone(record), lease };
}

export function createFileDurableTaskStore(options: { readonly rootDir: string }): DurableTaskStore {
  const rootDir = path.resolve(options.rootDir);

  return {
    async create(record) {
      assertEnterpriseId(record.enterpriseId);
      const file = taskPath(rootDir, record.enterpriseId, record.taskId);
      return withLock(file, async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tempFile = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
          await writeFile(tempFile, serialize(record), 'utf8');
          try {
            await copyFile(tempFile, file, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await readRecord(rootDir, record.enterpriseId, record.taskId);
            if (!existing) throw error;
            // A repeated delegation adopts the original task: its createdAt,
            // delegation, attempts and terminal state stay the winner's.
            assertSameCreateScope(existing, record);
            const held = await readLeaseFile(leasePath(rootDir, record.enterpriseId, record.taskId));
            return { created: false, record: attachLease(existing, held) };
          }
          return { created: true, record: clone(record) };
        } catch (error) {
          if (error instanceof WorkflowOperationError) throw error;
          throw new WorkflowOperationError(
            'durable_task_store_error',
            500,
            `failed to create durable task file ${file}`,
          );
        } finally {
          await rm(tempFile, { force: true }).catch(() => undefined);
        }
      });
    },

    async update(record, options) {
      assertEnterpriseId(record.enterpriseId);
      const file = taskPath(rootDir, record.enterpriseId, record.taskId);
      return withLock(file, async () => {
        const existing = await readRecord(rootDir, record.enterpriseId, record.taskId);
        if (!existing) {
          throw new WorkflowOperationError(
            'durable_task_not_found',
            404,
            `durable task ${record.taskId} was not found`,
          );
        }
        assertSameIdentity(existing, record);
        if (
          isTerminalDurableTaskStatus(existing.status)
          && existing.status !== record.status
          && !options?.allowTerminalTransition
        ) {
          throw new WorkflowOperationError(
            'durable_task_terminal',
            409,
            `durable task ${record.taskId} is already ${existing.status} and cannot become ${record.status}`,
          );
        }
        // Outputs and steps must remain JSON-serializable; a bad payload fails
        // before it can replace the last durable copy.
        try {
          JSON.stringify(record.data);
        } catch {
          throw new WorkflowOperationError(
            'durable_task_data_invalid',
            422,
            `durable task ${record.taskId} payload is not serializable`,
          );
        }
        await writeAtomic(file, serialize(record));
        const held = await readLeaseFile(leasePath(rootDir, record.enterpriseId, record.taskId));
        return attachLease(record, held);
      });
    },

    async get(enterpriseId, taskId) {
      assertEnterpriseId(enterpriseId);
      const record = await readRecord(rootDir, enterpriseId, taskId);
      if (!record) return null;
      const lease = await readLeaseFile(leasePath(rootDir, enterpriseId, taskId));
      return { ...record, lease };
    },

    async list(query) {
      assertEnterpriseId(query.enterpriseId);
      const dir = path.join(tenantDir(rootDir, query.enterpriseId), 'tasks');
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir, { withFileTypes: true });
      const records: DurableTaskRecord[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const taskId = entry.name.slice(0, -'.json'.length);
        if (!ID_PATTERN.test(taskId)) continue;
        const record = await readRecord(rootDir, query.enterpriseId, taskId);
        if (!record) continue;
        if (query.statuses && !query.statuses.includes(record.status)) continue;
        if (query.kind && record.kind !== query.kind) continue;
        if (query.manualOnly && !record.manual) continue;
        records.push(record);
      }
      records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.taskId.localeCompare(right.taskId));
      const limit = Math.max(1, Math.min(query.limit ?? 200, 500));
      const selected = records.slice(0, limit);
      return Promise.all(selected.map(async (record) =>
        attachLease(record, await readLeaseFile(leasePath(rootDir, query.enterpriseId, record.taskId)))));
    },

    async acquireLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const file = leasePath(rootDir, input.enterpriseId, input.taskId);
      return withLock(file, async () => {
        const nowMs = input.now.getTime();
        const expiresAt = new Date(nowMs + input.ttlMs).toISOString();
        const candidate: DurableTaskLease = {
          owner: input.owner,
          token: input.token,
          acquiredAt: input.now.toISOString(),
          expiresAt,
          heartbeatAt: input.now.toISOString(),
        };
        await mkdir(path.dirname(file), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
            return { acquired: true, lease: candidate };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw new WorkflowOperationError(
                'durable_task_store_error',
                500,
                `failed to acquire the lease for durable task ${input.taskId}`,
              );
            }
            const held = await readLeaseFile(file);
            if (leaseActive(held, input.now)) return { acquired: false, lease: held };
            await rm(file, { force: true });
          }
        }
        return { acquired: false, lease: await readLeaseFile(file) };
      });
    },

    async renewLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const file = leasePath(rootDir, input.enterpriseId, input.taskId);
      return withLock(file, async () => {
        const held = await readLeaseFile(file);
        if (!held || held.token !== input.token || !leaseActive(held, input.now)) throw leaseLost(input.taskId);
        const next: DurableTaskLease = {
          ...held,
          owner: input.owner,
          expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
          heartbeatAt: input.now.toISOString(),
        };
        await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
        return next;
      });
    },

    async releaseLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const file = leasePath(rootDir, input.enterpriseId, input.taskId);
      await withLock(file, async () => {
        const held = await readLeaseFile(file);
        if (!held) return;
        if (!input.force && held.token !== input.token) return;
        await rm(file, { force: true });
      });
    },

    async readLease(enterpriseId, taskId) {
      assertEnterpriseId(enterpriseId);
      return readLeaseFile(leasePath(rootDir, enterpriseId, taskId));
    },
  };
}

export function createMemoryDurableTaskStore(): DurableTaskStore {
  const records = new Map<string, DurableTaskRecord>();
  const leases = new Map<string, DurableTaskLease>();
  const key = (enterpriseId: string, taskId: string) => `${enterpriseId}:${taskId}`;
  const storeKey = (record: DurableTaskRecord) => key(record.enterpriseId, record.taskId);

  return {
    async create(record) {
      assertEnterpriseId(record.enterpriseId);
      const existing = records.get(storeKey(record));
      if (existing) {
        assertSameCreateScope(existing, record);
        return { created: false, record: { ...clone(existing), lease: leases.get(storeKey(record)) ?? null } };
      }
      records.set(storeKey(record), clone(record));
      return { created: true, record: clone(record) };
    },
    async update(record, options) {
      assertEnterpriseId(record.enterpriseId);
      const existing = records.get(storeKey(record));
      if (!existing) {
        throw new WorkflowOperationError('durable_task_not_found', 404, `durable task ${record.taskId} was not found`);
      }
      assertSameIdentity(existing, record);
      if (
        isTerminalDurableTaskStatus(existing.status)
        && existing.status !== record.status
        && !options?.allowTerminalTransition
      ) {
        throw new WorkflowOperationError(
          'durable_task_terminal',
          409,
          `durable task ${record.taskId} is already ${existing.status} and cannot become ${record.status}`,
        );
      }
      records.set(storeKey(record), clone(record));
      return { ...clone(record), lease: leases.get(storeKey(record)) ?? null };
    },
    async get(enterpriseId, taskId) {
      assertEnterpriseId(enterpriseId);
      const record = records.get(key(enterpriseId, taskId));
      return record ? { ...clone(record), lease: leases.get(key(enterpriseId, taskId)) ?? null } : null;
    },
    async list(query) {
      assertEnterpriseId(query.enterpriseId);
      const selected = [...records.values()]
        .filter((record) => record.enterpriseId === query.enterpriseId)
        .filter((record) => !query.statuses || query.statuses.includes(record.status))
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.manualOnly || record.manual)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.taskId.localeCompare(right.taskId))
        .slice(0, Math.max(1, Math.min(query.limit ?? 200, 500)));
      return selected.map((record) => ({
        ...clone(record),
        lease: leases.get(storeKey(record)) ?? null,
      }));
    },
    async acquireLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const id = key(input.enterpriseId, input.taskId);
      const held = leases.get(id) ?? null;
      if (leaseActive(held, input.now)) return { acquired: false, lease: held };
      const lease: DurableTaskLease = {
        owner: input.owner,
        token: input.token,
        acquiredAt: input.now.toISOString(),
        expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
        heartbeatAt: input.now.toISOString(),
      };
      leases.set(id, lease);
      return { acquired: true, lease };
    },
    async renewLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const id = key(input.enterpriseId, input.taskId);
      const held = leases.get(id) ?? null;
      if (!held || held.token !== input.token || !leaseActive(held, input.now)) throw leaseLost(input.taskId);
      const next: DurableTaskLease = {
        ...held,
        owner: input.owner,
        expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
        heartbeatAt: input.now.toISOString(),
      };
      leases.set(id, next);
      return next;
    },
    async releaseLease(input) {
      assertEnterpriseId(input.enterpriseId);
      const id = key(input.enterpriseId, input.taskId);
      const held = leases.get(id) ?? null;
      if (!held) return;
      if (!input.force && held.token !== input.token) return;
      leases.delete(id);
    },
    async readLease(enterpriseId, taskId) {
      assertEnterpriseId(enterpriseId);
      return leases.get(key(enterpriseId, taskId)) ?? null;
    },
  };
}
