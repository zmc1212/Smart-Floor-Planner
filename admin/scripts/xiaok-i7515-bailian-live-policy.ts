import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const liveLedgerRoot = fileURLToPath(new URL('../../tmp/xiaok-i7515/live-ledgers/', import.meta.url));
export const liveModels = ['text-embedding-v4', 'deepseek-v4.1-flash-1017'] as const;
export const liveIdPattern = /^[a-zA-Z0-9_.:-]{1,240}$/;
export const liveIndexName = /^xk-[a-f0-9]{17}$/;
const operation = z.enum([
  'list', 'permissions_read', 'permissions_grant', 'permissions_restore', 'embedding', 'chunks',
  'applyFileUploadLease', 'oss_put', 'addFile', 'describeFile', 'create_v2', 'job/create', 'job/status',
  'files', 'chunklist', 'retrieve', 'responses', 'delete', 'deleteFile', 'delete_file',
]);
export type LiveOperation = z.infer<typeof operation>;
const priced: LiveOperation[] = ['applyFileUploadLease', 'oss_put', 'addFile', 'create_v2', 'job/create', 'retrieve', 'responses'];
const micros = z.number().int().nonnegative();
const approvalSchema = z.strictObject({
  version: z.literal(1),
  batchId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  workspace: z.string().regex(/^(ws|llm)-[a-z0-9-]{1,59}$/),
  validFrom: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  allowModelPermissionChanges: z.boolean(),
  limits: z.strictObject({
    requests: z.number().int().min(1).max(1000), indexCreates: z.number().int().min(0).max(3),
    uploads: z.number().int().min(0).max(5), retrievals: z.number().int().min(0).max(24),
    modelCalls: z.number().int().min(0).max(2), budgetMicrosCny: micros,
  }),
  reserveMicrosCny: z.partialRecord(operation, micros),
});
export type LiveApproval = z.infer<typeof approvalSchema>;
export type LiveEnv = Readonly<Record<string, string | undefined>>;

export function readLiveCommand(args: string[]) {
  const [label, mode, permissionFlag, ...extra] = args;
  if (args.length === 1 && label === '--prepare-live-ledger') return { kind: 'prepare' } as const;
  assert.ok((label === undefined || /^[a-z0-9][a-z0-9-]{0,79}$/.test(label)) && extra.length === 0,
    'Invalid I7.5.15 acceptance arguments');
  if (mode === undefined && permissionFlag === undefined) return { kind: 'mock', label } as const;
  assert.ok((mode === '--live' || mode === '--live-core') &&
    (permissionFlag === undefined || permissionFlag === '--allow-model-permission-changes'),
  'Invalid I7.5.15 live mode or permission flag');
  return { kind: 'live', label, core: mode === '--live-core', changePermissions: permissionFlag !== undefined } as const;
}

function readRecord(file: string, maxBytes: number) {
  const info = lstatSync(file);
  assert.ok(info.isFile() && info.nlink === 1 && info.size <= maxBytes, 'Unsafe or oversized I7.5.15 file');
  return readFileSync(file, 'utf8');
}

function assertActive(approval: LiveApproval, now: number) {
  assert.ok(Date.parse(approval.validFrom) <= now && now < Date.parse(approval.expiresAt), 'I7.5.15 authorization is not active');
}

export function readLiveApproval(env: LiveEnv, now = Date.now()): LiveApproval {
  const file = env.XIAOK_I7515_LIVE_AUTHORIZATION_FILE;
  assert.ok(file, 'Set XIAOK_I7515_LIVE_AUTHORIZATION_FILE for a separately approved batch');
  let approval: LiveApproval;
  try { approval = approvalSchema.parse(JSON.parse(readRecord(file, 16_384))); }
  catch { throw new Error('Missing or invalid I7.5.15 authorization file'); }
  assert.ok(env.XIAOK_I7515_EXPECTED_WORKSPACE_ID === approval.workspace, 'Dedicated Workspace does not match authorization');
  assert.ok(Date.parse(approval.expiresAt) - Date.parse(approval.validFrom) <= 30 * 60_000,
    'I7.5.15 authorization may cover at most 30 minutes');
  assertActive(approval, now);
  assert.ok(Object.keys(approval.reserveMicrosCny).length > 0, 'No authorized I7.5.15 operations');
  for (const op of priced) {
    const cost = approval.reserveMicrosCny[op];
    assert.ok(cost === undefined || cost > 0, 'Billable I7.5.15 operations require a positive conservative reservation');
  }
  assert.ok(approval.allowModelPermissionChanges ||
    (approval.reserveMicrosCny.permissions_grant === undefined && approval.reserveMicrosCny.permissions_restore === undefined),
  'Model permission operations require separate approval');
  return approval;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const approvalDigest = (approval: LiveApproval) => hash(JSON.stringify({ ...approval,
  reserveMicrosCny: Object.entries(approval.reserveMicrosCny).sort(([a], [b]) => a.localeCompare(b)),
}));
const id = z.string().regex(liveIdPattern);
const targetSchema = z.strictObject({
  indexId: id.optional(), name: z.string().regex(liveIndexName).optional(), fileId: id.optional(), tag: id.optional(),
  models: z.array(z.enum(liveModels)).min(1).max(2).optional(),
});
const attemptSchema = z.strictObject({
  operation, at: z.number().int().nonnegative(), target: targetSchema,
  status: z.enum(['reserved', 'received', 'failed', 'unknown']),
  requestId: id.nullable(), confirmedId: id.nullable(), inference: z.boolean().optional(),
});
export type LiveAttempt = z.infer<typeof attemptSchema>;
const ledgerSchema = z.strictObject({ version: z.literal(1), approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  attempts: z.array(attemptSchema).max(1000) });
type LedgerState = z.infer<typeof ledgerSchema>;
const envelopeSchema = z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), state: z.unknown() });

function encode(state: LedgerState) {
  return JSON.stringify({ sha256: hash(JSON.stringify(state)), state }) + '\n';
}

function syncDirectory(directory: string) {
  // Node cannot open a directory for fsync on Windows; the file itself is flushed before same-directory rename.
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeNew(file: string, body: string) {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Offline issuance only. An existing Workspace directory is never reinitialized. */
export function prepareLiveLedger(approval: LiveApproval, root = liveLedgerRoot) {
  assertActive(approval, Date.now());
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assert.ok(lstatSync(root).isDirectory(), 'Unsafe live ledger root');
  const dir = join(root, approval.workspace);
  mkdirSync(dir, { mode: 0o700 });
  writeNew(join(dir, 'ledger.json'), encode({ version: 1, approvalDigest: approvalDigest(approval), attempts: [] }));
  syncDirectory(dir);
  syncDirectory(root);
}

/** One exclusive lock for the whole run, including preflight and cleanup.
 * Interrupted runs leave a lock for operator reconciliation; it is never stolen. */
export class LiveLedger {
  private constructor(private readonly approval: LiveApproval, private readonly dir: string, private readonly lock: number,
    private state: LedgerState, private disk: string, private readonly now: () => number) {}

  private closed = false;
  private poisoned = false;

  static open(approval: LiveApproval, root = liveLedgerRoot, now = Date.now) {
    assertActive(approval, now());
    const dir = join(root, approval.workspace), lockPath = join(dir, 'run.lock');
    assert.ok(lstatSync(root).isDirectory() && lstatSync(dir).isDirectory(), 'Unsafe live ledger directory');
    let lock: number;
    try { lock = openSync(lockPath, 'wx', 0o600); }
    catch { throw new Error('I7.5.15 ledger lock unavailable (another run or unreconciled interruption)'); }
    try {
      writeFileSync(lock, `${process.pid}\n`);
      fsyncSync(lock);
      syncDirectory(dir);
      let state: LedgerState, disk: string;
      try {
        disk = readRecord(join(dir, 'ledger.json'), 2_000_000);
        const envelope = envelopeSchema.parse(JSON.parse(disk));
        assert.equal(envelope.sha256, hash(JSON.stringify(envelope.state)));
        state = ledgerSchema.parse(envelope.state);
      } catch { throw new Error('Missing or corrupt I7.5.15 live ledger; reconcile without resetting the batch'); }
      assert.equal(state.approvalDigest, approvalDigest(approval), 'I7.5.15 ledger authorization scope conflict');
      const ledger = new LiveLedger(approval, dir, lock, state, disk, now);
      assert.ok(state.attempts.every((a, i) => a.at >= (state.attempts[i - 1]?.at ?? Date.parse(approval.validFrom))
        && a.at < Date.parse(approval.expiresAt)), 'I7.5.15 ledger timestamps are outside the authorized batch');
      ledger.checkCapacity([]);
      return ledger;
    } catch (error) { closeSync(lock); unlinkSync(lockPath); throw error; }
  }

  get attempts(): readonly Readonly<LiveAttempt>[] { return this.state.attempts; }

  assertActive() {
    assert.ok(!this.closed && !this.poisoned, 'I7.5.15 ledger is unavailable');
    const now = this.now();
    assertActive(this.approval, now);
    assert.ok(now >= (this.attempts.at(-1)?.at ?? 0), 'I7.5.15 ledger clock moved backwards');
    return now;
  }

  private save(attempts: LiveAttempt[]) {
    assert.ok(!this.closed && !this.poisoned, 'I7.5.15 ledger is unavailable');
    const state = { ...this.state, attempts }, next = encode(state);
    const file = join(this.dir, 'ledger.json'), temp = join(this.dir, randomUUID() + '.tmp');
    try {
      assert.equal(readRecord(file, 2_000_000), this.disk, 'I7.5.15 ledger changed during the run');
      writeNew(temp, next);
      renameSync(temp, file);
      syncDirectory(this.dir);
    } catch {
      this.poisoned = true;
      throw new Error('I7.5.15 ledger write failed; dispatch blocked and existing reservations retained');
    }
    this.state = state;
    this.disk = next;
  }

  checkCapacity(operations: LiveOperation[]) {
    const now = this.assertActive();
    const { requests, indexCreates, uploads, retrievals, modelCalls, budgetMicrosCny } = this.approval.limits;
    const used = this.summary();
    assert.ok(used.requests + operations.length <= requests, 'I7.5.15 cumulative request limit exceeded');
    assert.ok(used.reservedMicrosCny <= budgetMicrosCny, 'I7.5.15 conservative budget exceeded');
    let reserved = used.reservedMicrosCny;
    for (const op of operations) {
      const cost = this.approval.reserveMicrosCny[op];
      assert.ok(cost !== undefined, 'I7.5.15 operation is not authorized: ' + op);
      const count = (used.counts[op] ?? 0) + 1;
      used.counts[op] = count;
      const limit = op === 'create_v2' ? indexCreates : op === 'retrieve' ? retrievals : op === 'responses' ? modelCalls
        : ['applyFileUploadLease', 'oss_put', 'addFile'].includes(op) ? uploads : requests;
      assert.ok(count <= limit, 'I7.5.15 cumulative operation limit exceeded: ' + op);
      assert.ok(cost <= budgetMicrosCny - reserved, 'I7.5.15 conservative budget exceeded');
      reserved += cost;
    }
    return now;
  }

  reserve(op: LiveOperation, target: LiveAttempt['target'] = {}) {
    const at = this.checkCapacity([op]);
    const sequence = this.attempts.length;
    const attempt = attemptSchema.parse({ operation: op, at, target, status: 'reserved', requestId: null, confirmedId: null });
    this.save([...this.attempts, attempt]);
    return sequence;
  }

  finish(sequence: number, result: Pick<LiveAttempt, 'status' | 'requestId' | 'confirmedId' | 'inference'>) {
    const pending = this.state.attempts[sequence];
    assert.ok(pending?.status === 'reserved' && result.status !== 'reserved', 'I7.5.15 reservation is not pending');
    const attempts = [...this.state.attempts];
    attempts[sequence] = attemptSchema.parse({ ...pending, ...result });
    this.save(attempts);
  }

  summary() {
    const counts: Partial<Record<LiveOperation, number>> = {};
    let reservedMicrosCny = 0;
    for (const { operation: op } of this.attempts) {
      const cost = this.approval.reserveMicrosCny[op];
      assert.ok(cost !== undefined, 'I7.5.15 ledger contains an unauthorized operation');
      counts[op] = (counts[op] ?? 0) + 1;
      reservedMicrosCny += cost;
    }
    return { batchId: this.approval.batchId, authorizationDigest: this.state.approvalDigest, expiresAt: this.approval.expiresAt,
      requests: this.attempts.length, counts, reservedMicrosCny, budgetMicrosCny: this.approval.limits.budgetMicrosCny,
      unresolvedAttempts: this.attempts.flatMap((a, i) => a.status === 'reserved' || a.status === 'unknown'
        ? [{ sequence: i, operation: a.operation, requestId: a.requestId }] : []), billingStatus: 'pending_invoice_reconciliation' };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.lock);
    unlinkSync(join(this.dir, 'run.lock'));
  }
}
