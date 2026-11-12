import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod, type FixedPeriod } from './period-event';
import { writeProjectAccess, type ProjectAccess, type ProjectLock } from './project-access';

/** Staff receivers reuse one enterprise-scoped binding and one project scope. */
export type StaffReceiverKind = 'worker' | 'designer';

const ADMIN_ROLE: Readonly<Record<StaffReceiverKind, string>> = {
  worker: 'construction_staff',
  designer: 'designer',
};

/** Host-owned staff receiver evidence returned to the CLI. */
export interface StaffReceiverEvidence {
  readonly receiverKind: StaffReceiverKind;
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

export interface PrepareStaffPeriodReportOptions {
  readonly enterpriseId: string;
  readonly actor: ConstructionActor;
  readonly projectId: string;
  readonly receiverKind: StaffReceiverKind;
  readonly adminId: string;
  readonly event: TriggerEvent;
}

export interface PrepareStaffPeriodReportResult {
  readonly period: FixedPeriod;
  readonly staff: StaffReceiverEvidence;
}

/** Offline seams; production always uses the real authorization/binding code. */
export interface StaffReceiverDependencies {
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

function receiverUnavailable(
  kind: StaffReceiverKind,
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new WorkflowOperationError(`${kind}_receiver_unavailable`, 422, message, details);
}

/**
 * Validate the fixed period, then authorize the management executor before the
 * staff receiver can create anything.
 *
 * Order is load-bearing:
 *   1. trusted-clock period-end check (no database work),
 *   2. tenant transaction,
 *   3. real project write authorization (project row lock first),
 *   4. existing staff admin/member/followup-access checks,
 *   5. the shared enterprise-scoped staff binding last.
 *
 * A rejected actor, a wrong staff role or an ended-period violation therefore
 * cannot leave a conversation/binding/participant behind.
 */
export async function prepareStaffPeriodReport(
  options: PrepareStaffPeriodReportOptions,
  dependencies: StaffReceiverDependencies = {},
): Promise<PrepareStaffPeriodReportResult> {
  const now = dependencies.now ?? (() => new Date());
  const period = parseFixedPeriod(options.event, now());

  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = dependencies.authorizeWrite ?? writeProjectAccess;
  const ensureBinding = dependencies.ensureBinding ?? ensureFollowupBinding;
  const { enterpriseId, actor, projectId, adminId, receiverKind } = options;
  const expectedRole = ADMIN_ROLE[receiverKind];

  const staff = await transaction(enterpriseId, async (tx) => {
    // The executor's management access is re-checked first; this locks the
    // project row before any staff query or binding write.
    await authorizeWrite(tx, actor, projectId, 'update');

    const admin = await one(tx, sql`select id,role,status,must_change_password
      from app.admin_users where enterprise_id=${enterpriseId} and id=${adminId} for share`);
    if (!admin) {
      receiverUnavailable(
        receiverKind,
        `${receiverKind} admin ${adminId} was not found in enterprise ${enterpriseId}`,
      );
    }
    if (String(admin.status) !== 'active' || String(admin.role) !== expectedRole || admin.must_change_password !== false) {
      receiverUnavailable(
        receiverKind,
        `${receiverKind} admin ${adminId} must be an active ${expectedRole} account without a required password change`,
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
      where enterprise_id=${enterpriseId} and project_id=${projectId} and admin_id=${adminId} for share`);
    if (!member || member.active !== true || String(member.role) === 'observer') {
      receiverUnavailable(
        receiverKind,
        `${receiverKind} admin ${adminId} needs an active non-observer member row on project ${projectId}`,
        { member: member ?? null },
      );
    }

    const access = await one(tx, sql`select app.construction_followup_staff_access(
      ${adminId}::bigint,${enterpriseId}::bigint) as role`);
    if (!access?.role) {
      receiverUnavailable(
        receiverKind,
        `${receiverKind} admin ${adminId} has no current staff followup access in enterprise ${enterpriseId}`,
      );
    }

    // Only the existing enterprise-scoped staff binding is allowed. A
    // project-scoped staff binding would violate the binding contract.
    const binding: Row = await ensureBinding(tx, enterpriseId, {
      kind: 'admin',
      id: adminId,
      audience: receiverKind,
    });
    return {
      receiverKind,
      adminId,
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

  return { period, staff };
}
