import { AssignmentRacingRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { notifyDesignerOfAssignedLead, notifyEnterpriseAdminOfAssignmentPending } from '@/lib/wechat-notification';

let health = {
  lastStartedAt: null as string | null,
  lastSucceededAt: null as string | null,
  lastFailedAt: null as string | null,
  lastError: null as string | null,
  lastResult: null as { scanned: number; assigned: number; pending: number } | null,
};

export function getLeadClaimWorkerHealth() {
  return { ...health };
}

export async function processExpiredLeadClaimWindows(limit = 100) {
  health = { ...health, lastStartedAt: new Date().toISOString() };
  try {
    const results = await withPlatformTransaction(async (transaction) => {
      const repository = new AssignmentRacingRepository(transaction);
      const windows = await repository.listDueWindows(limit);
      const processed = [];
      for (const window of windows) {
        const result = await repository.autoAssignLead({
          leadId: window.leadId,
          settingVersionId: window.settingVersionId,
          claimWindowId: window.id,
          reason: 'claim_window_expired',
        });
        processed.push({ windowId: window.id, result });
      }
      return processed;
    });

    await Promise.allSettled(results.map(async ({ windowId, result }) => {
      if (!('lead' in result) || !result.lead) return;
      const lead = result.lead;
      const notificationLead = { ...lead, enterpriseId: lead.enterpriseId?.toString() };
      if (lead.assignedTo) {
        await notifyDesignerOfAssignedLead(notificationLead, lead.assignedTo.toString());
      }
      if (result.kind === 'pending') {
        await notifyEnterpriseAdminOfAssignmentPending(notificationLead, {
          reasonCode: lead.assignmentErrorCode || 'designer_unavailable',
          eventKey: `claim-worker:${windowId.toString()}`,
        });
      }
    }));
    const summary = {
      scanned: results.length,
      assigned: results.filter((item) => item.result.kind === 'assigned').length,
      pending: results.filter((item) => item.result.kind === 'pending').length,
    };
    health = { ...health, lastSucceededAt: new Date().toISOString(), lastError: null, lastResult: summary };
    return summary;
  } catch (error) {
    health = {
      ...health,
      lastFailedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : 'unknown worker error',
    };
    throw error;
  }
}
