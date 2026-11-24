import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  adminUsers,
  customerAttributionLocks,
  leadAssignmentEvents,
  leadClaimWindows,
  leads,
  referrerEnterpriseMemberships,
  referrerPromotionCodes,
  staffActivityCodes,
  users,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  assertCanAssignLeadStaff,
  canAccessLeadForStaffAssign,
} from '@/lib/lead-assignment-actions';
import { archivedLeadExistsError } from '@/lib/lead-lifecycle';
import {
  customerPhoneLookupValues,
  isPlaceholderCustomerName,
  normalizeCustomerPhone,
} from '@/lib/customer-phone';
import { AppointmentRepository } from './appointment-repository';
import { AssignmentRacingRepository } from './assignment-racing-repository';
import { currentCustomerService } from './customer-service';
import { LeadRepository, type LeadWithRelations } from './lead-repository';
import { STAFF_ACTIVITY_PRESENTER_ROLES } from './referrer-network-repository';

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

function createReferrerRecordCode() {
  return `R-${randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, '0')}`;
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

export type ReferralManualAssignResult = {
  kind: 'assigned' | 'pending';
  lead: LeadWithRelations;
  eventId?: bigint;
  rewrittenAppointment?: Awaited<
    ReturnType<AppointmentRepository['reassignActiveStaffForLead']>
  >;
};

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
    const scope = await currentCustomerService(this.transaction, customerUserId);
    return { ambiguous: scope.ambiguous, lead: scope.leadId ? await this.loadLead(BigInt(scope.leadId)) : null };
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
    if (
      !row ||
      !(STAFF_ACTIVITY_PRESENTER_ROLES as readonly string[]).includes(row.staff.role)
    ) {
      return null;
    }
    return row;
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

  private async findEligibleDesigner(
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
      .limit(1);
    return rows[0] ?? null;
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
    if (idempotent) {
      const { lead } = await this.findActiveCustomerAttribution(input.customerUserId);
      if (!lead || !idempotent.enterpriseId) throw referralError('customer_service_changed', '原服务关系已变更，请重新扫码');
      if (lead.enterpriseId !== idempotent.enterpriseId) return { kind: 'existing_attribution', lead };
      return { kind: 'idempotent', lead: idempotent };
    }
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

    const enterpriseId = referralSource
      ? referralSource.membership.enterpriseId
      : activitySource!.code.enterpriseId;
    const phone = normalizeCustomerPhone(user.phone);
    await this.lockKey(`enterprise-phone:${enterpriseId.toString()}:${phone}`);
    await this.lockKey(`customer-attribution:${input.customerUserId.toString()}`);
    const { lead: existing, ambiguous } = await this.findActiveCustomerAttribution(input.customerUserId);
    if (ambiguous) throw referralError('customer_service_ambiguous', '存在多家服务企业，请联系当前的装修顾问确认');
    if (existing?.enterpriseId) {
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId: existing.enterpriseId,
        leadId: existing.id,
        eventType: 'attribution_reused',
        designerId: existing.assignedTo,
        measurerId: existing.measurerId,
        actorUserId: input.customerUserId,
        reason: 'active_attribution_preserved',
        metadata: {
          authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
        },
      });
      return {
        kind: 'existing_attribution',
        lead: existing,
      };
    }
    await this.releaseInactiveAttributionLocks(input.customerUserId);
    if (await this.findActiveAttribution(input.customerUserId))
      throw referralError('customer_service_changed', '原服务关系暂不可用，请联系装修顾问确认');

    const matchedLead = await new LeadRepository(this.transaction).findOpenByPhone(
      phone,
      enterpriseId
    );
    if (
      matchedLead &&
      (!matchedLead.customerUserId || matchedLead.customerUserId === input.customerUserId)
    ) {
      return {
        kind: 'existing_attribution',
        lead: await this.attachCustomerToOpenLead({
          lead: matchedLead,
          customerUserId: input.customerUserId,
          phone,
          name: input.name?.trim().slice(0, 120) || user.nickname?.trim() || null,
          idempotencyKeyHash: input.idempotencyKeyHash,
        }),
      };
    }

    await this.lockKey(`enterprise-assignment:${enterpriseId.toString()}`);

    const racing = new AssignmentRacingRepository(this.transaction);
    const setting = await racing.getCurrentSettings(enterpriseId);
    const designer = activitySource?.staff.role === 'designer' ? activitySource.staff : null;
    const now = new Date();
    const createdRows = await this.transaction
      .insert(leads)
      .values({
        enterpriseId,
        customerUserId: input.customerUserId,
        referrerMembershipId: referralSource?.membership.id ?? null,
        referrerRecordCode: referralSource ? createReferrerRecordCode() : null,
        promoterId: activitySource?.staff.id ?? null,
        assignedTo: designer?.id ?? null,
        assignedAt: designer ? now : null,
        attributionLockedAt: now,
        assignmentStatus: designer
          ? 'assigned'
          : setting?.claimEnabled ? 'claim_open' : 'assignment_pending',
        name:
          input.name?.trim().slice(0, 120) || user.nickname?.trim() || '微信客户',
        phone,
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
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId,
        leadId: lead.id,
        eventType: 'assignment_created',
        designerId: designer.id,
        actorUserId: input.customerUserId,
        reason: 'designer_activity_direct_attribution',
        metadata: {
          authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
          activityCodeId: activitySource!.code.id.toString(),
        },
      });
    } else {
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId,
        leadId: lead.id,
        eventType: 'attribution_created',
        actorUserId: input.customerUserId,
        reason: activitySource
          ? activitySource.staff.role === 'measurer'
            ? 'measurer_activity_attribution'
            : 'enterprise_admin_activity_attribution'
          : 'referrer_attribution',
        metadata: {
          authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
          ...(activitySource ? { activityCodeId: activitySource.code.id.toString() } : {}),
        },
      });
      if (setting?.claimEnabled) {
        await racing.openClaimWindow({ leadId: lead.id, enterpriseId, setting, now });
      } else {
        await racing.autoAssignLead({ leadId: lead.id, reason: 'new_lead_immediate_racing', now });
      }
    }

    return { kind: 'created', lead: await this.loadLead(lead.id) };
  }

  async createManualEntryLead(input: {
    enterpriseId: bigint;
    actorStaffId: bigint | null;
    actorUserId: bigint | null;
    name: string;
    phone: string;
    communityName?: string | null;
    area?: string | null;
    stylePreference?: string | null;
    city?: string | null;
    notes?: string | null;
  }): Promise<{ lead: LeadWithRelations; created: boolean }> {
    const phone = normalizeCustomerPhone(input.phone);
    const leadsRepo = new LeadRepository(this.transaction);
    await this.lockKey(`enterprise-phone:${input.enterpriseId.toString()}:${phone}`);
    const existingOpen = await leadsRepo.findOpenByPhone(phone, input.enterpriseId);
    if (existingOpen) {
      return {
        created: false,
        lead: await this.mergeManualProfileIntoLead(existingOpen, {
          ...input,
          phone,
        }),
      };
    }
    const archived = await leadsRepo.findArchivedByPhone(phone, input.enterpriseId);
    if (archived) throw archivedLeadExistsError();

    const matchedUser = await this.findCustomerUserByPhone(phone);
    let customerUserId: bigint | null = null;
    if (matchedUser) {
      await this.lockKey(`customer-attribution:${matchedUser.id.toString()}`);
      const active = await this.findActiveAttribution(matchedUser.id);
      if (!active) customerUserId = matchedUser.id;
    }
    await this.lockKey(`enterprise-assignment:${input.enterpriseId.toString()}`);
    const racing = new AssignmentRacingRepository(this.transaction);
    const setting = await racing.getCurrentSettings(input.enterpriseId);
    const now = new Date();
    const createdRows = await this.transaction
      .insert(leads)
      .values({
        enterpriseId: input.enterpriseId,
        customerUserId,
        referrerMembershipId: null,
        promoterId: input.actorStaffId,
        assignedTo: null,
        assignedAt: null,
        attributionLockedAt: customerUserId ? now : null,
        assignmentStatus: setting?.claimEnabled ? 'claim_open' : 'assignment_pending',
        name: input.name.trim().slice(0, 120),
        phone,
        communityName: input.communityName?.trim().slice(0, 160) || null,
        area: input.area || null,
        city: input.city?.trim().slice(0, 80) || null,
        stylePreference: input.stylePreference?.trim().slice(0, 120) || null,
        notes: input.notes?.trim() || null,
        source: 'manual_entry',
        status: 'new',
        followUpRecords: [],
      })
      .returning();
    const lead = createdRows[0];
    if (!lead) throw referralError('lead_create_failed', '线索创建失败', 500);

    if (customerUserId) {
      await this.ensureCustomerAttributionLock({
        enterpriseId: input.enterpriseId,
        customerUserId,
        leadId: lead.id,
        lockedAt: now,
      });
    }

    if (setting?.claimEnabled) {
      await racing.openClaimWindow({ leadId: lead.id, enterpriseId: input.enterpriseId, setting, now });
    } else {
      await racing.autoAssignLead({ leadId: lead.id, reason: 'manual_entry_immediate_racing', now });
    }

    return { created: true, lead: await this.loadLead(lead.id) };
  }

  /**
   * A customer booking from XiaoK creates the service record it needs, without
   * a referrer/activity source. Appointment creation then assigns the lead
   * against the chosen slot in the same transaction.
   */
  async createCustomerBookingLead(input: {
    enterpriseId: bigint;
    customerUserId: bigint;
    name: string;
    phone: string;
  }): Promise<{ lead: LeadWithRelations; created: boolean }> {
    const phone = normalizeCustomerPhone(input.phone);
    const leadsRepo = new LeadRepository(this.transaction);
    await this.lockKey(`enterprise-phone:${input.enterpriseId.toString()}:${phone}`);
    const existing = await leadsRepo.findOpenByPhone(phone, input.enterpriseId);
    if (existing) {
      if (existing.customerUserId && existing.customerUserId !== input.customerUserId) {
        throw referralError('lead_phone_conflict', '该手机号已绑定其他客户档案', 409);
      }
      const now = new Date();
      if (!existing.customerUserId) {
        await this.transaction
          .update(leads)
          .set({
            customerUserId: input.customerUserId,
            attributionLockedAt: existing.attributionLockedAt ?? now,
            updatedAt: now,
          })
          .where(eq(leads.id, existing.id));
        await this.ensureCustomerAttributionLock({
          enterpriseId: input.enterpriseId,
          customerUserId: input.customerUserId,
          leadId: existing.id,
          lockedAt: now,
        });
      }
      return { created: false, lead: await this.loadLead(existing.id) };
    }
    const archived = await leadsRepo.findArchivedByPhone(phone, input.enterpriseId);
    if (archived) throw archivedLeadExistsError();

    await this.lockKey(`customer-attribution:${input.customerUserId.toString()}`);
    const now = new Date();
    const createdRows = await this.transaction
      .insert(leads)
      .values({
        enterpriseId: input.enterpriseId,
        customerUserId: input.customerUserId,
        promoterId: null,
        assignedTo: null,
        assignedAt: null,
        attributionLockedAt: now,
        assignmentStatus: 'assignment_pending',
        assignmentErrorCode: null,
        name: input.name.trim().slice(0, 120) || '微信客户',
        phone,
        source: 'assistant_booking',
        status: 'new',
        followUpRecords: [],
      })
      .returning();
    const lead = createdRows[0];
    if (!lead) throw referralError('lead_create_failed', '线索创建失败', 500);

    await this.ensureCustomerAttributionLock({
      enterpriseId: input.enterpriseId,
      customerUserId: input.customerUserId,
      leadId: lead.id,
      lockedAt: now,
    });
    return { created: true, lead: await this.loadLead(lead.id) };
  }

  private async findCustomerUserByPhone(phone: string) {
    const values = customerPhoneLookupValues(phone);
    if (!values.length) return null;
    const rows = await this.transaction
      .select()
      .from(users)
      .where(inArray(users.phone, values))
      .orderBy(asc(users.id))
      .limit(1);
    return rows[0] ?? null;
  }

  private async ensureCustomerAttributionLock(input: {
    enterpriseId: bigint;
    customerUserId: bigint;
    leadId: bigint;
    lockedAt: Date;
  }) {
    const existing = await this.findActiveAttribution(input.customerUserId);
    if (existing) return existing.lock;
    const inserted = await this.transaction
      .insert(customerAttributionLocks)
      .values({
        enterpriseId: input.enterpriseId,
        customerUserId: input.customerUserId,
        leadId: input.leadId,
        lockedAt: input.lockedAt,
      })
      .returning();
    return inserted[0] ?? null;
  }

  private async attachCustomerToOpenLead(input: {
    lead: LeadWithRelations;
    customerUserId: bigint;
    phone: string;
    name: string | null;
    idempotencyKeyHash: string;
  }) {
    const now = new Date();
    const nextName = isPlaceholderCustomerName(input.lead.name)
      ? input.name || input.lead.name
      : input.lead.name;
    await this.transaction
      .update(leads)
      .set({
        customerUserId: input.lead.customerUserId ?? input.customerUserId,
        phone: input.phone,
        name: nextName,
        attributionLockedAt: input.lead.attributionLockedAt ?? now,
        updatedAt: now,
      })
      .where(eq(leads.id, input.lead.id));
    const enterpriseId = input.lead.enterpriseId;
    if (enterpriseId) {
      await this.ensureCustomerAttributionLock({
        enterpriseId,
        customerUserId: input.customerUserId,
        leadId: input.lead.id,
        lockedAt: now,
      });
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId,
        leadId: input.lead.id,
        eventType: 'attribution_reused',
        designerId: input.lead.assignedTo,
        measurerId: input.lead.measurerId,
        actorUserId: input.customerUserId,
        reason: 'phone_match_attached',
        metadata: {
          authorizationIdempotencyKeyHash: input.idempotencyKeyHash,
        },
      });
    }
    return this.loadLead(input.lead.id);
  }

  private async mergeManualProfileIntoLead(
    existing: LeadWithRelations,
    input: {
      name: string;
      phone: string;
      communityName?: string | null;
      area?: string | null;
      stylePreference?: string | null;
      city?: string | null;
      notes?: string | null;
      actorUserId: bigint | null;
    }
  ) {
    const now = new Date();
    const matchedUser =
      existing.customerUserId != null
        ? null
        : await this.findCustomerUserByPhone(input.phone);
    if (matchedUser) {
      await this.lockKey(`customer-attribution:${matchedUser.id.toString()}`);
    }
    const active = matchedUser
      ? await this.findActiveAttribution(matchedUser.id)
      : null;
    const customerUserId =
      existing.customerUserId ??
      (matchedUser && (!active || active.lead.id === existing.id)
        ? matchedUser.id
        : null);
    await this.transaction
      .update(leads)
      .set({
        name: input.name.trim().slice(0, 120) || existing.name,
        phone: input.phone,
        communityName:
          input.communityName?.trim().slice(0, 160) || existing.communityName,
        area: input.area || existing.area,
        stylePreference:
          input.stylePreference?.trim().slice(0, 120) || existing.stylePreference,
        city: input.city?.trim().slice(0, 80) || existing.city,
        notes: input.notes?.trim() || existing.notes,
        customerUserId,
        attributionLockedAt:
          customerUserId && !existing.attributionLockedAt
            ? now
            : existing.attributionLockedAt,
        updatedAt: now,
      })
      .where(eq(leads.id, existing.id));
    const enterpriseId = existing.enterpriseId;
    if (enterpriseId) {
      if (customerUserId) {
        await this.ensureCustomerAttributionLock({
          enterpriseId,
          customerUserId,
          leadId: existing.id,
          lockedAt: now,
        });
      }
      await this.transaction.insert(leadAssignmentEvents).values({
        enterpriseId,
        leadId: existing.id,
        eventType: 'attribution_reused',
        designerId: existing.assignedTo,
        measurerId: existing.measurerId,
        actorUserId: input.actorUserId,
        reason: 'manual_entry_phone_merged',
        metadata: {},
      });
    }
    return this.loadLead(existing.id);
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
    const currentDesigner = await this.findEligibleDesigner(
      current.assignedTo,
      current.enterpriseId
    );
    const designer = currentDesigner ?? (await this.findDesignerCandidate(current.enterpriseId));
    const now = new Date();
    const errorCode = designer ? null : 'designer_unavailable';
    const assignmentStatus = errorCode ? 'assignment_pending' : 'assigned';
    const updatedRows = await this.transaction
      .update(leads)
      .set({
        assignedTo: designer?.id ?? null,
        assignedAt: designer ? current.assignedAt ?? now : null,
        assignmentStatus,
        assignmentErrorCode: errorCode,
        updatedAt: now,
      })
      .where(eq(leads.id, current.id))
      .returning();
    if (!updatedRows[0]) return null;

    if (designer && designer.id !== currentDesigner?.id) {
      await this.transaction
        .update(adminUsers)
        .set({ lastAssignedAt: now, updatedAt: now })
        .where(eq(adminUsers.id, designer.id));
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
        measurerId: current.measurerId,
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

  async listAssignableStaff(input: {
    enterpriseId: bigint;
    role: 'designer' | 'measurer';
    excludeStaffId?: bigint | null;
    page?: number;
    limit?: number;
  }) {
    const where = and(
      eq(adminUsers.enterpriseId, input.enterpriseId),
      eq(adminUsers.role, input.role),
      eq(adminUsers.status, 'active'),
      eq(adminUsers.assignmentPaused, false),
      ...(input.excludeStaffId ? [ne(adminUsers.id, input.excludeStaffId)] : []),
      ...(input.role === 'designer'
        ? [
            isNotNull(adminUsers.wechatId),
            sql`btrim(${adminUsers.wechatId}) <> ''`,
            isNotNull(adminUsers.wechatQrAssetId),
            sql`exists (
              select 1
              from app.media_assets assignment_qr
              where assignment_qr.id = ${adminUsers.wechatQrAssetId}
                and assignment_qr.enterprise_id = ${input.enterpriseId}
                and assignment_qr.deleted_at is null
            )`,
          ]
        : [])
    );
    const page = input.page != null ? Math.max(1, input.page) : null;
    const limit = input.limit != null ? Math.max(1, input.limit) : null;
    const query = this.transaction
      .select()
      .from(adminUsers)
      .where(where)
      .orderBy(asc(adminUsers.displayName), asc(adminUsers.id));
    const [rows, totalRows] = await Promise.all([
      page != null && limit != null
        ? query.offset((page - 1) * limit).limit(limit)
        : query,
      this.transaction.select({ value: count() }).from(adminUsers).where(where),
    ]);
    return {
      rows,
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async assignStaff(input: {
    leadId: bigint;
    actorStaffId?: bigint | null;
    actorRole?: string | null;
    actorUserId?: bigint | null;
    designerId?: bigint | null;
    measurerId?: bigint | null;
  }): Promise<ReferralManualAssignResult | null> {
    if (!input.designerId && !input.measurerId) {
      throw referralError('assign_staff_required', '请选择一位设计师', 400);
    }

    const lockedRows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1)
      .for('update');
    const current = lockedRows[0];
    if (!current) return null;
    if (!current.enterpriseId || current.archivedAt || current.status === 'closed') {
      throw referralError('lead_not_assignable', '线索不存在或不可派单', 404);
    }
    if (!canAccessLeadForStaffAssign(current, input.actorRole || '', input.actorStaffId ?? null)) {
      return null;
    }
    assertCanAssignLeadStaff({
      lead: current,
      role: input.actorRole || '',
      actorId: input.actorStaffId ?? null,
      designerId: input.designerId ?? null,
      measurerId: input.measurerId ?? null,
    });
    if (!input.designerId) throw referralError('assign_staff_required', '请选择一位设计师', 400);
    if (input.designerId === current.assignedTo) {
      throw referralError('designer_already_bound', '所选家装设计顾问已是当前绑定人员', 400);
    }

    await this.lockKey(`enterprise-assignment:${current.enterpriseId.toString()}`);

    const designer = await this.findEligibleDesigner(input.designerId, current.enterpriseId);
    if (!designer) throw referralError('designer_unavailable', '所选设计师不可派单', 400);
    const nextDesignerId = designer.id;

    const now = new Date();
    const overwritten = Boolean(current.assignedTo);
    const updatedRows = await this.transaction
      .update(leads)
      .set({
        assignedTo: nextDesignerId,
        assignedAt: current.assignedAt ?? now,
        assignmentStatus: 'assigned',
        assignmentErrorCode: null,
        updatedAt: now,
      })
      .where(eq(leads.id, current.id))
      .returning();
    if (!updatedRows[0]) return null;

    await this.transaction
      .update(leadClaimWindows)
      .set({
        status: 'manually_assigned',
        resolvedAt: now,
        resolutionReason: 'manager_assignment',
        updatedAt: now,
      })
      .where(and(
        eq(leadClaimWindows.leadId, current.id),
        eq(leadClaimWindows.status, 'open')
      ));

    await this.transaction
      .update(adminUsers)
      .set({ lastAssignedAt: now, updatedAt: now })
      .where(eq(adminUsers.id, nextDesignerId));
    const eventRows = await this.transaction
      .insert(leadAssignmentEvents)
      .values({
        enterpriseId: current.enterpriseId,
        leadId: current.id,
        eventType: overwritten ? 'assignment_manual_reassign' : 'assignment_manual',
        previousDesignerId: current.assignedTo,
        designerId: nextDesignerId,
        previousMeasurerId: current.measurerId,
        measurerId: current.measurerId,
        actorUserId: input.actorUserId ?? null,
        reason: overwritten ? 'miniprogram_manual_reassign' : 'miniprogram_manual_assign',
        metadata: {
          actorStaffId: input.actorStaffId?.toString() ?? null,
          actorRole: input.actorRole ?? null,
          requestedDesignerId: input.designerId?.toString() ?? null,
        },
      })
      .returning({ id: leadAssignmentEvents.id });

    const rewrittenAppointment = await new AppointmentRepository(this.transaction)
      .reassignActiveStaffForLead({
        leadId: current.id,
        designerId: nextDesignerId,
        measurerId: current.measurerId,
        actorUserId: input.actorUserId ?? null,
        eventKey: `staff_reassigned:${current.id.toString()}:${eventRows[0]?.id.toString() ?? '0'}`,
      });

    return {
      kind: 'assigned',
      lead: await this.loadLead(current.id),
      eventId: eventRows[0]?.id,
      rewrittenAppointment,
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
