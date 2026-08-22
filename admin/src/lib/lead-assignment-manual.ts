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

type ManualAssignResult = NonNullable<
  Awaited<ReturnType<ReferralLeadRepository['assignStaff']>>
>;

async function deliverManualAssignNotifications(
  result: ManualAssignResult,
  input: { designerId?: bigint | null; measurerId?: bigint | null }
) {
  const notificationLead = {
    ...result.lead,
    enterpriseId: result.lead.enterpriseId?.toString(),
  };
  const eventKey = result.eventId
    ? `manual:${result.eventId.toString()}`
    : `manual:${result.lead.id.toString()}`;
  const notifyIds = new Set<string>();
  if (input.designerId) notifyIds.add(input.designerId.toString());
  if (input.measurerId) notifyIds.add(input.measurerId.toString());

  await Promise.allSettled([
    ...Array.from(notifyIds).map((staffId) =>
      notifyDesignerOfAssignedLead(notificationLead, staffId)
    ),
    result.kind === 'pending'
      ? notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
          reasonCode:
            result.lead.assignmentErrorCode || 'assignment_manual_pending',
          eventKey,
        })
      : Promise.resolve(),
  ]);
}

export async function assignLeadStaff(input: {
  leadId: bigint;
  actorStaffId?: bigint | null;
  designerId?: bigint | null;
  measurerId?: bigint | null;
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
    new ReferralLeadRepository(transaction).assignStaff(input)
  );
  if (result) {
    await deliverManualAssignNotifications(result, input);
  }
  return result;
}
