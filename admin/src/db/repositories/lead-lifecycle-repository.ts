import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  aiGenerations,
  aiWorkflows,
  leadCommissions,
  leadFloorPlans,
  leadLifecycleEvents,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadCommissionRepository } from '@/db/repositories/lead-commission-repository';
import { httpError } from '@/lib/http-error';
import { normalizeLeadStatus } from '@/lib/lead-status';

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
    if (rows[0].referrerMembershipId || rows[0].measurerId) {
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
    const voidedCommissionCount = await new LeadCommissionRepository(this.transaction)
      .voidUnpaidForRevertedLead(input.leadId, input.actorId, input.reason);
    const now = new Date();
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
        voidedCommissionCount,
      }
    );
    return rows[0];
  }

  private async recordEvent(
    leadId: bigint,
    enterpriseId: bigint | null,
    actorId: bigint,
    action: string,
    reason: string | null,
    metadata: Record<string, unknown>
  ) {
    if (!enterpriseId) return;
    await this.transaction.insert(leadLifecycleEvents).values({
      enterpriseId,
      leadRecordId: leadId,
      actorId,
      action,
      reason,
      metadata,
    });
  }
}
