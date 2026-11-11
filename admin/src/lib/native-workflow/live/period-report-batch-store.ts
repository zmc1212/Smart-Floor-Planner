/** B-owned host manifest store for one four-receiver period-report action.
 *
 * The manifest is host state, not business truth: it records the fixed request
 * identity (enterprise/project/period/published revision/receivers), the four
 * reserved sub-runIds and the latest observed entry states. It never replaces
 * the live run record or the construction report rows.
 *
 * Persistence follows the B run-store convention: a unique same-directory
 * temporary file, a complete write, then an atomic rename; `create` is
 * exclusive via COPYFILE_EXCL and `update` refuses a different identity.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowOperationError } from '../errors';
import type {
  PeriodReportBatchManifest,
  PeriodReportBatchReceiverIdentity,
} from './period-report-batch';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const STORE_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

export interface PeriodReportBatchStore {
  /** Exclusive first write. An existing requestId returns the original manifest. */
  create(
    manifest: PeriodReportBatchManifest,
  ): Promise<{ created: boolean; manifest: PeriodReportBatchManifest }>;
  /** Update observation/entry state; the immutable identity may not change. */
  update(manifest: PeriodReportBatchManifest): Promise<PeriodReportBatchManifest>;
  get(requestId: string): Promise<PeriodReportBatchManifest | null>;
}

/** The B-owned batch manifest root. Server reads and the CLI share it. */
export function resolveNativeWorkflowBatchDir(): string {
  return process.env.NATIVE_WORKFLOW_BATCH_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-batches');
}

export function assertBatchRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new WorkflowOperationError(
      'period_report_batch_request_invalid',
      422,
      `batch request id ${JSON.stringify(requestId)} is not a valid id`,
    );
  }
}

function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function batchPath(rootDir: string, requestId: string): string {
  assertBatchRequestId(requestId);
  return path.join(rootDir, 'requests', `${requestId}.json`);
}

function clone(manifest: PeriodReportBatchManifest): PeriodReportBatchManifest {
  return structuredClone(manifest);
}

function serialize(manifest: PeriodReportBatchManifest): string {
  return `${JSON.stringify({ storeVersion: STORE_VERSION, manifest }, null, 2)}\n`;
}

function parseManifest(text: string, file: string): PeriodReportBatchManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkflowOperationError(
      'period_report_batch_store_corrupt',
      500,
      `batch manifest ${file} is not valid JSON`,
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError(
      'period_report_batch_store_corrupt',
      500,
      `batch manifest ${file} has an invalid shape`,
    );
  }
  const data = raw as Record<string, unknown>;
  const manifest = data.manifest as PeriodReportBatchManifest | undefined;
  if (
    data.storeVersion !== STORE_VERSION
    || !manifest
    || typeof manifest.requestId !== 'string'
    || !Array.isArray(manifest.entries)
    || !Array.isArray(manifest.receivers)
  ) {
    throw new WorkflowOperationError(
      'period_report_batch_store_corrupt',
      500,
      `batch manifest ${file} has an unsupported shape`,
    );
  }
  return manifest;
}

async function readManifest(
  rootDir: string,
  requestId: string,
): Promise<PeriodReportBatchManifest | null> {
  const file = batchPath(rootDir, requestId);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowOperationError(
      'period_report_batch_store_error',
      500,
      `failed to read batch manifest ${file}`,
    );
  }
  return parseManifest(text, file);
}

async function writeManifest(
  rootDir: string,
  manifest: PeriodReportBatchManifest,
): Promise<void> {
  const file = batchPath(rootDir, manifest.requestId);
  await mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, serialize(manifest), 'utf8');
    await rename(tempFile, file);
  } catch {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw new WorkflowOperationError(
      'period_report_batch_store_error',
      500,
      `failed to write batch manifest ${file}`,
    );
  }
}

function receiverIdentity(manifest: PeriodReportBatchManifest): PeriodReportBatchReceiverIdentity[] {
  return manifest.receivers.map((receiver) => ({
    kind: receiver.kind,
    adminId: receiver.adminId,
  }));
}

function receiversKey(receivers: readonly PeriodReportBatchReceiverIdentity[]): string {
  return receivers
    .map((receiver) => `${receiver.kind}:${receiver.adminId ?? ''}`)
    .join('\u0000');
}

function nodeVersionsKey(versions: Readonly<Record<string, string>>): string {
  return Object.keys(versions)
    .sort()
    .map((nodeId) => `${nodeId}=${versions[nodeId]}`)
    .join('\u0000');
}

function assertSameManifestIdentity(
  existing: PeriodReportBatchManifest,
  candidate: PeriodReportBatchManifest,
): void {
  const mismatches: string[] = [];
  if (existing.enterpriseId !== candidate.enterpriseId) mismatches.push('enterpriseId');
  if (existing.projectId !== candidate.projectId) mismatches.push('projectId');
  if (existing.actorAdminId !== candidate.actorAdminId) mismatches.push('actorAdminId');
  if (existing.event.eventType !== candidate.event.eventType) mismatches.push('eventType');
  if (existing.event.periodKind !== candidate.event.periodKind) mismatches.push('periodKind');
  if (existing.event.periodStart !== candidate.event.periodStart) mismatches.push('periodStart');
  if (existing.event.periodEnd !== candidate.event.periodEnd) mismatches.push('periodEnd');
  if (existing.published.definitionId !== candidate.published.definitionId) {
    mismatches.push('definitionId');
  }
  if (existing.published.revision !== candidate.published.revision) {
    mismatches.push('definitionRevision');
  }
  if (existing.published.digest !== candidate.published.digest) mismatches.push('digest');
  if (
    nodeVersionsKey(existing.published.nodeVersions)
    !== nodeVersionsKey(candidate.published.nodeVersions)
  ) {
    mismatches.push('nodeVersions');
  }
  if (receiversKey(receiverIdentity(existing)) !== receiversKey(receiverIdentity(candidate))) {
    mismatches.push('receivers');
  }
  if (mismatches.length) {
    throw new WorkflowOperationError(
      'period_report_batch_conflict',
      409,
      `batch request ${candidate.requestId} is already bound to a different ${mismatches.join(', ')}`,
      { requestId: candidate.requestId, mismatches },
    );
  }
}

export function createFilePeriodReportBatchStore(options: {
  readonly rootDir: string;
}): PeriodReportBatchStore {
  const rootDir = path.resolve(options.rootDir);

  return {
    async create(manifest) {
      const file = batchPath(rootDir, manifest.requestId);
      return withLock(file, async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(tempFile, serialize(manifest), 'utf8');
          try {
            await copyFile(tempFile, file, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const existing = await readManifest(rootDir, manifest.requestId);
            if (!existing) throw error;
            assertSameManifestIdentity(existing, manifest);
            return { created: false, manifest: clone(existing) };
          }
          return { created: true, manifest: clone(manifest) };
        } catch (error) {
          if (error instanceof WorkflowOperationError) throw error;
          throw new WorkflowOperationError(
            'period_report_batch_store_error',
            500,
            `failed to create batch manifest ${file}`,
          );
        } finally {
          await rm(tempFile, { force: true }).catch(() => undefined);
        }
      });
    },

    async update(manifest) {
      const file = batchPath(rootDir, manifest.requestId);
      return withLock(file, async () => {
        const existing = await readManifest(rootDir, manifest.requestId);
        if (!existing) {
          throw new WorkflowOperationError(
            'period_report_batch_not_found',
            404,
            `batch request ${manifest.requestId} was not found`,
          );
        }
        assertSameManifestIdentity(existing, manifest);
        const next: PeriodReportBatchManifest = {
          ...clone(manifest),
          createdAt: existing.createdAt,
        };
        await writeManifest(rootDir, next);
        return clone(next);
      });
    },

    async get(requestId) {
      const manifest = await readManifest(rootDir, requestId);
      return manifest ? clone(manifest) : null;
    },
  };
}

export function createMemoryPeriodReportBatchStore(): PeriodReportBatchStore {
  const manifests = new Map<string, PeriodReportBatchManifest>();
  return {
    async create(manifest) {
      assertBatchRequestId(manifest.requestId);
      const existing = manifests.get(manifest.requestId);
      if (existing) {
        assertSameManifestIdentity(existing, manifest);
        return { created: false, manifest: clone(existing) };
      }
      manifests.set(manifest.requestId, clone(manifest));
      return { created: true, manifest: clone(manifest) };
    },
    async update(manifest) {
      const existing = manifests.get(manifest.requestId);
      if (!existing) {
        throw new WorkflowOperationError(
          'period_report_batch_not_found',
          404,
          `batch request ${manifest.requestId} was not found`,
        );
      }
      assertSameManifestIdentity(existing, manifest);
      const next: PeriodReportBatchManifest = {
        ...clone(manifest),
        createdAt: existing.createdAt,
      };
      manifests.set(manifest.requestId, next);
      return clone(next);
    },
    async get(requestId) {
      const manifest = manifests.get(requestId);
      return manifest ? clone(manifest) : null;
    },
  };
}
