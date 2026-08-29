import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  aiGenerations,
  aiWorkflows,
  customerAttributionLocks,
  leadCommissions,
  leadFloorPlans,
  leadLifecycleEvents,
  leadClaimWindows,
  leadOutcomeSnapshots,
  adminUsers,
  measurementAppointments,
  leadSitePhotos,
  staffNotifications,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadCommissionRepository } from '@/db/repositories/lead-commission-repository';
import { httpError } from '@/lib/http-error';
import { shouldSnapshotLeadCommissions } from '@/lib/lead-source';
import { normalizeLeadStatus } from '@/lib/lead-status';

export const REFERRER_WITHDRAWAL_WINDOW_MS = 10 * 60 * 1000;

const IN_FLIGHT_AI_STATUSES = ['created', 'pending', 'processing'];

export interface LeadLifecycleImpact {
  leadId: bigint;
  archived: boolean;
  floorPlanCount: number;
  aiWorkflowCount: number;
  aiGenerationCount: number;
  inFlightAiCount: number;
  followUpCount: number;
  hasConversion: boolean;
  commissionCount: number;
}

function toCountMap(rows: Array<{ leadId: bigint | null; value: number | bigint }>) {
  return new Map(
    rows
      .filter((row): row is { leadId: bigint; value: number | bigint } => row.leadId !== null)
      .map((row) => [row.leadId, Number(row.value)])
  );
}

function impactMetadata(impact: LeadLifecycleImpact): Record<string, unknown> {
  return {
    floorPlanCount: impact.floorPlanCount,
    aiWorkflowCount: impact.aiWorkflowCount,
    aiGenerationCount: impact.aiGenerationCount,
    inFlightAiCount: impact.inFlightAiCount,
    followUpCount: impact.followUpCount,
    hasConversion: impact.hasConversion,
    commissionCount: impact.commissionCount,
  };
}

export class LeadLifecycleRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async lockByIds(ids: bigint[]) {
    if (!ids.length) return [];
    return this.transaction
      .select()
      .from(leads)
      .where(inArray(leads.id, ids))
      .for('update');
  }

  async impacts(ids: bigint[]): Promise<LeadLifecycleImpact[]> {
    if (!ids.length) return [];
    const [leadRows, floorPlanRows, workflowRows, generationRows, inFlightRows, commissionRows, conversionEventRows] = await Promise.all([
      this.transaction.select().from(leads).where(inArray(leads.id, ids)),
      this.transaction
        .select({ leadId: leadFloorPlans.leadId, value: count() })
        .from(leadFloorPlans)
        .where(inArray(leadFloorPlans.leadId, ids))
        .groupBy(leadFloorPlans.leadId),
      this.transaction
        .select({ leadId: aiWorkflows.leadId, value: count() })
        .from(aiWorkflows)
        .where(inArray(aiWorkflows.leadId, ids))
        .groupBy(aiWorkflows.leadId),
      this.transaction
        .select({ leadId: aiGenerations.leadId, value: count() })
        .from(aiGenerations)
        .where(inArray(aiGenerations.leadId, ids))
        .groupBy(aiGenerations.leadId),
      this.transaction
        .select({ leadId: aiGenerations.leadId, value: count() })
        .from(aiGenerations)
        .where(and(
          inArray(aiGenerations.leadId, ids),
          inArray(aiGenerations.status, IN_FLIGHT_AI_STATUSES),
          isNull(aiGenerations.deletedAt)
        ))
        .groupBy(aiGenerations.leadId),
      this.transaction
        .select({ leadId: leadCommissions.leadId, value: count() })
        .from(leadCommissions)
        .where(inArray(leadCommissions.leadId, ids))
        .groupBy(leadCommissions.leadId),
      this.transaction
        .select({ leadId: leadLifecycleEvents.leadRecordId, value: count() })
        .from(leadLifecycleEvents)
        .where(and(
          inArray(leadLifecycleEvents.leadRecordId, ids),
          inArray(leadLifecycleEvents.action, ['converted', 'conversion_reverted'])
        ))
        .groupBy(leadLifecycleEvents.leadRecordId),
    ]);
    const floorPlanMap = toCountMap(floorPlanRows);
    const workflowMap = toCountMap(workflowRows);
    const generationMap = toCountMap(generationRows);
    const inFlightMap = toCountMap(inFlightRows);
    const commissionMap = toCountMap(commissionRows);
    const conversionEventMap = toCountMap(conversionEventRows);
    return leadRows.map((lead) => ({
      leadId: lead.id,
      archived: Boolean(lead.archivedAt),
      floorPlanCount: floorPlanMap.get(lead.id) ?? 0,
      aiWorkflowCount: workflowMap.get(lead.id) ?? 0,
      aiGenerationCount: generationMap.get(lead.id) ?? 0,
      inFlightAiCount: inFlightMap.get(lead.id) ?? 0,
      followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
      hasConversion: Boolean(
        lead.convertedOn ||
        lead.convertedAt ||
        lead.convertedBy ||
        normalizeLeadStatus(lead.status) === 'converted' ||
        (conversionEventMap.get(lead.id) ?? 0) > 0
      ),
      commissionCount: commissionMap.get(lead.id) ?? 0,
    }));
  }

  async archive(input: {
    leadId: bigint;
    actorId: bigint;
    reason: string;
    note?: string | null;
    impact: LeadLifecycleImpact;
  }) {
    const now = new Date();
    const rows = await this.transaction
      .update(leads)
      .set({
        archivedAt: now,
        archivedBy: input.actorId,
        archiveReason: input.reason,
        archiveNote: input.note?.trim() || null,
        updatedAt: now,
      })
      .where(and(eq(leads.id, input.leadId), isNull(leads.archivedAt)))
      .returning();
    if (!rows[0]) return null;
    await this.transaction
      .update(customerAttributionLocks)
      .set({
        releasedAt: now,
        releaseReason: 'lead_archived',
        updatedAt: now,
      })
      .where(
        and(
          eq(customerAttributionLocks.leadId, input.leadId),
          isNull(customerAttributionLocks.releasedAt)
        )
      );
    await this.transaction
      .update(leadClaimWindows)
      .set({
        status: 'cancelled',
        resolvedAt: now,
        resolutionReason: 'lead_archived',
        updatedAt: now,
      })
      .where(and(
        eq(leadClaimWindows.leadId, input.leadId),
        eq(leadClaimWindows.status, 'open')
      ));
    await this.recordEvent(input.leadId, rows[0].enterpriseId, input.actorId, 'archived', input.reason, impactMetadata(input.impact));
    return rows[0];
  }

  async restore(leadId: bigint, actorId: bigint) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), isNotNull(leads.archivedAt)))
      .limit(1);
    if (!current[0]) return null;
    const rows = await this.transaction
      .update(leads)
      .set({
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        archiveNote: null,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, leadId), isNotNull(leads.archivedAt)))
      .returning();
    if (!rows[0]) return null;
    const customerUserId = rows[0].customerUserId;
    if (customerUserId) {
      const active = await this.transaction
        .select({ id: customerAttributionLocks.id })
        .from(customerAttributionLocks)
        .where(
          and(
            eq(customerAttributionLocks.customerUserId, customerUserId),
            isNull(customerAttributionLocks.releasedAt)
          )
        )
        .limit(1);
      if (!active[0]) {
        await this.transaction
          .update(customerAttributionLocks)
          .set({
            releasedAt: null,
            releaseReason: null,
            updatedAt: new Date(),
          })
          .where(eq(customerAttributionLocks.leadId, leadId));
      }
    }
    await this.recordEvent(leadId, rows[0].enterpriseId, actorId, 'restored', current[0].archiveReason, {});
    return rows[0];
  }

  async purge(leadId: bigint, actorId: bigint, impact: LeadLifecycleImpact) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), isNotNull(leads.archivedAt)))
      .limit(1);
    if (!current[0]) return null;
    const rows = await this.transaction
      .delete(leads)
      .where(and(eq(leads.id, leadId), isNotNull(leads.archivedAt)))
      .returning({ id: leads.id, enterpriseId: leads.enterpriseId, archiveReason: leads.archiveReason });
    if (!rows[0]?.enterpriseId) return null;
    await this.recordEvent(leadId, rows[0].enterpriseId, actorId, 'purged', rows[0].archiveReason, impactMetadata(impact));
    return rows[0];
  }

  async convert(input: {
    leadId: bigint;
    actorId: bigint;
    convertedOn: string;
    contractAmount: string | null;
    conversionNote: string | null;
  }) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .for('update')
      .limit(1);
    const lead = current[0];
    if (!lead) return null;
    if (lead.archivedAt) {
      throw Object.assign(httpError('该客户线索已归档，请先恢复后再操作', 409), {
        code: 'LEAD_ARCHIVED',
      });
    }
    const normalized = normalizeLeadStatus(lead.status);
    if (normalized === 'converted') throw httpError('该客户已经标记为已签约', 409);
    if (normalized === 'closed') throw httpError('已关闭线索需要先重新打开', 409);
    if (!['new', 'measuring', 'designing'].includes(normalized)) {
      throw httpError('当前线索状态不能标记为已签约', 409);
    }

    const now = new Date();
    const rows = await this.transaction
      .update(leads)
      .set({
        status: 'converted',
        convertedOn: input.convertedOn,
        convertedAt: now,
        convertedBy: input.actorId,
        convertedFromStatus: lead.status,
        contractAmount: input.contractAmount,
        conversionNote: input.conversionNote,
        updatedAt: now,
      })
      .where(and(
        eq(leads.id, input.leadId),
        eq(leads.status, lead.status),
        isNull(leads.archivedAt)
      ))
      .returning();
    if (!rows[0]) throw httpError('线索状态已变化，请刷新后重试', 409);
    await this.recordEvent(
      input.leadId,
      rows[0].enterpriseId,
      input.actorId,
      'converted',
      null,
      {
        previousStatus: lead.status,
        convertedOn: input.convertedOn,
        contractAmount: input.contractAmount,
      }
    );
    await this.transaction.insert(leadOutcomeSnapshots).values({
      enterpriseId: rows[0].enterpriseId!,
      leadId: input.leadId,
      designerId: lead.assignedTo,
      outcome: 'signed',
      performanceEligible: true,
      previousLeadStatus: lead.status,
      outcomeAt: now,
      recordedByStaffId: input.actorId,
    });
    await this.transaction
      .update(leadClaimWindows)
      .set({
        status: 'cancelled',
        resolvedAt: now,
        resolutionReason: 'lead_closed',
        updatedAt: now,
      })
      .where(and(
        eq(leadClaimWindows.leadId, lead.id),
        eq(leadClaimWindows.status, 'open')
      ));
    if (shouldSnapshotLeadCommissions(rows[0])) {
      await new LeadCommissionRepository(this.transaction).snapshotForConvertedLead(input.leadId);
    }
    return rows[0];
  }

  async revertConversion(input: {
    leadId: bigint;
    actorId: bigint;
    reason: string;
  }) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .for('update')
      .limit(1);
    const lead = current[0];
    if (!lead) return null;
    if (lead.archivedAt) {
      throw Object.assign(httpError('该客户线索已归档，请先恢复后再操作', 409), {
        code: 'LEAD_ARCHIVED',
      });
    }
    if (normalizeLeadStatus(lead.status) !== 'converted') {
      throw httpError('该客户当前不是已签约状态', 409);
    }
    const originalStatus = lead.convertedFromStatus || 'designing';
    const normalizedOriginal = normalizeLeadStatus(originalStatus);
    const restoredStatus = ['new', 'measuring', 'designing'].includes(normalizedOriginal)
      ? originalStatus
      : 'designing';
    const voidedCommissions = await new LeadCommissionRepository(this.transaction)
      .voidUnpaidForRevertedLead(input.leadId, input.actorId, input.reason);
    const now = new Date();
    await this.transaction
      .update(leadOutcomeSnapshots)
      .set({
        invalidatedAt: now,
        invalidatedByStaffId: input.actorId,
        invalidationReason: input.reason,
      })
      .where(and(
        eq(leadOutcomeSnapshots.leadId, input.leadId),
        isNull(leadOutcomeSnapshots.invalidatedAt)
      ));
    const rows = await this.transaction
      .update(leads)
      .set({
        status: restoredStatus,
        convertedOn: null,
        convertedAt: null,
        convertedBy: null,
        convertedFromStatus: null,
        contractAmount: null,
        conversionNote: null,
        updatedAt: now,
      })
      .where(and(
        eq(leads.id, input.leadId),
        eq(leads.status, lead.status),
        isNull(leads.archivedAt)
      ))
      .returning();
    if (!rows[0]) throw httpError('线索状态已变化，请刷新后重试', 409);
    await this.recordEvent(
      input.leadId,
      rows[0].enterpriseId,
      input.actorId,
      'conversion_reverted',
      input.reason,
      {
        restoredStatus,
        convertedOn: lead.convertedOn,
        convertedAt: lead.convertedAt?.toISOString() || null,
        contractAmount: lead.contractAmount,
        voidedCommissionCount: voidedCommissions.length,
        voidedCommissionSnapshots: voidedCommissions.map((commission) => ({
          id: commission.id.toString(),
          role: commission.role,
          beneficiaryUserId: commission.beneficiaryUserId.toString(),
          originalBeneficiaryUserId: commission.originalBeneficiaryUserId.toString(),
          ruleType: commission.ruleType,
          ruleValue: commission.ruleValue,
          ruleVersion: commission.ruleVersion,
          contractAmount: commission.contractAmount,
          payableAmount: commission.payableAmount,
          originalPayableAmount: commission.originalPayableAmount,
          adjustedAt: commission.adjustedAt?.toISOString() || null,
          adjustedBy: commission.adjustedBy?.toString() || null,
          adjustReason: commission.adjustReason,
          createdAt: commission.createdAt.toISOString(),
          voidedAt: commission.voidedAt?.toISOString() || null,
          voidedBy: commission.voidedBy?.toString() || null,
          voidReason: commission.voidReason,
        })),
      }
    );
    return rows[0];
  }

  async closeLost(input: {
    leadId: bigint;
    actorId: bigint;
    reason: string;
    note?: string | null;
    performanceEligible: boolean;
  }) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1)
      .for('update');
    const lead = current[0];
    if (!lead?.enterpriseId) return null;
    if (lead.archivedAt) throw httpError('该客户线索已归档，请先恢复后再操作', 409);
    const normalized = normalizeLeadStatus(lead.status);
    if (normalized === 'closed') throw httpError('该客户线索已经结案', 409);
    if (normalized === 'converted') throw httpError('已签约线索不能标记为未签单结案', 409);
    if (!['new', 'measuring', 'designing'].includes(normalized)) {
      throw httpError('当前线索状态不能结案', 409);
    }
    const now = new Date();
    const rows = await this.transaction
      .update(leads)
      .set({ status: 'closed', updatedAt: now })
      .where(and(eq(leads.id, input.leadId), eq(leads.status, lead.status), isNull(leads.archivedAt)))
      .returning();
    if (!rows[0]) throw httpError('线索状态已变化，请刷新后重试', 409);
    await this.transaction.insert(leadOutcomeSnapshots).values({
      enterpriseId: lead.enterpriseId,
      leadId: lead.id,
      designerId: lead.assignedTo,
      outcome: 'lost',
      performanceEligible: input.performanceEligible,
      lostReason: input.reason,
      note: input.note?.trim() || null,
      previousLeadStatus: lead.status,
      outcomeAt: now,
      recordedByStaffId: input.actorId,
    });
    await this.transaction
      .update(customerAttributionLocks)
      .set({ releasedAt: now, releaseReason: 'lead_closed_lost', updatedAt: now })
      .where(and(
        eq(customerAttributionLocks.leadId, lead.id),
        isNull(customerAttributionLocks.releasedAt)
      ));
    await this.transaction
      .update(leadClaimWindows)
      .set({
        status: 'cancelled',
        resolvedAt: now,
        resolutionReason: 'lead_closed_lost',
        updatedAt: now,
      })
      .where(and(
        eq(leadClaimWindows.leadId, lead.id),
        eq(leadClaimWindows.status, 'open')
      ));
    await this.recordEvent(lead.id, lead.enterpriseId, input.actorId, 'closed_lost', input.reason, {
      previousStatus: lead.status,
      performanceEligible: input.performanceEligible,
      note: input.note?.trim() || null,
      designerId: lead.assignedTo?.toString() || null,
    });
    return rows[0];
  }

  async withdrawByReferrer(input: {
    leadId: bigint;
    userId: bigint;
    membershipId: bigint;
    note?: string | null;
  }) {
    const lead = (await this.transaction.select().from(leads).where(eq(leads.id, input.leadId)).for('update').limit(1))[0];
    if (!lead?.enterpriseId) return null;
    if (lead.referrerMembershipId !== input.membershipId) throw Object.assign(httpError('无权操作该推广记录', 403), { code: 'REFERRER_LEAD_FORBIDDEN' });
    if (lead.source !== 'referrer_network') throw Object.assign(httpError('仅推广线索支持撤销', 409), { code: 'REFERRER_SOURCE_REQUIRED' });
    if (lead.terminationType === 'referrer_withdrawn') return lead;
    if (normalizeLeadStatus(lead.status) !== 'new') throw Object.assign(httpError('该线索已开始服务，不能撤回，请联系企业管理员', 409), { code: 'REFERRER_WITHDRAWAL_BLOCKED' });
    const impact = (await this.impacts([lead.id]))[0];
    const [appointments, photos] = await Promise.all([
      this.transaction.select({ id: measurementAppointments.id }).from(measurementAppointments).where(eq(measurementAppointments.leadId, lead.id)),
      this.transaction.select({ id: leadSitePhotos.id }).from(leadSitePhotos).where(and(eq(leadSitePhotos.leadId, lead.id), isNull(leadSitePhotos.deletedAt))),
    ]);
    if (impact.floorPlanCount || impact.aiWorkflowCount || impact.aiGenerationCount || impact.followUpCount || impact.hasConversion || impact.commissionCount || appointments.length || photos.length) {
      throw Object.assign(httpError('该线索已开始服务，不能撤回，请联系企业管理员', 409), { code: 'REFERRER_WITHDRAWAL_BLOCKED', impact });
    }
    const now = new Date();
    const rows = await this.transaction.update(leads).set({
      status: 'closed',
      terminationType: 'referrer_withdrawn',
      terminatedAt: now,
      terminatedByUserId: input.userId,
      terminatedByReferrerMembershipId: input.membershipId,
      terminationPreviousStatus: lead.status,
      terminationNote: input.note?.trim().slice(0, 300) || null,
      updatedAt: now,
    }).where(and(eq(leads.id, lead.id), eq(leads.status, lead.status), isNull(leads.terminationType))).returning();
    const updated = rows[0];
    if (!updated) throw Object.assign(httpError('线索状态已变化，请刷新后重试', 409), { code: 'REFERRER_WITHDRAWAL_CONFLICT' });
    await this.transaction.update(customerAttributionLocks).set({ releasedAt: now, releaseReason: 'referrer_withdrawn', updatedAt: now }).where(and(eq(customerAttributionLocks.leadId, lead.id), isNull(customerAttributionLocks.releasedAt)));
    await this.transaction.update(leadClaimWindows).set({ status: 'cancelled', resolvedAt: now, resolutionReason: 'referrer_withdrawn', updatedAt: now }).where(and(eq(leadClaimWindows.leadId, lead.id), eq(leadClaimWindows.status, 'open')));
    const recipients = await this.transaction.select({ id: adminUsers.id, role: adminUsers.role }).from(adminUsers).where(and(eq(adminUsers.enterpriseId, lead.enterpriseId), eq(adminUsers.status, 'active'), inArray(adminUsers.role, ['designer', 'measurer', 'enterprise_admin'])));
    const assigned = new Set([lead.assignedTo?.toString(), lead.measurerId?.toString()].filter(Boolean));
    for (const recipient of recipients) {
      if (!assigned.has(recipient.id.toString()) && recipient.role !== 'enterprise_admin') continue;
      await this.transaction.insert(staffNotifications).values({ enterpriseId: lead.enterpriseId, recipientStaffId: recipient.id, leadId: lead.id, notificationType: 'lead_referrer_withdrawn', channel: 'in_app', status: 'unread', message: '推广人已撤销该线索，请停止后续跟进', metadata: { recordCode: lead.referrerRecordCode, terminationType: 'referrer_withdrawn' }, dedupeKey: `lead-referrer-withdrawn:${lead.id}:${recipient.id}` }).onConflictDoNothing();
    }
    await this.recordEvent(lead.id, lead.enterpriseId, null, 'referrer_withdrawn', 'referrer_withdrawn', { previousStatus: lead.status, recordCode: lead.referrerRecordCode, note: updated.terminationNote }, { actorUserId: input.userId, actorReferrerMembershipId: input.membershipId });
    return updated;
  }

  async restoreReferrerWithdrawal(input: { leadId: bigint; userId: bigint; membershipId: bigint }) {
    const lead = (await this.transaction.select().from(leads).where(eq(leads.id, input.leadId)).for('update').limit(1))[0];
    if (!lead?.enterpriseId) return null;
    if (lead.referrerMembershipId !== input.membershipId || lead.terminatedByUserId !== input.userId) throw Object.assign(httpError('无权撤回该操作', 403), { code: 'REFERRER_WITHDRAWAL_FORBIDDEN' });
    if (lead.terminationType !== 'referrer_withdrawn' || !lead.terminatedAt) throw Object.assign(httpError('该线索当前没有可撤回的推广人撤销', 409), { code: 'REFERRER_WITHDRAWAL_NOT_FOUND' });
    if (Date.now() - lead.terminatedAt.getTime() > REFERRER_WITHDRAWAL_WINDOW_MS) throw Object.assign(httpError('撤回窗口已结束，请联系企业管理员', 409), { code: 'REFERRER_WITHDRAWAL_EXPIRED' });
    if (lead.customerUserId) {
      const active = (await this.transaction.select().from(customerAttributionLocks).where(and(eq(customerAttributionLocks.customerUserId, lead.customerUserId), isNull(customerAttributionLocks.releasedAt))).for('update').limit(1))[0];
      if (active && active.leadId !== lead.id) throw Object.assign(httpError('客户已通过其他服务码建立新归属，请联系企业管理员', 409), { code: 'REFERRER_WITHDRAWAL_ATTRIBUTION_CONFLICT' });
    }
    const now = new Date();
    const restoredStatus = lead.terminationPreviousStatus || 'new';
    const rows = await this.transaction.update(leads).set({ status: restoredStatus, terminationType: null, terminatedAt: null, terminatedByUserId: null, terminatedByReferrerMembershipId: null, terminationPreviousStatus: null, terminationNote: null, assignmentStatus: lead.assignedTo ? 'assigned' : 'assignment_pending', updatedAt: now }).where(and(eq(leads.id, lead.id), eq(leads.status, 'closed'), eq(leads.terminationType, 'referrer_withdrawn'))).returning();
    if (!rows[0]) throw Object.assign(httpError('线索状态已变化，请刷新后重试', 409), { code: 'REFERRER_WITHDRAWAL_CONFLICT' });
    if (lead.customerUserId) {
      const lock = (await this.transaction.select({ id: customerAttributionLocks.id }).from(customerAttributionLocks).where(eq(customerAttributionLocks.leadId, lead.id)).orderBy(desc(customerAttributionLocks.id)).limit(1).for('update'))[0];
      if (lock) await this.transaction.update(customerAttributionLocks).set({ releasedAt: null, releaseReason: null, updatedAt: now }).where(eq(customerAttributionLocks.id, lock.id));
      else await this.transaction.insert(customerAttributionLocks).values({ enterpriseId: lead.enterpriseId, customerUserId: lead.customerUserId, leadId: lead.id, referrerMembershipId: lead.referrerMembershipId, lockedAt: now });
    }
    const recipients = await this.transaction.select({ id: adminUsers.id, role: adminUsers.role }).from(adminUsers).where(and(
      eq(adminUsers.enterpriseId, lead.enterpriseId),
      eq(adminUsers.status, 'active'),
      inArray(adminUsers.role, ['designer', 'measurer', 'enterprise_admin'])
    ));
    const assigned = new Set([lead.assignedTo?.toString(), lead.measurerId?.toString()].filter(Boolean));
    for (const recipient of recipients) {
      if (!assigned.has(recipient.id.toString()) && recipient.role !== 'enterprise_admin') continue;
      await this.transaction.insert(staffNotifications).values({
        enterpriseId: lead.enterpriseId,
        recipientStaffId: recipient.id,
        leadId: lead.id,
        notificationType: 'lead_referrer_withdrawal_reverted',
        channel: 'in_app',
        status: 'unread',
        message: '推广人已撤回撤销，可继续跟进该线索',
        metadata: { recordCode: lead.referrerRecordCode, terminationType: 'referrer_withdrawn' },
        dedupeKey: `lead-referrer-withdrawal-reverted:${lead.id}:${recipient.id}:${lead.terminatedAt.toISOString()}`,
      }).onConflictDoNothing();
    }
    await this.recordEvent(lead.id, lead.enterpriseId, null, 'referrer_withdrawal_reverted', null, { restoredStatus }, { actorUserId: input.userId, actorReferrerMembershipId: input.membershipId });
    return rows[0];
  }

  async reopenLost(input: { leadId: bigint; actorId: bigint; reason?: string | null }) {
    const current = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1)
      .for('update');
    const lead = current[0];
    if (!lead?.enterpriseId) return null;
    if (lead.archivedAt) throw httpError('该客户线索已归档，请先恢复后再操作', 409);
    if (normalizeLeadStatus(lead.status) !== 'closed') throw httpError('只有已结案线索可以重新激活', 409);
    if (lead.terminationType === 'referrer_withdrawn') {
      const now = new Date();
      const restoredStatus = lead.terminationPreviousStatus || 'new';
      const rows = await this.transaction.update(leads).set({
        status: restoredStatus,
        terminationType: null,
        terminatedAt: null,
        terminatedByUserId: null,
        terminatedByReferrerMembershipId: null,
        terminationPreviousStatus: null,
        terminationNote: null,
        assignmentStatus: lead.assignedTo ? 'assigned' : 'assignment_pending',
        updatedAt: now,
      }).where(and(eq(leads.id, lead.id), eq(leads.status, 'closed'), eq(leads.terminationType, 'referrer_withdrawn'))).returning();
      if (!rows[0]) throw httpError('线索状态已变化，请刷新后重试', 409);
      if (lead.customerUserId) {
        const lock = (await this.transaction.select({ id: customerAttributionLocks.id }).from(customerAttributionLocks).where(eq(customerAttributionLocks.leadId, lead.id)).orderBy(desc(customerAttributionLocks.id)).limit(1).for('update'))[0];
        if (lock) await this.transaction.update(customerAttributionLocks).set({ releasedAt: null, releaseReason: null, updatedAt: now }).where(eq(customerAttributionLocks.id, lock.id));
      }
      await this.recordEvent(lead.id, lead.enterpriseId, input.actorId, 'reopened', input.reason?.trim() || 'admin_referrer_withdrawal_restore', { restoredStatus, terminationType: 'referrer_withdrawn' });
      return rows[0];
    }
    const snapshots = await this.transaction
      .select()
      .from(leadOutcomeSnapshots)
      .where(and(
        eq(leadOutcomeSnapshots.leadId, lead.id),
        eq(leadOutcomeSnapshots.outcome, 'lost'),
        isNull(leadOutcomeSnapshots.invalidatedAt)
      ))
      .orderBy(desc(leadOutcomeSnapshots.id))
      .limit(1)
      .for('update');
    const snapshot = snapshots[0];
    if (!snapshot) throw httpError('找不到可恢复的结案记录', 409);
    if (lead.customerUserId) {
      const active = await this.transaction
        .select()
        .from(customerAttributionLocks)
        .where(and(
          eq(customerAttributionLocks.customerUserId, lead.customerUserId),
          isNull(customerAttributionLocks.releasedAt)
        ))
        .limit(1)
        .for('update');
      if (active[0] && active[0].leadId !== lead.id) {
        throw Object.assign(httpError('客户已建立其他活动归属，无法重新激活', 409), {
          code: 'customer_attribution_conflict',
        });
      }
    }
    const restoredStatus = ['new', 'measuring', 'designing'].includes(normalizeLeadStatus(snapshot.previousLeadStatus))
      ? snapshot.previousLeadStatus
      : 'new';
    const now = new Date();
    const rows = await this.transaction
      .update(leads)
      .set({
        status: restoredStatus,
        assignmentStatus: lead.assignedTo ? lead.assignmentStatus : 'assignment_pending',
        assignmentErrorCode: lead.assignedTo ? lead.assignmentErrorCode : 'designer_unavailable',
        updatedAt: now,
      })
      .where(and(eq(leads.id, lead.id), eq(leads.status, lead.status)))
      .returning();
    if (!rows[0]) throw httpError('线索状态已变化，请刷新后重试', 409);
    await this.transaction
      .update(leadOutcomeSnapshots)
      .set({
        invalidatedAt: now,
        invalidatedByStaffId: input.actorId,
        invalidationReason: input.reason?.trim() || 'lead_reopened',
      })
      .where(eq(leadOutcomeSnapshots.id, snapshot.id));
    if (lead.customerUserId) {
      const releasedLocks = await this.transaction
        .select({ id: customerAttributionLocks.id })
        .from(customerAttributionLocks)
        .where(eq(customerAttributionLocks.leadId, lead.id))
        .orderBy(desc(customerAttributionLocks.id))
        .limit(1)
        .for('update');
      if (releasedLocks[0]) {
        await this.transaction
          .update(customerAttributionLocks)
          .set({ releasedAt: null, releaseReason: null, updatedAt: now })
          .where(eq(customerAttributionLocks.id, releasedLocks[0].id));
      } else {
        await this.transaction.insert(customerAttributionLocks).values({
          enterpriseId: lead.enterpriseId,
          customerUserId: lead.customerUserId,
          leadId: lead.id,
          referrerMembershipId: lead.referrerMembershipId,
          lockedAt: now,
        });
      }
    }
    await this.recordEvent(lead.id, lead.enterpriseId, input.actorId, 'reopened', input.reason?.trim() || null, {
      restoredStatus,
      invalidatedOutcomeSnapshotId: snapshot.id.toString(),
    });
    return rows[0];
  }

  private async recordEvent(
    leadId: bigint,
    enterpriseId: bigint | null,
    actorId: bigint | null,
    action: string,
    reason: string | null,
    metadata: Record<string, unknown>,
    actors?: { actorUserId?: bigint | null; actorReferrerMembershipId?: bigint | null }
  ) {
    if (!enterpriseId) return;
    await this.transaction.insert(leadLifecycleEvents).values({
      enterpriseId,
      leadRecordId: leadId,
      actorId,
      actorUserId: actors?.actorUserId ?? null,
      actorReferrerMembershipId: actors?.actorReferrerMembershipId ?? null,
      action,
      reason,
      metadata,
    });
  }
}
