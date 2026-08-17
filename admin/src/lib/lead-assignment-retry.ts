import { eq } from 'drizzle-orm';
import { ReferralLeadRepository } from '@/db/repositories';
import { leads } from '@/db/schema';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  notifyDesignerOfAssignedLead,
  notifyEnterpriseAdminOfAssignmentPending,
} from '@/lib/wechat-notification';

type RetryResult = NonNullable<
  Awaited<ReturnType<ReferralLeadRepository['retryLeadAssignment']>>
>;

async function deliverRetryNotifications(result: RetryResult) {
  if (result.kind === 'already_assigned') return;
  const notificationLead = {
    ...result.lead,
    enterpriseId: result.lead.enterpriseId?.toString(),
  };
  const eventKey = result.eventId
    ? `retry:${result.eventId.toString()}`
    : `retry:${result.lead.id.toString()}`;
  await Promise.allSettled([
    result.kind === 'assigned' && result.lead.assignedTo
      ? notifyDesignerOfAssignedLead(
          notificationLead,
          result.lead.assignedTo.toString()
        )
      : Promise.resolve(),
    result.kind === 'pending'
      ? notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
          reasonCode:
            result.lead.assignmentErrorCode || 'assignment_retry_pending',
          eventKey,
        })
      : Promise.resolve(),
  ]);
}

export async function retrySingleLeadAssignment(input: {
  leadId: bigint;
  reason: string;
}) {
  const scope = await withPlatformTransaction(async (transaction) => {
    const rows = await transaction
      .select({ enterpriseId: leads.enterpriseId })
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!scope?.enterpriseId) return null;
  const result = await withTenantTransaction(scope.enterpriseId, (transaction) =>
    new ReferralLeadRepository(transaction).retryLeadAssignment(input)
  );
  if (result) await deliverRetryNotifications(result);
  return result;
}

export async function retryPendingLeadAssignmentsForEnterprise(input: {
  enterpriseId: bigint;
  reason: string;
  limit?: number;
}) {
  const results = await withTenantTransaction(
    input.enterpriseId,
    (transaction) =>
      new ReferralLeadRepository(transaction).retryPendingAssignments({
        reason: input.reason,
        limit: input.limit,
      })
  );
  await Promise.allSettled(results.map(deliverRetryNotifications));
  return results;
}
