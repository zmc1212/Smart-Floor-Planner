import { parsePostgresId } from '@/db/postgres-dto';
import type { LeadWithRelations } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext, type TenantContext } from '@/lib/auth';
import { canAccessLeadForStaffAssign } from '@/lib/lead-assignment-actions';
import { resolveMiniProgramContext, type MiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

export type LeadAssignmentRequestContext =
  | {
      kind: 'mini';
      mini: MiniProgramContext;
      role: string;
      actorStaffId: bigint | null;
      actorUserId: bigint | null;
    }
  | {
      kind: 'admin';
      admin: TenantContext;
      role: string;
      actorStaffId: bigint | null;
      actorUserId: null;
    };

export async function resolveLeadAssignmentRequest(
  request: Request
): Promise<LeadAssignmentRequestContext | null> {
  const mini = await resolveMiniProgramContext(request);
  if (mini) {
    return {
      kind: 'mini',
      mini,
      role: mini.staff?.role || '',
      actorStaffId: mini.staff?._id
        ? parsePostgresId(mini.staff._id, 'staff id')
        : null,
      actorUserId: parsePostgresId(mini.user._id, 'user id'),
    };
  }
  const admin = await getTenantContext(request);
  if (!admin) return null;
  return {
    kind: 'admin',
    admin,
    role: admin.role,
    actorStaffId: admin.userId ? parsePostgresId(admin.userId, 'userId') : null,
    actorUserId: null,
  };
}

export function withLeadAssignmentTransaction<T>(
  context: LeadAssignmentRequestContext,
  callback: (transaction: PostgresTransaction) => Promise<T>
) {
  return context.kind === 'mini'
    ? withMiniProgramPostgresTransaction(context.mini, callback)
    : withAdminPostgresTransaction(context.admin, callback);
}

export function canAccessAssignedLead(
  lead: Pick<LeadWithRelations, 'assignedTo' | 'measurerId'>,
  context: LeadAssignmentRequestContext
) {
  return canAccessLeadForStaffAssign(lead, context.role, context.actorStaffId);
}
