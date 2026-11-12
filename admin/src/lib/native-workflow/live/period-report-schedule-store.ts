/** B-owned schedule store for scheduled four-receiver weekly reports.
 *
 * Three independent file records live under one schedule root:
 *   runs/<runId>.json                  one enterprise + one finished week
 *   runs/<runId>.lease.json            cross-process dispatch lease
 *   control/<enterpriseId>.json        pause/resume, owned by the tenant admin
 *   ledger/<enterpriseId>/<projectId>.json  existing issue references only
 *
 * Persistence follows the B run/batch store convention: a unique same-directory
 * temporary file, a complete write, then an atomic rename; `create` is
 * exclusive via COPYFILE_EXCL and `update` refuses a different immutable
 * identity. The lease is an exclusive same-directory file with an expiry, so a
 * crashed scheduler's lease is taken over only after its TTL.
 *
 * This store never replaces construction_reports, construction_report_* or the
 * live run records. It is host schedule state and evidence only.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import {
  SCHEDULE_LEDGER_VERSION,
  SCHEDULE_RUN_VERSION,
  type PeriodReportScheduleControl,
  type PeriodReportScheduleLedger,
  type PeriodReportScheduleRun,
} from './period-report-schedule-types';

const ID_PATTERN = /^[1-9]\d{0,18}$/;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const STORE_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

export interface PeriodReportScheduleLeaseOptions {
  readonly owner: string;
  readonly now: () => Date;
  readonly ttlMs: number;
}

export interface PeriodReportScheduleListOptions {
  readonly enterpriseId?: string;
  readonly limit?: number;
}

export interface PeriodReportScheduleStore {
  create(run: PeriodReportScheduleRun): Promise<{
    created: boolean;
    run: PeriodReportScheduleRun;
  }>;
  update(run: PeriodReportScheduleRun): Promise<PeriodReportScheduleRun>;
  get(runId: string): Promise<PeriodReportScheduleRun | null>;
  list(options?: PeriodReportScheduleListOptions): Promise<PeriodReportScheduleRun[]>;
  acquire(runId: string, options: PeriodReportScheduleLeaseOptions): Promise<boolean>;
  release(runId: string, owner: string): Promise<void>;
  control(enterpriseId: string): Promise<PeriodReportScheduleControl>;
  setControl(
    enterpriseId: string,
    input: {
      readonly paused: boolean;
      readonly updatedBy: string | null;
      readonly reason: string | null;
      readonly now: () => Date;
    },
  ): Promise<PeriodReportScheduleControl>;
  ledger(enterpriseId: string, projectId: string): Promise<PeriodReportScheduleLedger>;
  saveLedger(ledger: PeriodReportScheduleLedger): Promise<PeriodReportScheduleLedger>;
}

/** The B-owned schedule root. Server reads, the CLI and the Worker share it. */
export function resolveNativeWorkflowScheduleDir(): string {
  return process.env.NATIVE_WORKFLOW_SCHEDULE_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-schedules');
}

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new WorkflowOperationError(
      'period_report_schedule_id_invalid',
      422,
      `${label} ${JSON.stringify(value)} is not a positive integer id`,
    );
  }
}

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new WorkflowOperationError(
      'period_report_schedule_run_invalid',
      422,
      `schedule run id ${JSON.stringify(runId)} is not a valid id`,
    );
  }
}

function runPath(rootDir: string, runId: string): string {
  assertRunId(runId);
  return path.join(rootDir, 'runs', `${runId}.json`);
}

function leasePath(rootDir: string, runId: string): string {
  assertRunId(runId);
  return path.join(rootDir, 'runs', `${runId}.lease.json`);
}

function controlPath(rootDir: string, enterpriseId: string): string {
  assertId(enterpriseId, 'enterprise id');
  return path.join(rootDir, 'control', `${enterpriseId}.json`);
}

function ledgerPath(rootDir: string, enterpriseId: string, projectId: string): string {
  assertId(enterpriseId, 'enterprise id');
  assertId(projectId, 'project id');
  return path.join(rootDir, 'ledger', enterpriseId, `${projectId}.json`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function serialize(value: unknown): string {
  return `${JSON.stringify({ storeVersion: STORE_VERSION, value }, null, 2)}\n`;
}

function parseEnvelope(text: string, file: string): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowOperationError(
      'period_report_schedule_store_corrupt',
      500,
      `schedule file ${file} is not valid JSON`,
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError(
      'period_report_schedule_store_corrupt',
      500,
      `schedule file ${file} has an invalid shape`,
    );
  }
  const data = raw as Record<string, unknown>;
  if (data.storeVersion !== STORE_VERSION || !('value' in data)) {
    throw new WorkflowOperationError(
      'period_report_schedule_store_corrupt',
      500,
      `schedule file ${file} has an unsupported shape`,
    );
  }
  return data.value;
}

async function readJson<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError(
      'period_report_schedule_store_error',
      500,
      `failed to read schedule file ${file}`,
    );
  }
  return parseEnvelope(text, file) as T;
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, serialize(value), 'utf8');
    await rename(tempFile, file);
  } catch {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw new WorkflowOperationError(
      'period_report_schedule_store_error',
      500,
      `failed to write schedule file ${file}`,
    );
  }
}

function assertRunShape(run: PeriodReportScheduleRun): void {
  if (
    !run
    || run.runVersion !== SCHEDULE_RUN_VERSION
    || typeof run.runId !== 'string'
    || typeof run.enterpriseId !== 'string'
    || !run.period
    || typeof run.period.periodStart !== 'string'
    || typeof run.period.periodEnd !== 'string'
    || !Array.isArray(run.queue)
    || !run.projects
    || typeof run.projects !== 'object'
    || !Array.isArray(run.audit)
  ) {
    throw new WorkflowOperationError(
      'period_report_schedule_run_invalid',
      422,
      'schedule run has an invalid shape',
    );
  }
}

function assertSameRunScope(
  existing: PeriodReportScheduleRun,
  candidate: PeriodReportScheduleRun,
): void {
  const mismatches: string[] = [];
  if (existing.runId !== candidate.runId) mismatches.push('runId');
  if (existing.enterpriseId !== candidate.enterpriseId) mismatches.push('enterpriseId');
  if (existing.period.periodStart !== candidate.period.periodStart) mismatches.push('periodStart');
  if (existing.period.periodEnd !== candidate.period.periodEnd) mismatches.push('periodEnd');
  if (existing.period.kind !== candidate.period.kind) mismatches.push('periodKind');
  if (mismatches.length) {
    throw new WorkflowOperationError(
      'period_report_schedule_conflict',
      409,
      `schedule run ${candidate.runId} is already bound to a different ${mismatches.join(', ')}`,
      { runId: candidate.runId, mismatches },
    );
  }
}

function assertSameRunIdentity(
  existing: PeriodReportScheduleRun,
  candidate: PeriodReportScheduleRun,
): void {
  assertSameRunScope(existing, candidate);
  const mismatches: string[] = [];
  if (
    (existing.published?.definitionId ?? null) !== (candidate.published?.definitionId ?? null)
    || (existing.published?.revision ?? null) !== (candidate.published?.revision ?? null)
    || (existing.published?.digest ?? null) !== (candidate.published?.digest ?? null)
  ) {
    mismatches.push('published');
  }
  if (mismatches.length) {
    throw new WorkflowOperationError(
      'period_report_schedule_conflict',
      409,
      `schedule run ${candidate.runId} is already bound to a different ${mismatches.join(', ')}`,
      { runId: candidate.runId, mismatches },
    );
  }
}

interface StoredLease {
  readonly owner: string;
  readonly expiresAt: number;
}

async function readLease(file: string): Promise<StoredLease | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError(
      'period_report_schedule_store_error',
      500,
      `failed to read schedule lease ${file}`,
    );
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw.owner !== 'string' || typeof raw.expiresAt !== 'number') return null;
    return { owner: raw.owner, expiresAt: raw.expiresAt };
  } catch {
    // A torn or foreign lease is stale; the exclusive create decides the winner.
    return null;
  }
}

function controlOf(enterpriseId: string, value: PeriodReportScheduleControl | null): PeriodReportScheduleControl {
  return value ?? {
    enterpriseId,
    paused: false,
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
    reason: null,
  };
}

export function createFilePeriodReportScheduleStore(options: {
  readonly rootDir: string;
}): PeriodReportScheduleStore {
  const rootDir = path.resolve(options.rootDir);

  return {
    async create(run) {
      assertRunShape(run);
      const file = runPath(rootDir, run.runId);
      return withLock(file, async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(tempFile, serialize(run), 'utf8');
          try {
            await copyFile(tempFile, file, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await readJson<PeriodReportScheduleRun>(file);
            if (!existing) throw error;
            // A concurrent creator's startedAt/published is the winner. The
            // loser adopts that run instead of failing on non-identity fields.
            assertSameRunScope(existing, run);
            return { created: false, run: clone(existing) };
          }
          return { created: true, run: clone(run) };
        } catch (error) {
          if (error instanceof WorkflowOperationError) throw error;
          throw new WorkflowOperationError(
            'period_report_schedule_store_error',
            500,
            `failed to create schedule run ${file}`,
          );
        } finally {
          await rm(tempFile, { force: true }).catch(() => undefined);
        }
      });
    },

    async update(run) {
      assertRunShape(run);
      const file = runPath(rootDir, run.runId);
      return withLock(file, async () => {
        const existing = await readJson<PeriodReportScheduleRun>(file);
        if (!existing) {
          throw new WorkflowOperationError(
            'period_report_schedule_not_found',
            404,
            `schedule run ${run.runId} was not found`,
          );
        }
        assertSameRunIdentity(existing, run);
        const next: PeriodReportScheduleRun = {
          ...clone(run),
          startedAt: existing.startedAt,
        };
        await writeAtomic(file, next);
        return clone(next);
      });
    },

    async get(runId) {
      return readJson<PeriodReportScheduleRun>(runPath(rootDir, runId));
    },

    async list(options = {}) {
      const dir = path.join(rootDir, 'runs');
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir, { withFileTypes: true });
      const runs: PeriodReportScheduleRun[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.lease.json')) {
          continue;
        }
        const run = await readJson<PeriodReportScheduleRun>(path.join(dir, entry.name));
        if (!run) continue;
        if (options.enterpriseId && run.enterpriseId !== options.enterpriseId) continue;
        runs.push(run);
      }
      return runs
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(options.limit ?? 20, 100)));
    },

    async acquire(runId, leaseOptions) {
      const file = leasePath(rootDir, runId);
      return withLock(file, async () => {
        const nowMs = leaseOptions.now().getTime();
        await mkdir(path.dirname(file), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await writeFile(file, `${JSON.stringify({
              owner: leaseOptions.owner,
              acquiredAt: new Date(nowMs).toISOString(),
              expiresAt: nowMs + leaseOptions.ttlMs,
            }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw new WorkflowOperationError(
                'period_report_schedule_store_error',
                500,
                `failed to acquire the schedule lease for ${runId}`,
              );
            }
            const held = await readLease(file);
            if (held && held.expiresAt > nowMs) return false;
            await rm(file, { force: true });
          }
        }
        return false;
      });
    },

    async release(runId, owner) {
      const file = leasePath(rootDir, runId);
      await withLock(file, async () => {
        const held = await readLease(file);
        if (held && held.owner !== owner) return;
        await rm(file, { force: true });
      });
    },

    async control(enterpriseId) {
      assertId(enterpriseId, 'enterprise id');
      const stored = await readJson<PeriodReportScheduleControl>(
        controlPath(rootDir, enterpriseId),
      );
      return controlOf(enterpriseId, stored);
    },

    async setControl(enterpriseId, input) {
      assertId(enterpriseId, 'enterprise id');
      const file = controlPath(rootDir, enterpriseId);
      return withLock(file, async () => {
        const next: PeriodReportScheduleControl = {
          enterpriseId,
          paused: input.paused,
          updatedAt: input.now().toISOString(),
          updatedBy: input.updatedBy,
          reason: input.reason,
        };
        await writeAtomic(file, next);
        return next;
      });
    },

    async ledger(enterpriseId, projectId) {
      assertId(enterpriseId, 'enterprise id');
      assertId(projectId, 'project id');
      const stored = await readJson<PeriodReportScheduleLedger>(
        ledgerPath(rootDir, enterpriseId, projectId),
      );
      return stored ?? {
        ledgerVersion: SCHEDULE_LEDGER_VERSION,
        enterpriseId,
        projectId,
        items: [],
        updatedAt: new Date(0).toISOString(),
      };
    },

    async saveLedger(ledger) {
      assertId(ledger.enterpriseId, 'enterprise id');
      assertId(ledger.projectId, 'project id');
      if (ledger.ledgerVersion !== SCHEDULE_LEDGER_VERSION) {
        throw new WorkflowOperationError(
          'period_report_schedule_ledger_invalid',
          422,
          'schedule ledger has an unsupported version',
        );
      }
      const file = ledgerPath(rootDir, ledger.enterpriseId, ledger.projectId);
      return withLock(file, async () => {
        const next = clone(ledger);
        await writeAtomic(file, next);
        return clone(next);
      });
    },
  };
}

export function createMemoryPeriodReportScheduleStore(): PeriodReportScheduleStore {
  const runs = new Map<string, PeriodReportScheduleRun>();
  const leases = new Map<string, StoredLease>();
  const controls = new Map<string, PeriodReportScheduleControl>();
  const ledgers = new Map<string, PeriodReportScheduleLedger>();

  return {
    async create(run) {
      assertRunShape(run);
      const existing = runs.get(run.runId);
      if (existing) {
        // A concurrent creator's startedAt/published is the winner.
        assertSameRunScope(existing, run);
        return { created: false, run: clone(existing) };
      }
      runs.set(run.runId, clone(run));
      return { created: true, run: clone(run) };
    },
    async update(run) {
      assertRunShape(run);
      const existing = runs.get(run.runId);
      if (!existing) {
        throw new WorkflowOperationError(
          'period_report_schedule_not_found',
          404,
          `schedule run ${run.runId} was not found`,
        );
      }
      assertSameRunIdentity(existing, run);
      const next: PeriodReportScheduleRun = { ...clone(run), startedAt: existing.startedAt };
      runs.set(run.runId, next);
      return clone(next);
    },
    async get(runId) {
      const run = runs.get(runId);
      return run ? clone(run) : null;
    },
    async list(options = {}) {
      return [...runs.values()]
        .filter((run) => !options.enterpriseId || run.enterpriseId === options.enterpriseId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.min(options.limit ?? 20, 100)))
        .map(clone);
    },
    async acquire(runId, leaseOptions) {
      const nowMs = leaseOptions.now().getTime();
      const held = leases.get(runId);
      if (held && held.expiresAt > nowMs && held.owner !== leaseOptions.owner) return false;
      leases.set(runId, { owner: leaseOptions.owner, expiresAt: nowMs + leaseOptions.ttlMs });
      return true;
    },
    async release(runId, owner) {
      const held = leases.get(runId);
      if (held && held.owner !== owner) return;
      leases.delete(runId);
    },
    async control(enterpriseId) {
      return controlOf(enterpriseId, controls.get(enterpriseId) ?? null);
    },
    async setControl(enterpriseId, input) {
      const next: PeriodReportScheduleControl = {
        enterpriseId,
        paused: input.paused,
        updatedAt: input.now().toISOString(),
        updatedBy: input.updatedBy,
        reason: input.reason,
      };
      controls.set(enterpriseId, next);
      return next;
    },
    async ledger(enterpriseId, projectId) {
      const key = `${enterpriseId}:${projectId}`;
      return ledgers.get(key) ?? {
        ledgerVersion: SCHEDULE_LEDGER_VERSION,
        enterpriseId,
        projectId,
        items: [],
        updatedAt: new Date(0).toISOString(),
      };
    },
    async saveLedger(ledger) {
      ledgers.set(`${ledger.enterpriseId}:${ledger.projectId}`, clone(ledger));
      return clone(ledger);
    },
  };
}
