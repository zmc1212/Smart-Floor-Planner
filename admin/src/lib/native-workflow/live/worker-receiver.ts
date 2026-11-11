import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod, type FixedPeriod } from './period-event';
import { writeProjectAccess, type ProjectAccess, type ProjectLock } from './project-access';

/** Host-owned worker receiver evidence returned to the CLI. */
export interface WorkerReceiverEvidence {
  readonly adminId: string;
  readonly adminRole: string;
  readonly memberRole: string;
  readonly accessRole: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly principalKey: string;
  readonly scopeKey: string;
  readonly projectId: string | null;
  readonly status: string;
}

export interface PrepareWorkerPeriodReportOptions {
  readonly enterpriseId: string;
  readonly actor: ConstructionActor;
  readonly projectId: string;
  readonly workerId: string;
  readonly event: TriggerEvent;
}

export interface PrepareWorkerPeriodReportResult {
  readonly period: FixedPeriod;
  readonly worker: WorkerReceiverEvidence;
}

/** Offline seams; production always uses the real authorization/binding code. */
export interface WorkerReceiverDependencies {
  /** Test seam for the trusted clock; defaults to `new Date()` per prepare. */
  readonly now?: () => Date;
  readonly transaction?: <T>(
    enterpriseId: bigint | number | string,
    callback: (tx: PostgresTransaction) => Promise<T>,
  ) => Promise<T>;
  readonly authorizeWrite?: (
    tx: PostgresTransaction,
    actor: ConstructionActor,
    projectId: string,
    lock: ProjectLock,
  ) => Promise<ProjectAccess>;
  readonly ensureBinding?: typeof ensureFollowupBinding;
}

function workerUnavailable(message: string, details: Record<string, unknown> = {}): never {
  throw new WorkflowOperationError('worker_receiver_unavailable', 422, message, details);
}

/**
 * Validate the fixed period, then authorize the management executor before the
 * worker receiver can create anything.
 *
 * Order is load-bearing:
 *   1. trusted-clock period-end check (no database work),
 *   2. tenant transaction,
 *   3. real project write authorization (project row lock first),
 *   4. existing staff admin/member/followup-access checks,
 *   5. the shared enterprise-scoped worker binding last.
 *
 * A rejected actor or an ended-period violation therefore cannot leave a
 * conversation/binding/participant behind.
 */
export async function prepareWorkerPeriodReport(
  options: PrepareWorkerPeriodReportOptions,
  dependencies: WorkerReceiverDependencies = {},
): Promise<PrepareWorkerPeriodReportResult> {
  const now = dependencies.now ?? (() => new Date());
  const period = parseFixedPeriod(options.event, now());

  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = dependencies.authorizeWrite ?? writeProjectAccess;
  const ensureBinding = dependencies.ensureBinding ?? ensureFollowupBinding;
  const { enterpriseId, actor, projectId, workerId } = options;

  const worker = await transaction(enterpriseId, async (tx) => {
    // The executor's management access is re-checked first; this locks the
    // project row before any staff query or binding write.
    await authorizeWrite(tx, actor, projectId, 'update');

    const admin = await one(tx, sql`select id,role,status,must_change_password
      from app.admin_users where enterprise_id=${enterpriseId} and id=${workerId} for share`);
    if (!admin) {
      workerUnavailable(`worker admin ${workerId} was not found in enterprise ${enterpriseId}`);
    }
    if (String(admin.status) !== 'active' || String(admin.role) !== 'construction_staff' || admin.must_change_password !== false) {
      workerUnavailable(
        `worker admin ${workerId} must be an active construction_staff account without a required password change`,
        {
          admin: {
            status: admin.status,
            role: admin.role,
            mustChangePassword: admin.must_change_password,
          },
        },
      );
    }

    const member = await one(tx, sql`select role,active from app.construction_members
      where enterprise_id=${enterpriseId} and project_id=${projectId} and admin_id=${workerId} for share`);
    if (!member || member.active !== true || String(member.role) === 'observer') {
      workerUnavailable(
        `worker admin ${workerId} needs an active non-observer member row on project ${projectId}`,
        { member: member ?? null },
      );
    }

    const access = await one(tx, sql`select app.construction_followup_staff_access(
      ${workerId}::bigint,${enterpriseId}::bigint) as role`);
    if (!access?.role) {
      workerUnavailable(`worker admin ${workerId} has no current staff followup access in enterprise ${enterpriseId}`);
    }

    // Only the existing enterprise-scoped worker binding is allowed. A
    // project-scoped worker binding would violate the binding contract.
    const binding: Row = await ensureBinding(tx, enterpriseId, {
      kind: 'admin',
      id: workerId,
      audience: 'worker',
    });
    return {
      adminId: workerId,
      adminRole: String(admin.role),
      memberRole: String(member.role),
      accessRole: String(access.role),
      bindingId: String(binding.id),
      conversationId: String(binding.conversation_id),
      principalKey: String(binding.principal_key),
      scopeKey: String(binding.scope_key),
      projectId: binding.project_id === null ? null : String(binding.project_id),
      status: String(binding.status),
    };
  });

  return { period, worker };
}
