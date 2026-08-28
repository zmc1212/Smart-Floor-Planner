import {
  AdminUserRepository,
  EnterpriseRepository,
  MiniProgramIdentityRepository,
  type EnterpriseStatusEventRecord,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { ensureEnterpriseAdminForActiveEnterprise } from '@/lib/enterprise-admin-provision';
import { EnterpriseStatusTransitionError } from '@/lib/enterprise-status';
import { notifyEnterpriseContactOfJoinResult } from '@/lib/wechat-notification';

export type ApplyEnterpriseStatusChangeInput = {
  enterpriseId: bigint;
  action: unknown;
  reason?: unknown;
  actorAdminId: bigint;
  statusEventLimit?: number;
};

export type ApplyEnterpriseStatusChangeResult = {
  applied: NonNullable<
    Awaited<ReturnType<EnterpriseRepository['applyStatusAction']>>
  >;
  statusEvents: EnterpriseStatusEventRecord[];
};

/**
 * Shared mutation path for Web `POST /api/admin/enterprises/[id]/status`
 * and Mini Program platform review. Owns the platform transaction, owner
 * provision on `active`, and best-effort join-result notify after commit.
 */
export function enterpriseJoinNotifyResult(
  action: string
): 'approved' | 'rejected' | null {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  return null;
}

export function enterpriseStatusChangeHttpStatus(error: unknown) {
  if (error instanceof EnterpriseStatusTransitionError) return 400;
  const details = error as { code?: string };
  if (details.code === '23505' || details.code === 'ACCOUNT_CONFLICT') {
    return 400;
  }
  return 500;
}

export function enterpriseStatusChangeErrorResponse(error: unknown) {
  const status = enterpriseStatusChangeHttpStatus(error);
  if (error instanceof EnterpriseStatusTransitionError) {
    return {
      status,
      body: {
        success: false as const,
        error: error.message,
        code: error.code,
      },
    };
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    status,
    body: { success: false as const, error: message },
  };
}

function dispatchEnterpriseJoinResultNotification(
  result: ApplyEnterpriseStatusChangeResult
) {
  const notifyResult = enterpriseJoinNotifyResult(
    result.applied.transition.action
  );
  if (!notifyResult) return;

  const enterprise = result.applied.enterprise;
  void notifyEnterpriseContactOfJoinResult({
    enterpriseName: enterprise.name,
    contactPerson: enterprise.contactPerson as {
      name?: unknown;
      phone?: unknown;
    } | null,
    appliedAt: enterprise.createdAt,
    result: notifyResult,
  }).catch((error) => {
    console.error('Enterprise join result notification dispatch failed:', error);
  });
}

export async function applyEnterpriseStatusChange(
  input: ApplyEnterpriseStatusChangeInput
): Promise<ApplyEnterpriseStatusChangeResult | null> {
  const result = await withPlatformTransaction(async (transaction) => {
    const enterprises = new EnterpriseRepository(transaction);
    const applied = await enterprises.applyStatusAction({
      enterpriseId: input.enterpriseId,
      action: input.action as string,
      reason: input.reason,
      actorAdminId: input.actorAdminId,
    });
    if (!applied) return null;

    if (applied.transition.toStatus === 'active') {
      await ensureEnterpriseAdminForActiveEnterprise(
        new AdminUserRepository(transaction),
        applied.enterprise,
        new MiniProgramIdentityRepository(transaction)
      );
    }

    const statusEvents = await enterprises.listStatusEvents(
      input.enterpriseId,
      input.statusEventLimit ?? 20
    );
    return { applied, statusEvents };
  });

  if (result) {
    dispatchEnterpriseJoinResultNotification(result);
  }
  return result;
}
