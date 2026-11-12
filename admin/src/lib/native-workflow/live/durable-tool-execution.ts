/** Reliable external tool execution on top of the durable task runtime.
 *
 * The flow is persisted at every boundary:
 *   request/authorization -> dispatch marker -> external response (callback or
 *   probe) -> result save -> business status writeback -> terminal receipt.
 *
 * Rules:
 * - the dispatch marker is durable BEFORE the external call, so a restart never
 *   assumes an unrecorded call was free;
 * - a request timeout, a crash or an unknown error never triggers a second
 *   dispatch; the external outcome is reconciled by `probe` first;
 * - duplicate callbacks are deduplicated by `callbackId`, conflicting receipts
 *   are rejected, and callbacks that arrive after a terminal state are recorded
 *   as ignored without resurrecting the task;
 * - a failed result save keeps the already received receipt and retries only
 *   the save/writeback phase, never the external dispatch;
 * - every lookup is tenant-scoped, and a foreign-tenant task behaves as missing.
 */

import { WorkflowOperationError } from '../errors';
import type {
  DurableTaskData,
  DurableTaskDelegation,
  DurableTaskRecord,
  DurableTaskRetryPolicy,
  DurableTaskTimeouts,
} from './durable-task-types';
import { isTerminalDurableTaskStatus } from './durable-task-types';
import type { DurableTaskLeaseRef, DurableTaskRuntime } from './durable-task-runtime';

export type DurableToolEffect = 'read' | 'save' | 'deliver';

export interface DurableToolAuthorization {
  readonly allowed: boolean;
  readonly actorId: string;
  readonly checkedAt: string;
  readonly scope: string;
  readonly reason: string | null;
}

export interface DurableToolRequest {
  readonly enterpriseId: string;
  readonly projectId?: string | null;
  readonly tool: string;
  /** Business idempotency key; the same key never dispatches twice. */
  readonly idempotencyKey: string;
  readonly delegation: DurableTaskDelegation;
  readonly authorization: DurableToolAuthorization;
  readonly effect: DurableToolEffect;
  readonly payload: DurableTaskData;
  readonly workerId: string;
  readonly timeouts?: Partial<DurableTaskTimeouts>;
  readonly retry?: Partial<DurableTaskRetryPolicy>;
}

export interface DurableToolDispatchInput {
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly taskId: string;
  /** Durable correlation id; send it to the external system as its idempotency
   * or correlation key so `probe` can resolve the call even when no
   * `externalId` response was received. */
  readonly dispatchId: string;
  readonly tool: string;
  readonly idempotencyKey: string;
  readonly payload: DurableTaskData;
}

export interface DurableToolProbeInput {
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly taskId: string;
  readonly dispatchId: string;
  readonly externalId: string;
}

export interface DurableToolProbeResult {
  readonly status: 'succeeded' | 'failed' | 'unknown';
  readonly result?: DurableTaskData;
  readonly errorCode?: string;
}

export interface DurableToolSaveInput {
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly taskId: string;
  readonly receiptId: string;
  readonly externalId: string;
  readonly result: DurableTaskData | null;
}

export interface DurableToolWritebackInput {
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly taskId: string;
  readonly receiptId: string;
  readonly savedId: string;
  readonly result: DurableTaskData | null;
}

export interface DurableToolPort {
  dispatch(input: DurableToolDispatchInput): Promise<{ readonly externalId: string }>;
  probe(input: DurableToolProbeInput): Promise<DurableToolProbeResult>;
  /** Must be idempotent by `receiptId`: a save retry can repeat after a crash. */
  saveResult(input: DurableToolSaveInput): Promise<{ readonly savedId: string }>;
  /** Must be idempotent by `receiptId` + `savedId`: a writeback retry can repeat. */
  writeback(input: DurableToolWritebackInput): Promise<void>;
}

/** A dispatch that provably did not leave the process; safe to retry. */
export class DurableToolNotSentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DurableToolNotSentError';
    this.code = code;
  }
}

class DurableToolCallTimeoutError extends Error {
  readonly code = 'external_call_timeout';

  constructor(label: string) {
    super(`${label} exceeded its external call timeout`);
    this.name = 'DurableToolCallTimeoutError';
  }
}

export interface DurableToolCallback {
  readonly enterpriseId: string;
  readonly taskId: string;
  readonly callbackId: string;
  readonly dispatchId: string;
  readonly status: 'succeeded' | 'failed';
  readonly result?: DurableTaskData;
  readonly errorCode?: string;
}

export type DurableToolCallbackReason =
  | 'duplicate'
  | 'terminal'
  | 'unmatched'
  | 'already_settled'
  | 'busy'
  | 'not_found';

export interface DurableToolCallbackResult {
  readonly applied: boolean;
  readonly reason: DurableToolCallbackReason | null;
  readonly record: DurableTaskRecord | null;
}

export type DurableToolSubmissionState =
  | 'rejected'
  | 'queued'
  | 'dispatched'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'in_flight'
  | 'unknown';

export interface DurableToolSubmission {
  readonly taskId: string;
  readonly state: DurableToolSubmissionState;
  readonly record: DurableTaskRecord;
  readonly result: DurableTaskData | null;
}

interface ToolCallbackObservation {
  readonly callbackId: string;
  readonly receivedAt: string;
  readonly applied: boolean;
  readonly reason: string | null;
}

interface ToolDispatchState {
  readonly dispatchId: string;
  readonly externalId: string | null;
  readonly dispatchedAt: string;
}

interface ToolReceiptState {
  readonly callbackId: string;
  readonly receiptId: string;
  readonly status: 'succeeded' | 'failed';
  readonly result: DurableTaskData | null;
  readonly errorCode: string | null;
  readonly receivedAt: string;
}

interface ToolSavedState {
  readonly savedId: string;
  readonly savedAt: string;
}

type ToolPendingPhase = 'save_result' | 'writeback';

interface ToolState {
  readonly tool: string;
  readonly authorization: DurableToolAuthorization;
  readonly effect: DurableToolEffect;
  readonly payload: DurableTaskData;
  readonly dispatch: ToolDispatchState | null;
  readonly receipt: ToolReceiptState | null;
  readonly callbacks: readonly ToolCallbackObservation[];
  readonly saved: ToolSavedState | null;
  readonly writebackAt: string | null;
  readonly pendingPhase: ToolPendingPhase | null;
  readonly probes: number;
}

export interface DurableToolExecutorOptions {
  readonly runtime: DurableTaskRuntime;
  readonly port: DurableToolPort;
  readonly maxProbes?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface DurableToolExecutor {
  submit(request: DurableToolRequest): Promise<DurableToolSubmission>;
  handleCallback(callback: DurableToolCallback): Promise<DurableToolCallbackResult>;
  reconcile(enterpriseId: string, taskId: string): Promise<DurableTaskRecord | null>;
  resume(enterpriseId: string, taskId: string): Promise<DurableTaskRecord | null>;
}

const MAX_CALLBACK_HISTORY = 20;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DurableToolCallTimeoutError(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asData(value: unknown): DurableTaskData {
  return (asRecord(value) as DurableTaskData | null) ?? {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stateOf(record: DurableTaskRecord): ToolState {
  const dispatch = asRecord(record.data.dispatch);
  const receipt = asRecord(record.data.receipt);
  const saved = asRecord(record.data.saved);
  const authorization = asRecord(record.data.authorization);
  const callbacks = Array.isArray(record.data.callbacks) ? record.data.callbacks : [];
  if (!authorization || typeof authorization.actorId !== 'string') {
    throw new WorkflowOperationError(
      'durable_tool_state_invalid',
      500,
      `durable tool task ${record.taskId} lost its authorization snapshot`,
    );
  }
  return {
    tool: String(record.data.tool ?? ''),
    authorization: {
      allowed: authorization.allowed === true,
      actorId: authorization.actorId,
      checkedAt: String(authorization.checkedAt ?? ''),
      scope: String(authorization.scope ?? ''),
      reason: asString(authorization.reason),
    },
    effect: record.data.effect === 'save' || record.data.effect === 'deliver'
      ? record.data.effect
      : 'read',
    payload: asData(record.data.payload),
    dispatch: dispatch
      ? {
          dispatchId: String(dispatch.dispatchId ?? ''),
          externalId: asString(dispatch.externalId),
          dispatchedAt: String(dispatch.dispatchedAt ?? ''),
        }
      : null,
    receipt: receipt
      ? {
          callbackId: String(receipt.callbackId ?? ''),
          receiptId: String(receipt.receiptId ?? ''),
          status: receipt.status === 'failed' ? 'failed' : 'succeeded',
          result: asRecord(receipt.result) ? asData(receipt.result) : null,
          errorCode: asString(receipt.errorCode),
          receivedAt: String(receipt.receivedAt ?? ''),
        }
      : null,
    callbacks: callbacks
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        callbackId: String(item.callbackId ?? ''),
        receivedAt: String(item.receivedAt ?? ''),
        applied: item.applied === true,
        reason: asString(item.reason),
      }))
      .slice(-MAX_CALLBACK_HISTORY),
    saved: saved ? { savedId: String(saved.savedId ?? ''), savedAt: String(saved.savedAt ?? '') } : null,
    writebackAt: asString(record.data.writebackAt),
    pendingPhase: record.data.pendingPhase === 'save_result' || record.data.pendingPhase === 'writeback'
      ? record.data.pendingPhase
      : null,
    probes: typeof record.data.probes === 'number' ? record.data.probes : 0,
  };
}

function toData(state: ToolState): DurableTaskData {
  return {
    tool: state.tool,
    authorization: {
      allowed: state.authorization.allowed,
      actorId: state.authorization.actorId,
      checkedAt: state.authorization.checkedAt,
      scope: state.authorization.scope,
      reason: state.authorization.reason,
    },
    effect: state.effect,
    payload: state.payload,
    dispatch: state.dispatch
      ? {
          dispatchId: state.dispatch.dispatchId,
          externalId: state.dispatch.externalId,
          dispatchedAt: state.dispatch.dispatchedAt,
        }
      : null,
    receipt: state.receipt
      ? {
          callbackId: state.receipt.callbackId,
          receiptId: state.receipt.receiptId,
          status: state.receipt.status,
          result: state.receipt.result,
          errorCode: state.receipt.errorCode,
          receivedAt: state.receipt.receivedAt,
        }
      : null,
    callbacks: state.callbacks.map(callbackData),
    saved: state.saved ? { savedId: state.saved.savedId, savedAt: state.saved.savedAt } : null,
    writebackAt: state.writebackAt,
    pendingPhase: state.pendingPhase,
    probes: state.probes,
  };
}

function step(
  key: string,
  status: 'pending' | 'succeeded' | 'failed' | 'skipped',
  startedAt: string,
  finishedAt: string | null,
  errorCode: string | null = null,
) {
  return {
    key,
    status,
    attempts: 1,
    startedAt,
    finishedAt,
    errorCode,
    outputs: null,
  } as const;
}

function callbackData(callback: ToolCallbackObservation): DurableTaskData {
  return {
    callbackId: callback.callbackId,
    receivedAt: callback.receivedAt,
    applied: callback.applied,
    reason: callback.reason,
  };
}

function codeOf(error: unknown): string {
  if (error instanceof WorkflowOperationError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return String((error as { code: string }).code);
  }
  return 'external_call_failed';
}

export function createDurableToolExecutor(options: DurableToolExecutorOptions): DurableToolExecutor {
  const runtime = options.runtime;
  const port = options.port;
  const maxProbes = Math.max(1, options.maxProbes ?? 3);
  const clock = options.now ?? (() => runtime.now());
  const newId = options.newId ?? (() => runtime.newId());

  function nowIso(): string {
    return clock().toISOString();
  }

  function leaseOf(record: DurableTaskRecord, owner: string, token: string): DurableTaskLeaseRef {
    return {
      enterpriseId: record.enterpriseId,
      taskId: record.taskId,
      owner,
      token,
    };
  }

  async function applyReceipt(
    record: DurableTaskRecord,
    lease: DurableTaskLeaseRef,
    state: ToolState,
  ): Promise<DurableTaskRecord> {
    let current = record;
    let next = state;
    const receipt = state.receipt;
    if (!receipt) throw new Error('receipt is required before saving the result');
    const externalId = state.dispatch?.externalId ?? '';

    if (!next.saved) {
      try {
        const saved = await withTimeout(
          port.saveResult({
            enterpriseId: current.enterpriseId,
            projectId: current.projectId,
            taskId: current.taskId,
            receiptId: receipt.receiptId,
            externalId,
            result: receipt.result,
          }),
          current.timeouts.externalCallTimeoutMs,
          'saveResult',
        );
        next = { ...next, saved: { savedId: saved.savedId, savedAt: nowIso() }, pendingPhase: 'writeback' };
        current = await runtime.checkpoint({ ...lease, data: toData(next) });
      } catch {
        return runtime.wait({
          ...lease,
          reason: 'the external result was received but saving it failed',
          code: 'result_save_failed',
          wakeAt: new Date(clock().getTime() + current.retry.baseDelayMs).toISOString(),
          data: toData({ ...next, pendingPhase: 'save_result' }),
        });
      }
    }

    const saved = next.saved;
    if (!saved) throw new Error('saved id is required before writeback');
    try {
      await withTimeout(
        port.writeback({
          enterpriseId: current.enterpriseId,
          projectId: current.projectId,
          taskId: current.taskId,
          receiptId: receipt.receiptId,
          savedId: saved.savedId,
          result: receipt.result,
        }),
        current.timeouts.externalCallTimeoutMs,
        'writeback',
      );
      next = { ...next, writebackAt: nowIso(), pendingPhase: null };
      return runtime.complete({
        ...lease,
        data: toData(next),
        steps: [step('writeback', 'succeeded', next.receipt?.receivedAt ?? nowIso(), nowIso())],
      });
    } catch {
      return runtime.wait({
        ...lease,
        reason: 'the result was saved but the business status writeback failed',
        code: 'writeback_failed',
        wakeAt: new Date(clock().getTime() + current.retry.baseDelayMs).toISOString(),
        data: toData({ ...next, pendingPhase: 'writeback' }),
      });
    }
  }

  async function claimForRecovery(
    record: DurableTaskRecord,
    owner: string,
    ttlMs: number,
  ): Promise<{ record: DurableTaskRecord; lease: DurableTaskLeaseRef } | null> {
    const token = newId();
    const acquired = await runtime.acquire({
      enterpriseId: record.enterpriseId,
      taskId: record.taskId,
      owner,
      token,
      ttlMs,
    });
    if (!acquired) return null;
    return {
      record: acquired.record,
      lease: leaseOf(acquired.record, owner, token),
    };
  }

  async function reconcileOnce(record: DurableTaskRecord): Promise<DurableTaskRecord> {
    const state = stateOf(record);
    if (!state.dispatch) return record;
    const claimed = await claimForRecovery(record, 'tool-reconcile', record.timeouts.attemptTimeoutMs);
    if (!claimed) return record;
    const current = claimed.record;
    const lease = claimed.lease;
    const currentState = stateOf(current);
    if (currentState.receipt || !currentState.dispatch) return current;
    let probe: DurableToolProbeResult;
    try {
      probe = await withTimeout(
        port.probe({
          enterpriseId: current.enterpriseId,
          projectId: current.projectId,
          taskId: current.taskId,
          dispatchId: currentState.dispatch.dispatchId,
          externalId: currentState.dispatch.externalId ?? '',
        }),
        current.timeouts.externalCallTimeoutMs,
        'probe',
      );
    } catch (error) {
      probe = { status: 'unknown', errorCode: codeOf(error) };
    }
    const probes = currentState.probes + 1;
    if (probe.status === 'succeeded') {
      const receipt: ToolReceiptState = {
        callbackId: `probe-${probes}`,
        receiptId: `probe-${currentState.dispatch.dispatchId}`,
        status: 'succeeded',
        result: probe.result ?? {},
        errorCode: null,
        receivedAt: nowIso(),
      };
      const next: ToolState = { ...currentState, receipt, probes, pendingPhase: 'save_result' };
      const updated = await runtime.checkpoint({ ...lease, data: toData(next) });
      return applyReceipt(updated, lease, next);
    }
    if (probe.status === 'failed') {
      const next: ToolState = { ...currentState, probes, pendingPhase: null };
      return runtime.fail({
        ...lease,
        errorClass: 'permanent',
        code: probe.errorCode ?? 'external_execution_failed',
        message: 'the external system reported a definitive failure',
        data: toData(next),
      });
    }
    if (probes >= maxProbes) {
      const next: ToolState = { ...currentState, probes, pendingPhase: null };
      return runtime.fail({
        ...lease,
        errorClass: 'permanent',
        code: 'external_outcome_unconfirmed',
        message: 'the external outcome could not be confirmed after bounded probes',
        data: toData(next),
      });
    }
    return runtime.wait({
      ...lease,
      reason: 'the external outcome is still unknown',
      code: 'external_outcome_unknown',
      wakeAt: new Date(clock().getTime() + current.retry.baseDelayMs * probes).toISOString(),
      data: toData({ ...currentState, probes }),
    });
  }

  const executor: DurableToolExecutor = {
    async submit(request) {
      const created = await runtime.create({
        enterpriseId: request.enterpriseId,
        projectId: request.projectId ?? null,
        kind: 'tool.call',
        businessKey: `${request.tool}:${request.idempotencyKey}`,
        delegation: request.delegation,
        recoveryMode: 'reconcile',
        timeouts: request.timeouts,
        retry: request.retry,
        data: toData({
          tool: request.tool,
          authorization: { ...request.authorization },
          effect: request.effect,
          payload: request.payload,
          dispatch: null,
          receipt: null,
          callbacks: [],
          saved: null,
          writebackAt: null,
          pendingPhase: null,
          probes: 0,
        }),
      });
      let record = created.record;
      const state = stateOf(record);

      if (!created.created) {
        if (record.status === 'succeeded') {
          return { taskId: record.taskId, state: 'succeeded', record, result: state.receipt?.result ?? null };
        }
        if (isTerminalDurableTaskStatus(record.status)) {
          return {
            taskId: record.taskId,
            state: record.status as 'failed' | 'cancelled' | 'expired',
            record,
            result: state.receipt?.result ?? null,
          };
        }
        if (record.status === 'running' || record.status === 'waiting') {
          const state = record.status === 'waiting' && record.lastError?.code === 'external_outcome_unknown'
            ? 'unknown' : 'in_flight';
          return { taskId: record.taskId, state, record, result: null };
        }
      }

      if (record.status === 'pending') {
        record = await runtime.enqueue({ enterpriseId: record.enterpriseId, taskId: record.taskId });
      }

      if (!state.authorization.allowed) {
        const claimed = await runtime.claim({
          enterpriseId: record.enterpriseId,
          taskId: record.taskId,
          owner: request.workerId,
          leaseTtlMs: record.timeouts.attemptTimeoutMs,
        });
        if (claimed) {
          record = await runtime.fail({
            enterpriseId: record.enterpriseId,
            taskId: record.taskId,
            owner: request.workerId,
            token: claimed.lease.token,
            errorClass: 'business_rejection',
            code: 'tool_unauthorized',
            message: state.authorization.reason ?? 'the caller is not authorized for this tool',
          });
        }
        return { taskId: record.taskId, state: 'rejected', record, result: null };
      }

      // A recorded dispatch without a receipt is an uncertain external effect:
      // never dispatch again, reconcile instead.
      if (state.dispatch) {
        if (state.receipt) {
          return { taskId: record.taskId, state: 'in_flight', record, result: null };
        }
        return { taskId: record.taskId, state: 'unknown', record, result: null };
      }

      const claimed = await runtime.claim({
        enterpriseId: record.enterpriseId,
        taskId: record.taskId,
        owner: request.workerId,
        leaseTtlMs: record.timeouts.attemptTimeoutMs,
      });
      if (!claimed) {
        return { taskId: record.taskId, state: 'in_flight', record, result: null };
      }
      record = claimed.record;
      const lease = leaseOf(record, request.workerId, claimed.lease.token);

      const dispatchId = newId();
      const dispatchedAt = nowIso();
      const marked: ToolState = {
        ...stateOf(record),
        dispatch: { dispatchId, externalId: null, dispatchedAt },
        pendingPhase: null,
      };
      record = await runtime.checkpoint({
        ...lease,
        data: toData(marked),
        steps: [step('dispatch', 'pending', dispatchedAt, null)],
      });

      try {
        const accepted = await withTimeout(
          port.dispatch({
            enterpriseId: record.enterpriseId,
            projectId: record.projectId,
            taskId: record.taskId,
            dispatchId,
            tool: request.tool,
            idempotencyKey: request.idempotencyKey,
            payload: request.payload,
          }),
          record.timeouts.externalCallTimeoutMs,
          'dispatch',
        );
        const dispatched: ToolState = {
          ...marked,
          dispatch: { dispatchId, externalId: accepted.externalId, dispatchedAt },
        };
        record = await runtime.checkpoint({
          ...lease,
          data: toData(dispatched),
          steps: [step('dispatch', 'succeeded', dispatchedAt, nowIso())],
        });
        record = await runtime.wait({
          ...lease,
          reason: 'waiting for the external callback',
          code: 'awaiting_callback',
          wakeAt: null,
          data: toData(dispatched),
        });
        return { taskId: record.taskId, state: 'dispatched', record, result: null };
      } catch (error) {
        if (error instanceof DurableToolNotSentError) {
          record = await runtime.fail({
            ...lease,
            errorClass: 'transient',
            code: error.code,
            message: error.message,
            steps: [step('dispatch', 'failed', dispatchedAt, nowIso(), error.code)],
          });
          return {
            taskId: record.taskId,
            state: record.status === 'retrying' ? 'queued' : 'failed',
            record,
            result: null,
          };
        }
        // Timeout or ambiguous error: the external side may have accepted it.
        const unknownState: ToolState = { ...marked, pendingPhase: null };
        record = await runtime.wait({
          ...lease,
          reason: 'the external call did not return a usable acceptance',
          code: 'external_outcome_unknown',
          wakeAt: nowIso(),
          data: toData(unknownState),
          steps: [step('dispatch', 'failed', dispatchedAt, nowIso(), codeOf(error))],
        });
        return { taskId: record.taskId, state: 'unknown', record, result: null };
      }
    },

    async handleCallback(callback) {
      const record = await runtime.get(callback.enterpriseId, callback.taskId);
      if (!record) return { applied: false, reason: 'not_found', record: null };
      const state = stateOf(record);
      const receivedAt = nowIso();
      if (state.callbacks.some((item) => item.callbackId === callback.callbackId)) {
        return { applied: false, reason: 'duplicate', record };
      }
      const observation: ToolCallbackObservation = {
        callbackId: callback.callbackId,
        receivedAt,
        applied: false,
        reason: null,
      };
      if (isTerminalDurableTaskStatus(record.status)) {
        const updated = await runtime.appendData({
          enterpriseId: record.enterpriseId,
          taskId: record.taskId,
          data: { callbacks: [...state.callbacks, { ...observation, reason: 'terminal' }].map(callbackData) },
        });
        return { applied: false, reason: 'terminal', record: updated };
      }
      if (!state.dispatch || state.dispatch.dispatchId !== callback.dispatchId) {
        const updated = await runtime.appendData({
          enterpriseId: record.enterpriseId,
          taskId: record.taskId,
          data: { callbacks: [...state.callbacks, { ...observation, reason: 'unmatched' }].map(callbackData) },
        });
        return { applied: false, reason: 'unmatched', record: updated };
      }
      if (state.receipt) {
        const updated = await runtime.appendData({
          enterpriseId: record.enterpriseId,
          taskId: record.taskId,
          data: { callbacks: [...state.callbacks, { ...observation, reason: 'already_settled' }].map(callbackData) },
        });
        return { applied: false, reason: 'already_settled', record: updated };
      }

      const owner = `tool-callback-${callback.callbackId}`;
      const token = newId();
      const acquired = await runtime.acquire({
        enterpriseId: record.enterpriseId,
        taskId: record.taskId,
        owner,
        token,
        ttlMs: record.timeouts.attemptTimeoutMs,
      });
      if (!acquired) return { applied: false, reason: 'busy', record };
      // Re-validate after taking ownership: a concurrent callback may have
      // settled the task between the first read and the lease acquisition.
      const latestState = stateOf(acquired.record);
      if (latestState.callbacks.some((item) => item.callbackId === callback.callbackId)) {
        await runtime.release(leaseOf(acquired.record, owner, token));
        return { applied: false, reason: 'duplicate', record: acquired.record };
      }
      if (latestState.receipt || isTerminalDurableTaskStatus(acquired.record.status)) {
        await runtime.release(leaseOf(acquired.record, owner, token));
        return { applied: false, reason: latestState.receipt ? 'already_settled' : 'terminal', record: acquired.record };
      }
      const lease = leaseOf(record, owner, token);
      const receipt: ToolReceiptState = {
        callbackId: callback.callbackId,
        receiptId: `receipt-${callback.callbackId}`,
        status: callback.status,
        result: callback.result ?? null,
        errorCode: callback.errorCode ?? null,
        receivedAt,
      };
      const next: ToolState = {
        ...latestState,
        receipt,
        callbacks: [...latestState.callbacks, { ...observation, applied: true }],
        pendingPhase: callback.status === 'succeeded' ? 'save_result' : null,
      };
      try {
        // The receipt is durable before any save can fail.
        let current = await runtime.checkpoint({ ...lease, data: toData(next) });
        if (callback.status === 'failed') {
          current = await runtime.fail({
            ...lease,
            errorClass: 'permanent',
            code: callback.errorCode ?? 'external_execution_failed',
            message: 'the external system reported a definitive failure',
            data: toData(next),
          });
          return { applied: true, reason: null, record: current };
        }
        current = await applyReceipt(current, lease, next);
        return { applied: true, reason: null, record: current };
      } catch (error) {
        if (error instanceof WorkflowOperationError && error.code === 'durable_task_lease_lost') {
          return { applied: false, reason: 'busy', record: await runtime.get(callback.enterpriseId, callback.taskId) };
        }
        throw error;
      }
    },

    async reconcile(enterpriseId, taskId) {
      const record = await runtime.get(enterpriseId, taskId);
      if (!record || isTerminalDurableTaskStatus(record.status)) return record;
      const state = stateOf(record);
      if (state.receipt && state.pendingPhase) {
        return executor.resume(enterpriseId, taskId);
      }
      if (!state.dispatch) return record;
      return reconcileOnce(record);
    },

    async resume(enterpriseId, taskId) {
      const record = await runtime.get(enterpriseId, taskId);
      if (!record || isTerminalDurableTaskStatus(record.status)) return record;
      const state = stateOf(record);
      if (!state.receipt) return record;
      if (!state.pendingPhase) return record;
      const claimed = await claimForRecovery(record, `tool-resume-${record.taskId}`, record.timeouts.attemptTimeoutMs);
      if (!claimed) return record;
      return applyReceipt(claimed.record, claimed.lease, stateOf(claimed.record));
    },
  };
  return executor;
}
