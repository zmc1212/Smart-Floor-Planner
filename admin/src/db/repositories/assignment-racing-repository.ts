import { createHash } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  adminUsers,
  assignmentDistributionCounters,
  enterpriseAssignmentSettingVersions,
  leadAssignmentEvents,
  leadClaimWindows,
  leadOutcomeSnapshots,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadRepository } from './lead-repository';

export const DEFAULT_ASSIGNMENT_SETTINGS = {
  claimEnabled: false,
  claimDurationSeconds: 60,
  highPerformanceTrafficPercent: 70,
  performanceRateThresholdPercent: 30,
  performanceWindowDays: 180,
  minimumEffectiveSamples: 10,
  defaultDesignerCapacity: 20,
} as const;

export const NORMAL_LOST_REASONS = [
  'chose_other_company',
  'budget_mismatch',
  'renovation_cancelled_or_delayed',
  'no_intent',
  'long_term_unreachable',
  'other',
] as const;

export const INVALID_LOST_REASONS = [
  'invalid_contact',
  'duplicate',
  'mistaken_entry',
] as const;

type SettingRow = typeof enterpriseAssignmentSettingVersions.$inferSelect;

function assignmentError(code: string, message: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function capacityFor(
  staff: Pick<typeof adminUsers.$inferSelect, 'leadCapacityOverride'>,
  setting: SettingRow
) {
  return staff.leadCapacityOverride ?? setting.defaultDesignerCapacity;
}

function settingsSnapshot(setting: SettingRow) {
  return {
    version: setting.version,
    claimEnabled: setting.claimEnabled,
    claimDurationSeconds: setting.claimDurationSeconds,
    highPerformanceTrafficPercent: setting.highPerformanceTrafficPercent,
    performanceRateThresholdPercent: setting.performanceRateThresholdPercent,
    performanceWindowDays: setting.performanceWindowDays,
    minimumEffectiveSamples: setting.minimumEffectiveSamples,
    defaultDesignerCapacity: setting.defaultDesignerCapacity,
  };
}

export function hashClaimIdempotencyKey(value: string) {
  return createHash('sha256').update(value.trim()).digest('hex');
}

export function chooseDeterministicAssignmentGroup(input: {
  highCount: number;
  standardCount: number;
  highTargetPercent: number;
}) {
  const totalAfter = input.highCount + input.standardCount + 1;
  const target = input.highTargetPercent / 100;
  const highDelta = Math.abs((input.highCount + 1) / totalAfter - target);
  const standardDelta = Math.abs(input.highCount / totalAfter - target);
  return highDelta <= standardDelta ? 'high' as const : 'standard' as const;
}

export class AssignmentRacingRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async lockEnterprise(enterpriseId: bigint) {
    await this.transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`assignment-racing:${enterpriseId.toString()}`}, 0))`
    );
  }

  async getCurrentSettings(enterpriseId: bigint, createIfMissing = true) {
    const rows = await this.transaction
      .select()
      .from(enterpriseAssignmentSettingVersions)
      .where(eq(enterpriseAssignmentSettingVersions.enterpriseId, enterpriseId))
      .orderBy(desc(enterpriseAssignmentSettingVersions.version), desc(enterpriseAssignmentSettingVersions.id))
      .limit(1);
    if (rows[0] || !createIfMissing) return rows[0] ?? null;
    await this.lockEnterprise(enterpriseId);
    const current = await this.transaction
      .select()
      .from(enterpriseAssignmentSettingVersions)
      .where(eq(enterpriseAssignmentSettingVersions.enterpriseId, enterpriseId))
      .orderBy(desc(enterpriseAssignmentSettingVersions.version))
      .limit(1);
    if (current[0]) return current[0];
    const inserted = await this.transaction
      .insert(enterpriseAssignmentSettingVersions)
      .values({ enterpriseId, version: 1, ...DEFAULT_ASSIGNMENT_SETTINGS })
      .returning();
    return inserted[0];
  }

  async createSettingsVersion(input: {
    enterpriseId: bigint;
    actorStaffId: bigint | null;
    claimEnabled: boolean;
    claimDurationSeconds: number;
    highPerformanceTrafficPercent: number;
    performanceRateThresholdPercent: number;
    performanceWindowDays: number;
    minimumEffectiveSamples: number;
    defaultDesignerCapacity: number;
  }) {
    await this.lockEnterprise(input.enterpriseId);
    const current = await this.getCurrentSettings(input.enterpriseId);
    const inserted = await this.transaction
      .insert(enterpriseAssignmentSettingVersions)
      .values({
        enterpriseId: input.enterpriseId,
        version: (current?.version ?? 0) + 1,
        claimEnabled: input.claimEnabled,
        claimDurationSeconds: input.claimDurationSeconds,
        highPerformanceTrafficPercent: input.highPerformanceTrafficPercent,
        performanceRateThresholdPercent: input.performanceRateThresholdPercent,
        performanceWindowDays: input.performanceWindowDays,
        minimumEffectiveSamples: input.minimumEffectiveSamples,
        defaultDesignerCapacity: input.defaultDesignerCapacity,
        createdByStaffId: input.actorStaffId,
      })
      .returning();
    return inserted[0];
  }

  async openClaimWindow(input: {
    leadId: bigint;
    enterpriseId: bigint;
    setting: SettingRow;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.setting.claimDurationSeconds * 1000);
    const rows = await this.transaction
      .insert(leadClaimWindows)
      .values({
        enterpriseId: input.enterpriseId,
        leadId: input.leadId,
        settingVersionId: input.setting.id,
        opensAt: now,
        expiresAt,
        status: 'open',
        ruleSnapshot: settingsSnapshot(input.setting),
      })
      .returning();
    await this.transaction
      .update(leads)
      .set({
        assignedTo: null,
        assignedAt: null,
        assignmentStatus: 'claim_open',
        assignmentErrorCode: null,
        updatedAt: now,
      })
      .where(eq(leads.id, input.leadId));
    await this.transaction.insert(leadAssignmentEvents).values({
      enterpriseId: input.enterpriseId,
      leadId: input.leadId,
      eventType: 'claim_opened',
      reason: 'claim_window_enabled',
      metadata: {
        claimWindowId: rows[0]?.id.toString(),
        expiresAt: expiresAt.toISOString(),
        settings: settingsSnapshot(input.setting),
      },
    });
    return rows[0];
  }

  async listDesignerPerformance(enterpriseId: bigint, setting?: SettingRow) {
    const activeSetting = setting ?? await this.getCurrentSettings(enterpriseId);
    if (!activeSetting) return [];
    const since = new Date(Date.now() - activeSetting.performanceWindowDays * 24 * 60 * 60 * 1000);
    const staffRows = await this.transaction
      .select()
      .from(adminUsers)
      .where(and(
        eq(adminUsers.enterpriseId, enterpriseId),
        eq(adminUsers.role, 'designer'),
        eq(adminUsers.status, 'active')
      ))
      .orderBy(asc(adminUsers.displayName), asc(adminUsers.id));
    const loadRows = await this.transaction
      .select({
        designerId: leads.assignedTo,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(and(
        eq(leads.enterpriseId, enterpriseId),
        isNotNull(leads.assignedTo),
        isNull(leads.archivedAt),
        notInArray(leads.status, ['converted', 'closed'])
      ))
      .groupBy(leads.assignedTo);
    const outcomeRows = await this.transaction
      .select({
        designerId: leadOutcomeSnapshots.designerId,
        effectiveSamples: sql<number>`count(*)::int`,
        signedCount: sql<number>`count(*) filter (where ${leadOutcomeSnapshots.outcome} = 'signed')::int`,
      })
      .from(leadOutcomeSnapshots)
      .where(and(
        eq(leadOutcomeSnapshots.enterpriseId, enterpriseId),
        isNull(leadOutcomeSnapshots.invalidatedAt),
        eq(leadOutcomeSnapshots.performanceEligible, true),
        gte(leadOutcomeSnapshots.outcomeAt, since)
      ))
      .groupBy(leadOutcomeSnapshots.designerId);
    const loadsByDesigner = new Map(
      loadRows.flatMap((row) => row.designerId === null ? [] : [[row.designerId.toString(), Number(row.count || 0)] as const])
    );
    const outcomesByDesigner = new Map(
      outcomeRows.flatMap((row) => row.designerId === null ? [] : [[row.designerId.toString(), row] as const])
    );
    return staffRows.map((staff) => {
      const outcome = outcomesByDesigner.get(staff.id.toString());
      const samples = Number(outcome?.effectiveSamples || 0);
      const signed = Number(outcome?.signedCount || 0);
      const signingRate = samples ? signed / samples : 0;
      const openLeadCount = loadsByDesigner.get(staff.id.toString()) ?? 0;
      const capacity = capacityFor(staff, activeSetting);
      const eligibleForAssignment = !staff.assignmentPaused
        && Boolean(staff.wechatId?.trim())
        && Boolean(staff.wechatQrAssetId)
        && openLeadCount < capacity;
      const group = samples >= activeSetting.minimumEffectiveSamples
        && signingRate * 100 >= activeSetting.performanceRateThresholdPercent
        ? 'high' as const
        : 'standard' as const;
      return {
        staff,
        openLeadCount,
        effectiveSamples: samples,
        signedCount: signed,
        signingRate,
        capacity,
        group,
        eligibleForAssignment,
      };
    });
  }

  private async getDistributionCounter(enterpriseId: bigint, settingVersionId: bigint) {
    await this.transaction
      .insert(assignmentDistributionCounters)
      .values({ enterpriseId, settingVersionId })
      .onConflictDoNothing({
        target: [assignmentDistributionCounters.enterpriseId, assignmentDistributionCounters.settingVersionId],
      });
    const rows = await this.transaction
      .select()
      .from(assignmentDistributionCounters)
      .where(and(
        eq(assignmentDistributionCounters.enterpriseId, enterpriseId),
        eq(assignmentDistributionCounters.settingVersionId, settingVersionId)
      ))
      .limit(1)
      .for('update');
    return rows[0]!;
  }

  async autoAssignLead(input: {
    leadId: bigint;
    reason: string;
    settingVersionId?: bigint | null;
    claimWindowId?: bigint | null;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const leadRows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1)
      .for('update');
    const lead = leadRows[0];
    if (!lead?.enterpriseId) return { kind: 'not_found' as const };
    if (lead.assignedTo) {
      return { kind: 'already_assigned' as const, lead: await new LeadRepository(this.transaction).findById(lead.id) };
    }
    if (lead.archivedAt || ['closed', 'converted'].includes(lead.status)) {
      if (input.claimWindowId) {
        await this.transaction
          .update(leadClaimWindows)
          .set({
            status: 'cancelled',
            resolvedAt: now,
            resolutionReason: lead.archivedAt ? 'lead_archived' : `lead_${lead.status}`,
            updatedAt: now,
          })
          .where(eq(leadClaimWindows.id, input.claimWindowId));
      }
      return { kind: 'not_assignable' as const };
    }
    await this.lockEnterprise(lead.enterpriseId);
    let setting: SettingRow | null = null;
    if (input.settingVersionId) {
      const settings = await this.transaction
        .select()
        .from(enterpriseAssignmentSettingVersions)
        .where(and(
          eq(enterpriseAssignmentSettingVersions.id, input.settingVersionId),
          eq(enterpriseAssignmentSettingVersions.enterpriseId, lead.enterpriseId)
        ))
        .limit(1);
      setting = settings[0] ?? null;
    }
    setting ??= await this.getCurrentSettings(lead.enterpriseId);
    if (!setting) throw assignmentError('assignment_settings_missing', '派单规则不可用', 500);

    const performance = await this.listDesignerPerformance(lead.enterpriseId, setting);
    const eligible = performance.filter((item) => item.eligibleForAssignment);
    const high = eligible.filter((item) => item.group === 'high');
    const standard = eligible.filter((item) => item.group === 'standard');
    const counter = await this.getDistributionCounter(lead.enterpriseId, setting.id);
    const preferredGroup = chooseDeterministicAssignmentGroup({
      highCount: counter.highCount,
      standardCount: counter.standardCount,
      highTargetPercent: setting.highPerformanceTrafficPercent,
    });
    let selectedGroup = preferredGroup;
    let fallbackReason: string | null = null;
    let candidates = preferredGroup === 'high' ? high : standard;
    if (!candidates.length) {
      const fallback = preferredGroup === 'high' ? standard : high;
      if (fallback.length) {
        selectedGroup = preferredGroup === 'high' ? 'standard' : 'high';
        candidates = fallback;
        fallbackReason = preferredGroup === 'high'
          ? 'high_group_empty_or_at_capacity'
          : 'standard_group_empty_or_at_capacity';
      }
    }
    candidates.sort((a, b) =>
      a.openLeadCount - b.openLeadCount
      || (a.staff.lastAssignedAt?.getTime() ?? 0) - (b.staff.lastAssignedAt?.getTime() ?? 0)
      || Number(a.staff.id - b.staff.id)
    );
    const selected = candidates[0];
    if (!selected) {
      await this.transaction
        .update(leads)
        .set({ assignmentStatus: 'assignment_pending', assignmentErrorCode: 'designer_unavailable', updatedAt: now })
        .where(eq(leads.id, lead.id));
      if (input.claimWindowId) {
        await this.transaction
          .update(leadClaimWindows)
          .set({ status: 'assignment_pending', resolvedAt: now, resolutionReason: 'designer_unavailable', updatedAt: now })
          .where(eq(leadClaimWindows.id, input.claimWindowId));
      }
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId: lead.enterpriseId,
        leadId: lead.id,
        eventType: 'assignment_pending',
        previousMeasurerId: lead.measurerId,
        measurerId: lead.measurerId,
        errorCode: 'designer_unavailable',
        reason: input.reason,
        metadata: { preferredGroup, fallbackReason: 'all_designers_unavailable', settings: settingsSnapshot(setting) },
      });
      return { kind: 'pending' as const, lead: await new LeadRepository(this.transaction).findById(lead.id) };
    }

    const assignmentErrorCode = lead.measurerId ? null : 'measurer_unavailable';
    await this.transaction
      .update(leads)
      .set({
        assignedTo: selected.staff.id,
        assignedAt: now,
        assignmentStatus: assignmentErrorCode ? 'assignment_pending' : 'assigned',
        assignmentErrorCode,
        updatedAt: now,
      })
      .where(eq(leads.id, lead.id));
    await this.transaction
      .update(adminUsers)
      .set({ lastAssignedAt: now, updatedAt: now })
      .where(eq(adminUsers.id, selected.staff.id));
    await this.transaction
      .update(assignmentDistributionCounters)
      .set({
        highCount: selectedGroup === 'high' ? counter.highCount + 1 : counter.highCount,
        standardCount: selectedGroup === 'standard' ? counter.standardCount + 1 : counter.standardCount,
        updatedAt: now,
      })
      .where(eq(assignmentDistributionCounters.id, counter.id));
    if (input.claimWindowId) {
      await this.transaction
        .update(leadClaimWindows)
        .set({
          status: assignmentErrorCode ? 'assignment_pending' : 'auto_assigned',
          resolvedAt: now,
          resolutionReason: input.reason,
          assignmentGroup: selectedGroup,
          updatedAt: now,
        })
        .where(eq(leadClaimWindows.id, input.claimWindowId));
    }
    const events = await this.transaction
      .insert(leadAssignmentEvents)
      .values({
        enterpriseId: lead.enterpriseId,
        leadId: lead.id,
        eventType: assignmentErrorCode ? 'assignment_auto_pending' : 'assignment_auto',
        designerId: selected.staff.id,
        previousMeasurerId: lead.measurerId,
        measurerId: lead.measurerId,
        errorCode: assignmentErrorCode,
        reason: input.reason,
        metadata: {
          group: selectedGroup,
          preferredGroup,
          fallbackReason,
          effectiveSamples: selected.effectiveSamples,
          signingRate: selected.signingRate,
          openLeadCountBefore: selected.openLeadCount,
          capacity: selected.capacity,
          settings: settingsSnapshot(setting),
        },
      })
      .returning({ id: leadAssignmentEvents.id });
    return {
      kind: assignmentErrorCode ? 'pending' as const : 'assigned' as const,
      lead: await new LeadRepository(this.transaction).findById(lead.id),
      eventId: events[0]?.id,
      group: selectedGroup,
      fallbackReason,
    };
  }

  async claimLead(input: {
    leadId: bigint;
    designerId: bigint;
    actorUserId: bigint | null;
    idempotencyKeyHash: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const rows = await this.transaction
      .select({ window: leadClaimWindows, lead: leads })
      .from(leadClaimWindows)
      .innerJoin(leads, eq(leadClaimWindows.leadId, leads.id))
      .where(eq(leadClaimWindows.leadId, input.leadId))
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row) return { kind: 'not_found' as const };
    if (row.window.status === 'claimed' && row.window.claimedByStaffId === input.designerId) {
      return { kind: 'claimed' as const, idempotent: true, lead: await new LeadRepository(this.transaction).findById(input.leadId) };
    }
    if (row.lead.archivedAt || ['closed', 'converted'].includes(row.lead.status)) {
      if (row.window.status === 'open') {
        await this.transaction
          .update(leadClaimWindows)
          .set({
            status: 'cancelled',
            resolvedAt: now,
            resolutionReason: row.lead.archivedAt ? 'lead_archived' : `lead_${row.lead.status}`,
            updatedAt: now,
          })
          .where(eq(leadClaimWindows.id, row.window.id));
      }
      return { kind: 'not_assignable' as const };
    }
    if (row.window.status !== 'open' || row.lead.assignedTo) {
      return { kind: 'already_claimed' as const };
    }
    if (now.getTime() >= row.window.expiresAt.getTime()) {
      const resolved = await this.autoAssignLead({
        leadId: input.leadId,
        settingVersionId: row.window.settingVersionId,
        claimWindowId: row.window.id,
        reason: 'claim_api_deadline_fallback',
        now,
      });
      return { kind: 'expired' as const, resolved };
    }
    const settingRows = await this.transaction
      .select()
      .from(enterpriseAssignmentSettingVersions)
      .where(eq(enterpriseAssignmentSettingVersions.id, row.window.settingVersionId))
      .limit(1);
    const setting = settingRows[0];
    if (!setting) throw assignmentError('assignment_settings_missing', '派单规则不可用', 500);
    const performance = await this.listDesignerPerformance(row.window.enterpriseId, setting);
    const designer = performance.find((item) => item.staff.id === input.designerId);
    if (!designer || !designer.eligibleForAssignment) {
      throw assignmentError(
        'designer_unavailable',
        designer && designer.openLeadCount >= designer.capacity
          ? '当前在手线索已达容量上限'
          : '当前家装设计顾问不可抢单',
        409
      );
    }
    const assignmentErrorCode = row.lead.measurerId ? null : 'measurer_unavailable';
    await this.transaction
      .update(leadClaimWindows)
      .set({
        status: 'claimed',
        claimedByStaffId: input.designerId,
        claimedAt: now,
        claimIdempotencyKeyHash: input.idempotencyKeyHash,
        resolvedAt: now,
        resolutionReason: 'designer_claimed',
        updatedAt: now,
      })
      .where(eq(leadClaimWindows.id, row.window.id));
    await this.transaction
      .update(leads)
      .set({
        assignedTo: input.designerId,
        assignedAt: now,
        assignmentStatus: assignmentErrorCode ? 'assignment_pending' : 'assigned',
        assignmentErrorCode,
        updatedAt: now,
      })
      .where(eq(leads.id, input.leadId));
    await this.transaction
      .update(adminUsers)
      .set({ lastAssignedAt: now, updatedAt: now })
      .where(eq(adminUsers.id, input.designerId));
    const events = await this.transaction
      .insert(leadAssignmentEvents)
      .values({
        enterpriseId: row.window.enterpriseId,
        leadId: input.leadId,
        eventType: 'claim_succeeded',
        designerId: input.designerId,
        measurerId: row.lead.measurerId,
        actorUserId: input.actorUserId,
        errorCode: assignmentErrorCode,
        reason: 'designer_claimed',
        metadata: { claimWindowId: row.window.id.toString() },
      })
      .returning({ id: leadAssignmentEvents.id });
    return {
      kind: 'claimed' as const,
      idempotent: false,
      lead: await new LeadRepository(this.transaction).findById(input.leadId),
      eventId: events[0]?.id,
    };
  }

  async listClaimPool(input: { enterpriseId: bigint; managerView?: boolean }) {
    const now = new Date();
    const where = input.managerView
      ? and(
          eq(leadClaimWindows.enterpriseId, input.enterpriseId),
          gte(leadClaimWindows.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
        )
      : and(
          eq(leadClaimWindows.enterpriseId, input.enterpriseId),
          eq(leadClaimWindows.status, 'open'),
          gte(leadClaimWindows.expiresAt, now),
          isNull(leads.archivedAt),
          notInArray(leads.status, ['closed', 'converted'])
        );
    return this.transaction
      .select({ window: leadClaimWindows, lead: leads })
      .from(leadClaimWindows)
      .innerJoin(leads, eq(leadClaimWindows.leadId, leads.id))
      .where(where)
      .orderBy(asc(leadClaimWindows.expiresAt), asc(leadClaimWindows.id));
  }

  async listDistribution(enterpriseId: bigint, settingVersionId: bigint) {
    const rows = await this.transaction
      .select()
      .from(assignmentDistributionCounters)
      .where(and(
        eq(assignmentDistributionCounters.enterpriseId, enterpriseId),
        eq(assignmentDistributionCounters.settingVersionId, settingVersionId)
      ))
      .limit(1);
    return rows[0] ?? { highCount: 0, standardCount: 0 };
  }

  async closeOpenWindowForManualAssignment(leadId: bigint, now = new Date()) {
    await this.transaction
      .update(leadClaimWindows)
      .set({ status: 'manually_assigned', resolvedAt: now, resolutionReason: 'manager_assignment', updatedAt: now })
      .where(and(eq(leadClaimWindows.leadId, leadId), eq(leadClaimWindows.status, 'open')));
  }

  async listDueWindows(limit = 100) {
    const now = new Date();
    return this.transaction
      .select()
      .from(leadClaimWindows)
      .where(and(eq(leadClaimWindows.status, 'open'), sql`${leadClaimWindows.expiresAt} <= ${now}`))
      .orderBy(asc(leadClaimWindows.expiresAt), asc(leadClaimWindows.id))
      .limit(Math.min(Math.max(limit, 1), 500))
      .for('update', { skipLocked: true });
  }
}
