/** Enterprise boss (owner) receiver preparation for one period report.
 *
 * The boss is the existing enterprise owner contract, not a project staff
 * member: the receiver must be the enterprise's own active `enterprise_admin`
 * account whose `construction_followup_staff_access` role is `owner`. Platform
 * `admin`/`super_admin` accounts may also be owners, but they may only join a
 * follow-up themselves, so this host path rejects them before any binding.
 * There is no `construction_members` requirement and `customer_access` is
 * never read here.
 *
 * Order is load-bearing and matches the staff path:
 *   1. trusted-clock period-end check (no database work),
 *   2. tenant transaction,
 *   3. real project write authorization by the management executor (project row
 *      lock first),
 *   4. existing owner/followup permission check for the boss receiver,
 *   5. the shared enterprise-scoped boss binding last.
 *
 * A rejected executor, role or period therefore cannot leave a conversation,
 * binding or participant behind.
 */

import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { ensureFollowupBinding } from '@/lib/construction/report-store';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import { parseFixedPeriod, type FixedPeriod } from './period-event';
import { writeProjectAccess, type ProjectAccess, type ProjectLock } from './project-access';

/** Host-owned boss receiver evidence returned to the CLI. */
export interface BossReceiverEvidence {
  readonly receiverKind: 'boss';
  readonly adminId: string;
  readonly adminRole: string;
  readonly accessRole: 'owner';
  /** Boss binds through the existing enterprise owner rule, never a member row. */
  readonly memberRequired: false;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly principalKey: string;
  readonly scopeKey: string;
  readonly projectId: string | null;
  readonly status: string;
}

export interface PrepareBossPeriodReportOptions {
  readonly enterpriseId: string;
  readonly actor: ConstructionActor;
  readonly projectId: string;
  readonly adminId: string;
  readonly event: TriggerEvent;
}

export interface PrepareBossPeriodReportResult {
  readonly period: FixedPeriod;
  readonly boss: BossReceiverEvidence;
}

/** Offline seams; production always uses the real authorization/binding code. */
export interface BossReceiverDependencies {
  readonly writeGuard?: import('./types').RuntimeWriteGuard;
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

function bossUnavailable(message: string, details: Record<string, unknown> = {}): never {
  throw new WorkflowOperationError('boss_receiver_unavailable', 422, message, details);
}

export async function prepareBossPeriodReport(
  options: PrepareBossPeriodReportOptions,
  dependencies: BossReceiverDependencies = {},
): Promise<PrepareBossPeriodReportResult> {
  const now = dependencies.now ?? (() => new Date());
  const period = parseFixedPeriod(options.event, now());

  const transaction = dependencies.transaction ?? withTenantTransaction;
  const authorizeWrite = dependencies.authorizeWrite ?? writeProjectAccess;
  const ensureBinding = dependencies.ensureBinding ?? ensureFollowupBinding;
  const { enterpriseId, actor, projectId, adminId } = options;

  const boss = await transaction(enterpriseId, async (tx) => {
    await dependencies.writeGuard?.(tx);
    // The executor's management access is checked first; this locks the project
    // row before any receiver query or binding write.
    await authorizeWrite(tx, actor, projectId, 'update');

    const admin = await one(tx, sql`select id,role,status,must_change_password
      from app.admin_users where enterprise_id=${enterpriseId} and id=${adminId} for share`);
    if (!admin) {
      bossUnavailable(`boss admin ${adminId} was not found in enterprise ${enterpriseId}`);
    }
    if (String(admin.status) !== 'active' || admin.must_change_password !== false) {
      bossUnavailable(
        `boss admin ${adminId} must be an active account without a required password change`,
        {
          admin: {
            status: admin.status,
            role: admin.role,
            mustChangePassword: admin.must_change_password,
          },
        },
      );
    }
    // The native boss receiver is limited to the enterprise's own owner
    // account. `construction_actor_access` also returns owner for platform
    // `admin`/`super_admin` accounts, but those accounts may only join a
    // follow-up themselves; this host path must never create one for them.
    if (String(admin.role) !== 'enterprise_admin') {
      bossUnavailable(
        `boss admin ${adminId} must be an enterprise_admin account; ${String(admin.role)} is not allowed for the native boss receiver`,
        {
          admin: {
            status: admin.status,
            role: admin.role,
            mustChangePassword: admin.must_change_password,
          },
        },
      );
    }

    // The existing owner/followup rule is the receiver permission. A project
    // member role is not enough, and no member row is required for the owner.
    const access = await one(tx, sql`select app.construction_followup_staff_access(
      ${adminId}::bigint,${enterpriseId}::bigint) as role`);
    if (String(access?.role) !== 'owner') {
      bossUnavailable(
        `boss admin ${adminId} does not have the current enterprise owner followup role`,
        { accessRole: access?.role ?? null },
      );
    }

    // Only the shared enterprise-scoped boss binding is allowed.
    const binding: Row = await ensureBinding(tx, enterpriseId, {
      kind: 'admin',
      id: adminId,
      audience: 'boss',
    });
    return {
      receiverKind: 'boss' as const,
      adminId,
      adminRole: String(admin.role),
      accessRole: 'owner' as const,
      memberRequired: false as const,
      bindingId: String(binding.id),
      conversationId: String(binding.conversation_id),
      principalKey: String(binding.principal_key),
      scopeKey: String(binding.scope_key),
      projectId: binding.project_id === null ? null : String(binding.project_id),
      status: String(binding.status),
    };
  });

  return { period, boss };
}
