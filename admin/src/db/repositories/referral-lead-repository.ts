import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import {
  adminUsers,
  customerAttributionLocks,
  leadAssignmentEvents,
  leads,
  referrerEnterpriseMemberships,
  referrerPromotionCodes,
  staffActivityCodes,
  users,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadRepository, type LeadWithRelations } from './lead-repository';

export interface ReferralPendingSourceRecord {
  kind?: 'referrer';
  promotionCodeId: bigint;
  membershipId: bigint;
  version: number;
  expired?: boolean;
}

export interface StaffActivityPendingSourceRecord {
  kind: 'staff_activity';
  activityCodeId: bigint;
  staffId: bigint;
  enterpriseId: bigint;
  version: number;
  expired?: boolean;
}

export type ClaimPendingSourceRecord =
  | ReferralPendingSourceRecord
  | StaffActivityPendingSourceRecord;

export type ReferralLeadClaimResult = {
  kind: 'created' | 'idempotent' | 'existing_attribution';
  lead: LeadWithRelations;
};

export type ReferralAssignmentRetryResult =
  | {
      kind: 'assigned' | 'already_assigned';
      lead: LeadWithRelations;
      eventId?: bigint;
    }
  | { kind: 'pending'; lead: LeadWithRelations; eventId?: bigint };

function referralError(code: string, message: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export class ReferralLeadRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async lockKey(key: string) {
    await this.transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private async findCustomerForUpdate(customerUserId: bigint) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.id, customerUserId))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  private async findLeadByIdempotency(
    customerUserId: bigint,
    idempotencyKeyHash: string
  ) {
    const rows = await this.transaction
      .select({ leadId: leadAssignmentEvents.leadId })
      .from(leadAssignmentEvents)
      .where(
        and(
          eq(leadAssignmentEvents.actorUserId, customerUserId),
          sql`${leadAssignmentEvents.metadata}->>'authorizationIdempotencyKeyHash' = ${idempotencyKeyHash}`
        )
      )
      .orderBy(desc(leadAssignmentEvents.id))
      .limit(1);
    if (!rows[0]) return null;
    return (await new LeadRepository(this.transaction).findById(rows[0].leadId)) ?? null;
  }

  private async findActiveAttribution(customerUserId: bigint) {
    const rows = await this.transaction
      .select({ lock: customerAttributionLocks, lead: leads })
      .from(customerAttributionLocks)
      .innerJoin(leads, eq(customerAttributionLocks.leadId, leads.id))
      .where(
        and(
          eq(customerAttributionLocks.customerUserId, customerUserId),
          isNull(customerAttributionLocks.releasedAt),
          isNull(leads.archivedAt)
        )
      )
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  async findActiveCustomerAttribution(customerUserId: bigint) {
    const rows = await this.transaction
      .select({ lock: customerAttributionLocks, lead: leads })
      .from(customerAttributionLocks)
      .innerJoin(leads, eq(customerAttributionLocks.leadId, leads.id))
      .where(
        and(
          eq(customerAttributionLocks.customerUserId, customerUserId),
          isNull(customerAttributionLocks.releasedAt),
          isNull(leads.archivedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async releaseInactiveAttributionLocks(customerUserId: bigint) {
    const now = new Date();
    const stale = await this.transaction
      .select({ id: customerAttributionLocks.id })
      .from(customerAttributionLocks)
      .innerJoin(leads, eq(customerAttributionLocks.leadId, leads.id))
      .where(
        and(
          eq(customerAttributionLocks.customerUserId, customerUserId),
          isNull(customerAttributionLocks.releasedAt),
          or(isNotNull(leads.archivedAt), eq(leads.status, 'closed'))
        )
      );
    if (!stale.length) return;
    await this.transaction
      .update(customerAttributionLocks)
      .set({
        releasedAt: now,
        releaseReason: 'lead_inactive',
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            customerAttributionLocks.id,
            stale.map((row) => row.id)
          ),
          isNull(customerAttributionLocks.releasedAt)
        )
      );
  }

  private async validateSource(source: ReferralPendingSourceRecord) {
    const rows = await this.transaction
      .select({
        code: referrerPromotionCodes,
        membership: referrerEnterpriseMemberships,
      })
      .from(referrerPromotionCodes)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerPromotionCodes.membershipId, referrerEnterpriseMemberships.id)
      )
      .where(
        and(
          eq(referrerPromotionCodes.id, source.promotionCodeId),
          eq(referrerPromotionCodes.version, source.version),
          eq(referrerPromotionCodes.status, 'active'),
          eq(referrerEnterpriseMemberships.id, source.membershipId),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      )
      .limit(1)
      .for('share');
    return rows[0] ?? null;
  }

  private async validateStaffActivitySource(source: StaffActivityPendingSourceRecord) {
    const rows = await this.transaction
      .select({
        code: staffActivityCodes,
        staff: adminUsers,
      })
      .from(staffActivityCodes)
      .innerJoin(adminUsers, eq(staffActivityCodes.staffId, adminUsers.id))
      .where(
        and(
          eq(staffActivityCodes.id, source.activityCodeId),
          eq(staffActivityCodes.version, source.version),
          eq(staffActivityCodes.status, 'active'),
          eq(staffActivityCodes.staffId, source.staffId),
          eq(staffActivityCodes.enterpriseId, source.enterpriseId),
          eq(adminUsers.id, source.staffId),
          eq(adminUsers.status, 'active')
        )
      )
      .limit(1)
      .for('share');
    const row = rows[0];
    if (!row || !['designer', 'measurer'].includes(row.staff.role)) return null;
    return row;
  }

  private async findAssignedStaff(staffId: bigint | null, enterpriseId: bigint) {
    if (!staffId) return null;
    const rows = await this.transaction
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.id, staffId),
          eq(adminUsers.enterpriseId, enterpriseId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findDesignerCandidate(enterpriseId: bigint) {
    const openLeadCount = sql<number>`(
      select count(*)::int
      from app.leads assignment_load
      where assignment_load.assigned_to = ${adminUsers.id}
        and assignment_load.archived_at is null
        and assignment_load.status <> 'closed'
    )`;
    const rows = await this.transaction
      .select({ staff: adminUsers, openLeadCount })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.enterpriseId, enterpriseId),
          eq(adminUsers.role, 'designer'),
          eq(adminUsers.status, 'active'),
          eq(adminUsers.assignmentPaused, false),
          isNotNull(adminUsers.wechatId),
          sql`btrim(${adminUsers.wechatId}) <> ''`,
          isNotNull(adminUsers.wechatQrAssetId),
          sql`exists (
            select 1
            from app.media_assets assignment_qr
            where assignment_qr.id = ${adminUsers.wechatQrAssetId}
              and assignment_qr.enterprise_id = ${enterpriseId}
              and assignment_qr.deleted_at is null
          )`
        )
      )
      .orderBy(
        asc(openLeadCount),
        sql`${adminUsers.lastAssignedAt} asc nulls first`,
        asc(adminUsers.id)
      )
      .limit(1);
    return rows[0]?.staff ?? null;
  }

  private async findMeasurerCandidate(enterpriseId: bigint) {
    const pendingTaskCount = sql<number>`(
      select count(*)::int
      from app.leads measurement_load
      where measurement_load.measurer_id = ${adminUsers.id}
        and measurement_load.archived_at is null
        and measurement_load.status in ('new', 'measuring')
    )`;
    const occupiedMinutes = sql<number>`(
      select coalesce(sum(extract(epoch from (upper(time_range) - lower(time_range))) / 60), 0)::int
      from app.measurement_appointments appointment_load
      where appointment_load.measurer_id = ${adminUsers.id}
        and appointment_load.status = 'confirmed'
        and upper(appointment_load.time_range) > now()
    )`;
    const rows = await this.transaction
      .select({ staff: adminUsers, pendingTaskCount, occupiedMinutes })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.enterpriseId, enterpriseId),
          eq(adminUsers.role, 'measurer'),
          eq(adminUsers.status, 'active'),
          eq(adminUsers.assignmentPaused, false)
        )
      )
      .orderBy(
        asc(pendingTaskCount),
        asc(occupiedMinutes),
        sql`${adminUsers.lastAssignedAt} asc nulls first`,
        asc(adminUsers.id)
      )
      .limit(1);
    return rows[0]?.staff ?? null;
  }

  private async findEligibleStaff(
    staffId: bigint | null,
    role: 'designer' | 'measurer',
    enterpriseId: bigint
  ) {
    if (!staffId) return null;
    const rows = await this.transaction
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.id, staffId),
          eq(adminUsers.enterpriseId, enterpriseId),
          eq(adminUsers.role, role),
          eq(adminUsers.status, 'active'),
          eq(adminUsers.assignmentPaused, false),
          ...(role === 'designer'
            ? [
                isNotNull(adminUsers.wechatId),
                sql`btrim(${adminUsers.wechatId}) <> ''`,
                isNotNull(adminUsers.wechatQrAssetId),
                sql`exists (
                  select 1
                  from app.media_assets assignment_qr
                  where assignment_qr.id = ${adminUsers.wechatQrAssetId}
                    and assignment_qr.enterprise_id = ${enterpriseId}
                    and assignment_qr.deleted_at is null
                )`,
              ]
            : [])
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findEligibleActivityPresenter(
    staffId: bigint | null,
    enterpriseId: bigint
  ) {
    if (!staffId) return null;
    const rows = await this.transaction
      .select()
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.id, staffId),
          eq(adminUsers.enterpriseId, enterpriseId),
          eq(adminUsers.status, 'active'),
          eq(adminUsers.assignmentPaused, false),
          sql`${adminUsers.role} in ('designer', 'measurer')`
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private assignmentErrorCode(
    designer: typeof adminUsers.$inferSelect | null,
    measurer: typeof adminUsers.$inferSelect | null
  ) {
    if (designer && measurer) return null;
    if (!designer && !measurer) return 'designer_and_measurer_unavailable';
    return designer ? 'measurer_unavailable' : 'designer_unavailable';
  }

  private async loadLead(leadId: bigint) {
    const lead = await new LeadRepository(this.transaction).findById(leadId);
    if (!lead) throw referralError('lead_not_found', '线索不存在', 404);
    return lead;
  }

  async authorizeAndCreateLead(input: {
    source: ClaimPendingSourceRecord;
    customerUserId: bigint;
    idempotencyKeyHash: string;
    name?: string | null;
    communityName?: string | null;
    city?: string | null;
    stylePreference?: string | null;
  }): Promise<ReferralLeadClaimResult> {
    const user = await this.findCustomerForUpdate(input.customerUserId);
    if (!user) throw referralError('customer_not_found', '客户账号不存在', 401);

    const idempotent = await this.findLeadByIdempotency(
      input.customerUserId,
      input.idempotencyKeyHash
    );
    if (idempotent) return { kind: 'idempotent', lead: idempotent };
    if (input.source.expired) {
      throw referralError('pending_source_expired', '推广来源已过期，请重新扫码', 410);
    }
    if (!user.phone) {
      throw referralError('phone_authorization_required', '请先授权手机号', 403);
    }

    const staffActivitySource =
      input.source.kind === 'staff_activity' ? input.source : null;
    const referralSource = staffActivitySource
      ? null
      : await this.validateSource(input.source as ReferralPendingSourceRecord);
    const activitySource = staffActivitySource
      ? await this.validateStaffActivitySource(staffActivitySource)
      : null;
    if (!referralSource && !activitySource) {
      throw referralError('pending_source_invalid', '推广来源无效或已失效', 410);
    }

    await this.lockKey(`customer-attribution:${input.customerUserId.toString()}`);
    const existing = await this.findActiveAttribution(input.customerUserId);
    if (existing) {
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId: existing.lock.enterpriseId,
        leadId: existing.lead.id,
        eventType: 'attribution_reused',
        designerId: existing.lead.assignedTo,
        measurerId: existing.lead.measurerId,
        actorUserId: input.customerUserId,
        reason: 'active_attribution_preserved',
        metadata: {
          authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
        },
      });
      return {
        kind: 'existing_attribution',
        lead: await this.loadLead(existing.lead.id),
      };
    }
    await this.releaseInactiveAttributionLocks(input.customerUserId);

    const enterpriseId = referralSource
      ? referralSource.membership.enterpriseId
      : activitySource!.code.enterpriseId;
    await this.lockKey(`enterprise-assignment:${enterpriseId.toString()}`);

    let designer: typeof adminUsers.$inferSelect | null = null;
    let measurer: typeof adminUsers.$inferSelect | null = null;
    if (activitySource) {
      const sourceStaff = activitySource.staff;
      if (sourceStaff.assignmentPaused) {
        measurer = null;
        designer =
          sourceStaff.role === 'designer'
            ? null
            : await this.findDesignerCandidate(enterpriseId);
      } else if (sourceStaff.role === 'designer') {
        designer = sourceStaff;
        measurer = sourceStaff;
      } else {
        measurer = sourceStaff;
        designer = await this.findDesignerCandidate(enterpriseId);
      }
    } else {
      designer = await this.findDesignerCandidate(enterpriseId);
      measurer = await this.findMeasurerCandidate(enterpriseId);
    }

    const now = new Date();
    const assignmentErrorCode = this.assignmentErrorCode(designer, measurer);
    const createdRows = await this.transaction
      .insert(leads)
      .values({
        enterpriseId,
        customerUserId: input.customerUserId,
        referrerMembershipId: referralSource?.membership.id ?? null,
        promoterId: activitySource?.staff.id ?? null,
        measurerId: measurer?.id ?? null,
        assignedTo: designer?.id ?? null,
        assignedAt: designer ? now : null,
        attributionLockedAt: now,
        assignmentStatus: assignmentErrorCode ? 'assignment_pending' : 'assigned',
        assignmentErrorCode,
        name:
          input.name?.trim().slice(0, 120) || user.nickname?.trim() || '微信客户',
        phone: user.phone,
        communityName: input.communityName?.trim().slice(0, 160) || null,
        city: input.city?.trim().slice(0, 80) || null,
        stylePreference: input.stylePreference?.trim().slice(0, 120) || null,
        source: activitySource ? 'staff_activity' : 'referrer_network',
        status: 'new',
        followUpRecords: [],
      })
      .returning();
    const lead = createdRows[0];
    if (!lead) throw referralError('lead_create_failed', '线索创建失败', 500);

    await this.transaction.insert(customerAttributionLocks).values({
      enterpriseId,
      customerUserId: input.customerUserId,
      leadId: lead.id,
      referrerMembershipId: referralSource?.membership.id ?? null,
      lockedAt: now,
    });

    if (designer) {
      await this.transaction
        .update(adminUsers)
        .set({ lastAssignedAt: now, updatedAt: now })
        .where(eq(adminUsers.id, designer.id));
    }
    if (measurer && measurer.id !== designer?.id) {
      await this.transaction
        .update(adminUsers)
        .set({ lastAssignedAt: now, updatedAt: now })
        .where(eq(adminUsers.id, measurer.id));
    }
    await this.transaction.insert(leadAssignmentEvents).values({
      enterpriseId,
      leadId: lead.id,
      eventType: assignmentErrorCode ? 'assignment_pending' : 'assignment_created',
      designerId: designer?.id ?? null,
      measurerId: measurer?.id ?? null,
      actorUserId: input.customerUserId,
      errorCode: assignmentErrorCode,
      reason: activitySource ? 'staff_activity_attribution' : 'referrer_attribution',
      metadata: {
        authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
        ...(referralSource
          ? { promotionCodeId: referralSource.code.id.toString() }
          : { activityCodeId: activitySource!.code.id.toString() }),
      },
    });

    return { kind: 'created', lead: await this.loadLead(lead.id) };
  }

  async retryLeadAssignment(input: {
    leadId: bigint;
    reason: string;
  }): Promise<ReferralAssignmentRetryResult | null> {
    const lockedRows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1)
      .for('update');
    const current = lockedRows[0];
    if (!current) return null;
    if (current.assignmentStatus === 'assigned') {
      return { kind: 'already_assigned', lead: await this.loadLead(current.id) };
    }
    if (!current.enterpriseId || current.archivedAt || current.status === 'closed') {
      return { kind: 'pending', lead: await this.loadLead(current.id) };
    }

    await this.lockKey(`enterprise-assignment:${current.enterpriseId.toString()}`);
    const staffActivity = current.source === 'staff_activity';
    const currentDesigner = await this.findEligibleStaff(
      current.assignedTo,
      'designer',
      current.enterpriseId
    );
    const currentMeasurer = staffActivity
      ? current.measurerId
        ? await this.findAssignedStaff(current.measurerId, current.enterpriseId)
        : await this.findEligibleActivityPresenter(
            current.promoterId,
            current.enterpriseId
          )
      : await this.findEligibleStaff(
          current.measurerId,
          'measurer',
          current.enterpriseId
        );
    const designer = currentDesigner ?? (await this.findDesignerCandidate(current.enterpriseId));
    const measurer = staffActivity
      ? currentMeasurer
      : currentMeasurer ?? (await this.findMeasurerCandidate(current.enterpriseId));
    const now = new Date();
    const errorCode = this.assignmentErrorCode(designer, measurer);
    const assignmentStatus = errorCode ? 'assignment_pending' : 'assigned';
    const updatedRows = await this.transaction
      .update(leads)
      .set({
        assignedTo: designer?.id ?? null,
        measurerId: measurer?.id ?? (staffActivity ? current.measurerId : null),
        assignedAt: designer ? current.assignedAt ?? now : null,
        assignmentStatus,
        assignmentErrorCode: errorCode,
        updatedAt: now,
      })
      .where(eq(leads.id, current.id))
      .returning();
    if (!updatedRows[0]) return null;

    for (const staff of [
      currentDesigner?.id === designer?.id ? null : designer?.id,
      currentMeasurer?.id === measurer?.id ? null : measurer?.id,
    ]) {
      if (staff) {
        await this.transaction
          .update(adminUsers)
          .set({ lastAssignedAt: now, updatedAt: now })
          .where(eq(adminUsers.id, staff));
      }
    }
    const eventRows = await this.transaction
      .insert(leadAssignmentEvents)
      .values({
        enterpriseId: current.enterpriseId,
        leadId: current.id,
        eventType: errorCode
          ? 'assignment_retry_pending'
          : 'assignment_retry_succeeded',
        previousDesignerId: current.assignedTo,
        designerId: designer?.id ?? null,
        previousMeasurerId: current.measurerId,
        measurerId: measurer?.id ?? null,
        errorCode,
        reason: input.reason.slice(0, 160),
        metadata: {},
      })
      .returning({ id: leadAssignmentEvents.id });
    return {
      kind: errorCode ? 'pending' : 'assigned',
      lead: await this.loadLead(current.id),
      eventId: eventRows[0]?.id,
    };
  }

  async retryPendingAssignments(input: { limit?: number; reason: string }) {
    const rows = await this.transaction
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.assignmentStatus, 'assignment_pending'),
          isNull(leads.archivedAt),
          ne(leads.status, 'closed')
        )
      )
      .orderBy(asc(leads.createdAt), asc(leads.id))
      .limit(Math.min(Math.max(input.limit ?? 100, 1), 1000));
    const results: Array<ReferralAssignmentRetryResult> = [];
    for (const row of rows) {
      const result = await this.retryLeadAssignment({
        leadId: row.id,
        reason: input.reason,
      });
      if (result) results.push(result);
    }
    return results;
  }
}
