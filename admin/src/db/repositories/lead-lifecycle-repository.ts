import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  aiGenerations,
  aiWorkflows,
  leadAcquisitionCommissions,
  leadFloorPlans,
  leadLifecycleEvents,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

const IN_FLIGHT_AI_STATUSES = ['created', 'pending', 'processing'];

export interface LeadLifecycleImpact {
  leadId: bigint;
  archived: boolean;
  floorPlanCount: number;
  aiWorkflowCount: number;
  aiGenerationCount: number;
  inFlightAiCount: number;
  followUpCount: number;
  hasAcquisition: boolean;
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
    hasAcquisition: impact.hasAcquisition,
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
    const [leadRows, floorPlanRows, workflowRows, generationRows, inFlightRows, commissionRows] = await Promise.all([
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
        .select({ leadId: leadAcquisitionCommissions.leadId, value: count() })
        .from(leadAcquisitionCommissions)
        .where(inArray(leadAcquisitionCommissions.leadId, ids))
        .groupBy(leadAcquisitionCommissions.leadId),
    ]);
    const floorPlanMap = toCountMap(floorPlanRows);
    const workflowMap = toCountMap(workflowRows);
    const generationMap = toCountMap(generationRows);
    const inFlightMap = toCountMap(inFlightRows);
    const commissionMap = toCountMap(commissionRows);
    return leadRows.map((lead) => ({
      leadId: lead.id,
      archived: Boolean(lead.archivedAt),
      floorPlanCount: floorPlanMap.get(lead.id) ?? 0,
      aiWorkflowCount: workflowMap.get(lead.id) ?? 0,
      aiGenerationCount: generationMap.get(lead.id) ?? 0,
      inFlightAiCount: inFlightMap.get(lead.id) ?? 0,
      followUpCount: Array.isArray(lead.followUpRecords) ? lead.followUpRecords.length : 0,
      hasAcquisition: Boolean(lead.acquiredAt || lead.acquiredBy),
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
