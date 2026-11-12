import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateEffectReceipt } from '../src/lib/native-workflow/receipts';
import type { CompiledNode } from '../src/lib/native-workflow/compile';
import { isPlainObject } from '../src/lib/native-workflow/guards';
import { assertEnterpriseId, assertTaskId, DURABLE_TASK_STORE_VERSION } from '../src/lib/native-workflow/live/durable-task-store';
import { DURABLE_TASK_VERSION, type DurableTaskRecord } from '../src/lib/native-workflow/live/durable-task-types';
import { durableTaskId } from '../src/lib/native-workflow/live/durable-task-runtime';
import type { PeriodReportBatchManifest } from '../src/lib/native-workflow/live/period-report-batch';
import { assertBatchRequestId } from '../src/lib/native-workflow/live/period-report-batch-store';
import { assertRunShape } from '../src/lib/native-workflow/live/period-report-schedule-store';
import {
  scheduleRequestId, scheduleRunId, SCHEDULE_LEDGER_VERSION,
  type PeriodReportScheduleControl, type PeriodReportScheduleLedger, type PeriodReportScheduleRun,
} from '../src/lib/native-workflow/live/period-report-schedule-types';
import type { LiveRunRecord } from '../src/lib/native-workflow/live/types';
import type { RuntimeKind } from '../src/lib/native-workflow/live/runtime-postgres-repository';

export type MigrationScope = 'runtime' | 'tasks';
type StoreKind = RuntimeKind | 'task';
export const runtimeKinds = ['run', 'schedule', 'batch', 'control', 'ledger'] as const;
const fileId = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const datePattern = /^\d{4}-\d\d-\d\d$/;
const activeStatuses = ['pending', 'queued', 'running', 'waiting', 'retrying'];
const terminalStatuses = ['succeeded', 'failed', 'cancelled', 'expired'];

type SnapshotEntry = {
  readonly kind: StoreKind;
  readonly name: string;
  readonly sha256: string;
  readonly base64: string;
};
export interface Snapshot {
  readonly version: 1;
  readonly enterpriseId: string;
  readonly scope: MigrationScope;
  readonly files: readonly SnapshotEntry[];
  readonly sha256: string;
}

export type SnapshotRecord =
  | { kind: 'run'; id: string; state: LiveRunRecord }
  | { kind: 'batch'; id: string; state: PeriodReportBatchManifest }
  | { kind: 'schedule'; id: string; state: PeriodReportScheduleRun }
  | { kind: 'control'; id: string; state: PeriodReportScheduleControl }
  | { kind: 'ledger'; id: string; state: PeriodReportScheduleLedger }
  | { kind: 'task'; id: string; state: DurableTaskRecord };

export interface SourceRoots {
  readonly run: string;
  readonly batch: string;
  readonly schedule: string;
  readonly task: string;
}

export function sha256(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (!isPlainObject(value)) return JSON.stringify(value);
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export function checksum(value: unknown) {
  return sha256(canonical(value));
}

function requireValue(assertion: unknown, detail: string): asserts assertion {
  if (!assertion) throw new Error(detail);
}

function envelope(kind: StoreKind, bytes: Buffer): Record<string, unknown> {
  const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  const version = kind === 'task' ? DURABLE_TASK_STORE_VERSION : 1;
  const state = kind === 'batch' ? parsed.manifest : kind === 'run' || kind === 'task' ? parsed.record : parsed.value;
  requireValue(parsed.storeVersion === version && isPlainObject(state), 'unsupported store file version');
  return state;
}

function timestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function positiveVersion(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function key(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\u0000');
}

function versionPin(value: { readonly definitionId: string; readonly revision: number; readonly digest: string; readonly nodeVersions: Readonly<Record<string, string>> }) {
  return value && key(value.definitionId) && positiveVersion(value.revision) && digestPattern.test(value.digest)
    && isPlainObject(value.nodeVersions) && Object.values(value.nodeVersions).every(key);
}

function validateRecord(enterpriseId: string, kind: StoreKind, id: string, raw: Record<string, unknown>): SnapshotRecord {
  requireValue(raw.enterpriseId === enterpriseId && timestamp(raw.updatedAt), 'tenant or update timestamp mismatch');
  if (kind === 'run') {
    const state = raw as unknown as LiveRunRecord;
    const binding = state.binding;
    requireValue(versionPin(binding) && binding.runId === id && isPlainObject(binding.event)
      && isPlainObject(binding.businessEvent) && timestamp(state.createdAt), 'invalid Workflow Run binding');
    requireValue(state.state?.mode === 'live' && state.state.runId === id
      && state.state.revision === binding.revision && state.state.digest === binding.digest
      && state.state.definitionId === binding.definitionId && Array.isArray(state.trace)
      && Array.isArray(state.operations), 'invalid Workflow Run checkpoint');
    const operations = new Set<string>();
    for (const operation of state.operations) {
      requireValue(key(operation.idempotencyKey) && !operations.has(operation.idempotencyKey)
        && binding.nodeVersions[operation.nodeId] === operation.nodeVersion
        && ['failed', 'unknown', 'succeeded'].includes(operation.outcome), 'invalid or duplicate run operation');
      operations.add(operation.idempotencyKey);
      if (operation.outcome === 'succeeded') {
        const node = { nodeId: operation.nodeId, effect: operation.effect } as CompiledNode;
        requireValue(!validateEffectReceipt(node, operation.outputs ?? {}, 'live'), 'invalid historical run receipt');
      }
    }
    return { kind, id, state };
  }
  if (kind === 'schedule') {
    const state = raw as unknown as PeriodReportScheduleRun;
    assertRunShape(state);
    requireValue(state.runId === id && state.period.kind === 'weekly' && datePattern.test(state.period.periodStart)
      && datePattern.test(state.period.periodEnd) && state.runId === scheduleRunId(enterpriseId, state.period.periodStart)
      && timestamp(state.startedAt) && (!state.published || versionPin(state.published))
      && (!state.weeklyClaim || state.weeklyClaim.periodStart === state.period.periodStart), 'invalid schedule run binding');
    for (const [projectId, entry] of Object.entries(state.projects)) {
      requireValue(entry.plan.projectId === projectId && entry.requestId === scheduleRequestId(enterpriseId, projectId,
        state.period.periodStart), 'schedule project idempotency key mismatch');
    }
    return { kind, id, state };
  }
  if (kind === 'batch') {
    const state = raw as unknown as PeriodReportBatchManifest;
    assertBatchRequestId(id);
    requireValue(state.manifestVersion === 1 && state.requestId === id && versionPin(state.published)
      && timestamp(state.createdAt) && Array.isArray(state.receivers) && Array.isArray(state.entries)
      && state.receivers.length === 4 && state.entries.length === 4, 'invalid batch binding');
    for (const [index, receiver] of state.receivers.entries()) {
      const entry = state.entries[index];
      requireValue(receiver.kind === ['customer', 'worker', 'designer', 'boss'][index]
        && entry.kind === receiver.kind && entry.adminId === receiver.adminId
        && receiver.runId === id + '-' + receiver.kind && entry.runId === receiver.runId,
      'batch receiver run key mismatch');
      const receipt = entry.saveReceipt;
      requireValue(!receipt || (key(receipt.reportId) && key(receipt.runId) && key(receipt.reportKey)
        && positiveVersion(receipt.revision)), 'invalid batch save receipt');
      const delivery = entry.deliveryReceipt;
      requireValue(!delivery?.delivered || (key(delivery.messageId) && key(delivery.conversationId)),
        'invalid batch delivery receipt');
    }
    return { kind, id, state };
  }
  if (kind === 'control') {
    const state = raw as unknown as PeriodReportScheduleControl;
    requireValue(id === enterpriseId && typeof state.paused === 'boolean' && Array.isArray(state.cancelledPeriods)
      && state.cancelledPeriods.every((period) => datePattern.test(period)), 'invalid schedule control');
    return { kind, id, state };
  }
  if (kind === 'ledger') {
    const state = raw as unknown as PeriodReportScheduleLedger;
    requireValue(state.projectId === id && state.ledgerVersion === SCHEDULE_LEDGER_VERSION
      && Array.isArray(state.items) && state.items.every((item) => key(item.issueId) && key(item.sourceRecordId)),
    'invalid schedule ledger');
    return { kind, id, state };
  }
  const state = raw as unknown as DurableTaskRecord;
  assertTaskId(id);
  requireValue(state.taskVersion === DURABLE_TASK_VERSION && state.taskId === id && key(state.kind) && key(state.businessKey)
    && state.taskId === durableTaskId(enterpriseId, state.kind, state.businessKey) && timestamp(state.createdAt)
    && timestamp(state.deadlineAt) && isPlainObject(state.delegation) && key(state.delegation.requestedBy)
    && Array.isArray(state.attempts) && Array.isArray(state.steps) && Array.isArray(state.compensations)
    && [...activeStatuses, ...terminalStatuses].includes(state.status), 'invalid durable task binding or version');
  const stepKeys = new Set<string>();
  for (const step of state.steps) {
    requireValue(key(step.key) && !stepKeys.has(step.key) && ['pending', 'succeeded', 'failed', 'skipped'].includes(step.status)
      && (step.status !== 'succeeded' || timestamp(step.finishedAt)), 'invalid or duplicate durable step');
    stepKeys.add(step.key);
  }
  if (state.kind === 'tool.call') {
    const { tool, dispatch, receipt, saved, writebackAt, authorization, callbacks } = state.data;
    requireValue(key(tool) && state.businessKey.startsWith(tool + ':') && state.businessKey.length > tool.length + 1
      && isPlainObject(authorization) && typeof authorization.allowed === 'boolean' && Array.isArray(callbacks),
    'invalid durable tool request');
    requireValue(dispatch === null || (isPlainObject(dispatch) && key(dispatch.dispatchId) && timestamp(dispatch.dispatchedAt)),
      'invalid durable dispatch marker');
    requireValue(receipt === null || (dispatch && isPlainObject(receipt) && key(receipt.receiptId)
      && ['succeeded', 'failed'].includes(String(receipt.status)) && timestamp(receipt.receivedAt)), 'invalid tool receipt');
    requireValue(state.status !== 'succeeded' || (isPlainObject(receipt) && receipt.status === 'succeeded'
      && isPlainObject(saved) && key(saved.savedId) && timestamp(writebackAt)), 'missing completed tool writeback');
  }
  return { kind: 'task', id, state };
}

function isLease(entry: SnapshotEntry) {
  return entry.kind === 'task' ? entry.name.startsWith('leases/')
    : (entry.kind === 'schedule' || entry.kind === 'batch') && entry.name.endsWith('.lease.json');
}

export function validateSnapshot(snapshot: Snapshot) {
  requireValue(snapshot.version === 1 && ['runtime', 'tasks'].includes(snapshot.scope) && Array.isArray(snapshot.files),
    'unsupported snapshot version or scope');
  assertEnterpriseId(snapshot.enterpriseId);
  const { sha256: digest, ...body } = snapshot;
  requireValue(digest === checksum(body), 'snapshot SHA256 mismatch');
  const records: SnapshotRecord[] = [];
  const entries = new Set<string>();
  const leases: { name: string; expiresAt: number }[] = [];
  for (const entry of snapshot.files) {
    const label = entry.kind + '/' + entry.name;
    try {
      requireValue(snapshot.scope === 'tasks' ? entry.kind === 'task' : runtimeKinds.some((kind) => kind === entry.kind),
        'file kind is outside the snapshot scope');
      const prefix = entry.kind === 'task' ? (isLease(entry) ? 'leases/' : 'tasks/') : '';
      const extension = entry.kind !== 'task' && isLease(entry) ? '.lease.json' : '.json';
      const id = entry.name.slice(prefix.length, -extension.length);
      requireValue(entry.name === prefix + id + extension && fileId.test(id) && !entries.has(label), 'invalid or duplicate file name');
      entries.add(label);
      const bytes = Buffer.from(entry.base64, 'base64');
      requireValue(sha256(bytes) === entry.sha256, 'source file SHA256 mismatch');
      if (isLease(entry)) {
        const lease = JSON.parse(bytes.toString('utf8')) as { expiresAt: string | number; owner: string };
        const expiresAt = typeof lease.expiresAt === 'number' ? lease.expiresAt : Date.parse(lease.expiresAt);
        requireValue(key(lease.owner) && Number.isFinite(expiresAt), 'invalid source lease');
        leases.push({ name: label, expiresAt });
      } else {
        records.push(validateRecord(snapshot.enterpriseId, entry.kind, id, envelope(entry.kind, bytes)));
      }
    } catch (error) {
      throw new Error(label + ' ' + (error instanceof Error ? error.message : 'invalid file'));
    }
  }

  const runs = new Map(records.flatMap((record) => record.kind === 'run' ? [[record.id, record.state] as const] : []));
  const batches = new Map(records.flatMap((record) => record.kind === 'batch' ? [[record.id, record.state] as const] : []));
  for (const { kind, state } of records) {
    if (kind === 'batch') {
      for (const entry of state.entries) {
        const run = runs.get(entry.runId);
        requireValue(!entry.executed || run, 'executed batch entry is missing its source run ' + entry.runId);
        if (!run) continue;
        requireValue(run.projectId === state.projectId && run.binding.digest === state.published.digest
          && run.binding.definitionId === state.published.definitionId && run.binding.revision === state.published.revision
          && run.binding.event.eventId === state.event.eventId
          && (run.binding.businessEvent.receiver?.kind ?? 'customer') === entry.kind, 'batch source run binding mismatch ' + entry.runId);
      }
    } else if (kind === 'schedule') {
      for (const entry of Object.values(state.projects)) {
        const batch = batches.get(entry.requestId);
        requireValue(!entry.batchStatus || batch, 'scheduled batch history is missing ' + entry.requestId);
        requireValue(!batch || (batch.projectId === entry.plan.projectId && batch.period.periodStart === state.period.periodStart
          && batch.published.digest === state.published?.digest), 'scheduled batch binding mismatch ' + entry.requestId);
      }
    }
  }
  return { records, leases };
}

async function jsonFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.name.endsWith('.json')).map((entry) => {
    requireValue(entry.isFile(), 'source entry is not a regular file ' + entry.name);
    return entry.name;
  }).sort();
}

export async function captureSnapshot(enterpriseId: string, scope: MigrationScope, roots: SourceRoots): Promise<Snapshot> {
  assertEnterpriseId(enterpriseId);
  const files: SnapshotEntry[] = [];
  async function add(kind: StoreKind, directory: string, name: string, prefix = '') {
    const bytes = await readFile(path.join(directory, name));
    files.push({ kind, name: prefix + name, sha256: sha256(bytes), base64: bytes.toString('base64') });
  }
  async function scopedDirectory(kind: 'run' | 'batch' | 'schedule', directory: string) {
    const names = await jsonFiles(directory);
    const matched = new Set<string>();
    for (const name of names.filter((name) => kind === 'run' || !name.endsWith('.lease.json'))) {
      const bytes = await readFile(path.join(directory, name));
      if (envelope(kind, bytes).enterpriseId !== enterpriseId) continue;
      files.push({ kind, name, sha256: sha256(bytes), base64: bytes.toString('base64') });
      matched.add(name.slice(0, -5));
    }
    if (kind === 'run') return;
    for (const name of names.filter((name) => name.endsWith('.lease.json'))) {
      const id = name.slice(0, -'.lease.json'.length);
      if (matched.has(id) || !names.includes(id + '.json')) await add(kind, directory, name);
    }
  }
  if (scope === 'tasks') {
    for (const subdirectory of ['tasks', 'leases']) {
      const directory = path.join(roots.task, 'tenants', enterpriseId, subdirectory);
      for (const name of await jsonFiles(directory)) await add('task', directory, name, subdirectory + '/');
    }
  } else {
    await scopedDirectory('run', path.join(roots.run, 'runs'));
    await scopedDirectory('batch', path.join(roots.batch, 'requests'));
    await scopedDirectory('schedule', path.join(roots.schedule, 'runs'));
    const control = path.join(roots.schedule, 'control');
    if ((await jsonFiles(control)).includes(enterpriseId + '.json')) await add('control', control, enterpriseId + '.json');
    const ledger = path.join(roots.schedule, 'ledger', enterpriseId);
    for (const name of await jsonFiles(ledger)) await add('ledger', ledger, name);
  }
  const body = { version: 1 as const, enterpriseId, scope, files };
  return { ...body, sha256: checksum(body) };
}
