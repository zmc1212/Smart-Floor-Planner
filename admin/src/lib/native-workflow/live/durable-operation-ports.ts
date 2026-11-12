/** Durable, idempotent adapter for the existing live operation port.
 *
 * The live runner keeps its current contract: it still calls one
 * `LiveOperationPorts.execute` per pending node and a thrown `unknown` outcome
 * stops the run. This adapter wraps a business port so the call itself becomes
 * a durable task:
 * - the operation identity (`runId` + `idempotencyKey`) is persisted before the
 *   first business write;
 * - a replay with the same identity returns the stored result instead of
 *   executing the effect twice;
 * - only `LiveOperationTransientError` is retried; a known `LiveOperationFailure`
 *   is a business rejection, and a timeout or generic error stays unknown and
 *   is never replayed automatically;
 * - every attempt, result and error code is queryable in the durable store.
 */

import { workflowIssue } from '../errors';
import type { PendingOperation, WorkflowValue } from '../types';
import {
  createDurableTaskRuntime,
  type DurableTaskRuntime,
} from './durable-task-runtime';
import type { DurableTaskStore } from './durable-task-store';
import type {
  DurableTaskData,
  DurableTaskRecord,
  DurableTaskRetryPolicy,
  DurableTaskTimeouts,
} from './durable-task-types';
import { DEFAULT_DURABLE_TASK_RETRY, DEFAULT_DURABLE_TASK_TIMEOUTS } from './durable-task-runtime';
import {
  LiveOperationFailure,
  LiveOperationTransientError,
  LiveOperationUnknownError,
  type LiveOperationPorts,
  type LiveRunContext,
} from './types';

export interface DurableLiveOperationPortsOptions {
  readonly store: DurableTaskStore;
  readonly base: LiveOperationPorts;
  readonly owner: string;
  readonly timeouts?: Partial<DurableTaskTimeouts>;
  readonly retry?: Partial<DurableTaskRetryPolicy>;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

class DurableOperationTimeoutError extends Error {
  constructor() {
    super('the live operation exceeded its external call timeout');
    this.name = 'DurableOperationTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DurableOperationTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function storedOutputs(record: DurableTaskRecord): Readonly<Record<string, WorkflowValue>> | null {
  const result = record.data.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  return result as Readonly<Record<string, WorkflowValue>>;
}

function operationData(
  operation: PendingOperation,
  context: LiveRunContext,
): DurableTaskData {
  return {
    nodeId: operation.nodeId,
    capabilityRef: operation.capabilityRef,
    effect: operation.effect,
    nodeVersion: operation.nodeVersion,
    idempotencyKey: operation.idempotencyKey,
    runId: context.runId,
  };
}

function terminalUnknown(record: DurableTaskRecord, path: string): LiveOperationUnknownError {
  return new LiveOperationUnknownError(workflowIssue(
    'durable_operation_terminal',
    path,
    `operation ${record.taskId} already ended as ${record.status} and is never replayed`,
  ));
}

export function createDurableLiveOperationPorts(
  options: DurableLiveOperationPortsOptions,
): LiveOperationPorts {
  const runtime: DurableTaskRuntime = createDurableTaskRuntime({
    store: options.store,
    now: options.now,
  });
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeouts = { ...DEFAULT_DURABLE_TASK_TIMEOUTS, ...options.timeouts };
  const retry = { ...DEFAULT_DURABLE_TASK_RETRY, ...options.retry };

  return {
    async execute(operation, context) {
      const path = `nodes.${operation.nodeId}`;
      const businessKey = `${context.runId}:${operation.idempotencyKey}`;
      const created = await runtime.create({
        enterpriseId: context.enterpriseId,
        projectId: context.projectId,
        kind: 'live.operation',
        businessKey,
        delegation: {
          requestedBy: options.owner,
          conversationId: null,
          messageId: null,
          runId: context.runId,
        },
        recoveryMode: 'reconcile',
        timeouts,
        retry,
        data: operationData(operation, context),
      });
      let record = created.record;

      const existing = storedOutputs(record);
      if (record.status === 'succeeded') {
        if (!existing) throw terminalUnknown(record, path);
        return existing;
      }
      if (record.status === 'failed' || record.status === 'cancelled' || record.status === 'expired') {
        throw terminalUnknown(record, path);
      }
      if (record.status === 'running' || record.status === 'waiting') {
        throw new LiveOperationUnknownError(workflowIssue(
          'operation_busy',
          path,
          `operation ${record.taskId} is already being executed by another worker`,
        ));
      }
      if (record.status === 'pending') {
        record = await runtime.enqueue({ enterpriseId: context.enterpriseId, taskId: record.taskId });
      }

      for (let attempt = 0; attempt < retry.maxAttempts; attempt += 1) {
        const claimed = await runtime.claim({
          enterpriseId: context.enterpriseId,
          taskId: record.taskId,
          owner: options.owner,
          leaseTtlMs: timeouts.attemptTimeoutMs,
        });
        if (!claimed) {
          const current = await runtime.get(context.enterpriseId, record.taskId);
          const stored = current ? storedOutputs(current) : null;
          if (current?.status === 'succeeded' && stored) return stored;
          throw new LiveOperationUnknownError(workflowIssue(
            'operation_busy',
            path,
            `operation ${record.taskId} could not be claimed`,
          ));
        }
        const lease = {
          enterpriseId: context.enterpriseId,
          taskId: record.taskId,
          owner: options.owner,
          token: claimed.lease.token,
        };
        try {
          const outputs = await withTimeout(
            options.base.execute(operation, context),
            timeouts.externalCallTimeoutMs,
          );
          await runtime.complete({
            ...lease,
            data: { result: outputs as unknown as DurableTaskData },
            steps: [{
              key: operation.idempotencyKey,
              status: 'succeeded',
              attempts: attempt + 1,
              startedAt: claimed.lease.acquiredAt,
              finishedAt: runtime.now().toISOString(),
              errorCode: null,
              outputs: outputs as unknown as DurableTaskData,
            }],
          });
          return outputs;
        } catch (error) {
          if (error instanceof LiveOperationFailure) {
            await runtime.fail({
              ...lease,
              errorClass: 'business_rejection',
              code: error.issue.code,
              message: error.issue.message,
            });
            throw error;
          }
          if (error instanceof LiveOperationTransientError) {
            const failed = await runtime.fail({
              ...lease,
              errorClass: 'transient',
              code: error.issue.code,
              message: error.issue.message,
            });
            if (failed.status === 'retrying' && failed.nextAttemptAt) {
              const delay = Math.max(0, Date.parse(failed.nextAttemptAt) - runtime.now().getTime());
              if (delay > 0) await sleep(delay);
              continue;
            }
            throw new LiveOperationUnknownError(workflowIssue(
              'operation_retry_exhausted',
              path,
              `operation ${record.taskId} exhausted its retry budget`,
            ));
          }
          if (error instanceof LiveOperationUnknownError) {
            await runtime.wait({
              ...lease,
              reason: error.issue.message,
              code: error.issue.code,
              wakeAt: null,
            });
            throw error;
          }
          await runtime.wait({
            ...lease,
            reason: error instanceof Error ? error.message.slice(0, 300) : 'operation outcome unknown',
            code: 'operation_outcome_unknown',
            wakeAt: null,
          });
          throw new LiveOperationUnknownError(workflowIssue(
            'live_operation_unknown',
            path,
            error instanceof Error ? error.message.slice(0, 300) : 'operation outcome is unknown',
          ));
        }
      }
      throw new LiveOperationUnknownError(workflowIssue(
        'operation_retry_exhausted',
        path,
        `operation ${record.taskId} exhausted its retry budget`,
      ));
    },
  };
}
