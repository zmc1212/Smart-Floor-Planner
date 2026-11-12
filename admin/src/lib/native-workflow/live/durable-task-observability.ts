/** Redacted observability payload for durable tasks.
 *
 * Logs carry tenant/task identity, lifecycle state, attempt and retry counts,
 * the manual-queue flag and the last error code only. The delegated
 * conversation/message/run ids, business key, payload, step outputs, business
 * effect evidence and compensation authorization are never included, so one
 * tenant's log line cannot leak another tenant's data.
 */

import type { DurableTaskRecord } from './durable-task-types';

export interface DurableTaskTracePayload {
  readonly tenantId: string;
  readonly taskId: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly retryCount: number;
  readonly manual: boolean;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nextAttemptAt: string | null;
  readonly finishedAt: string | null;
}

export function durableTaskTracePayload(record: DurableTaskRecord): DurableTaskTracePayload {
  return {
    tenantId: record.enterpriseId,
    taskId: record.taskId,
    kind: record.kind,
    status: record.status,
    attempts: record.attempts.length,
    retryCount: Math.max(0, record.attempts.length - 1),
    manual: Boolean(record.manual),
    failureCode: record.lastError?.code ?? record.manual?.code ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nextAttemptAt: record.nextAttemptAt,
    finishedAt: record.finishedAt,
  };
}
