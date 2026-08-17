import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  type SQL,
} from 'drizzle-orm';
import {
  adminUsers,
  floorPlans,
  leadAcquisitionCommissions,
  customerAttributionLocks,
  leadFloorPlans,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  getLeadStatusVariants,
  normalizeLeadStatus,
  resolveLeadStatusAfterFloorPlan,
} from '@/lib/lead-status';

export type NewLead = typeof leads.$inferInsert;
export type LeadRecord = typeof leads.$inferSelect;
export type LeadUpdate = Partial<
  Omit<NewLead, 'id' | 'createdAt' | 'updatedAt'>
>;
export type LeadFloorPlanRecord = typeof floorPlans.$inferSelect & {
  measurementSequence: number;
};

export interface LeadStaffSummary {
  id: bigint;
  displayName: string;
  username: string;
  role: string;
  wechatId?: string | null;
  wechatQrAssetId?: bigint | null;
}

export interface LeadWithRelations extends LeadRecord {
  floorPlanRecords: LeadFloorPlanRecord[];
  primaryFloorPlanRecord: LeadFloorPlanRecord | null;
  assignedUser: LeadStaffSummary | null;
  promoter: LeadStaffSummary | null;
  archivedUser: LeadStaffSummary | null;
  convertedUser: LeadStaffSummary | null;
  acquisitionCommission: {
    status: string;
    commissionAmount: string;
  } | null;
}

export interface LeadListOptions {
  status?: string;
  acquisitionStatus?: 'pending_confirmation' | 'confirmed';
  source?: string;
  phone?: string;
  query?: string;
  staffId?: bigint;
  staffVisibility?: 'assigned' | 'promoted-or-assigned';
  page?: number;
  limit?: number;
  createdSince?: Date;
  orderBy?: 'createdAt' | 'updatedAt';
  archiveState?: 'active' | 'archived' | 'all';
}

export class LeadRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private buildFilters(options: LeadListOptions) {
    const filters: SQL[] = [];
    if (options.archiveState === 'archived') {
      filters.push(isNotNull(leads.archivedAt));
    } else if (options.archiveState !== 'all') {
      filters.push(isNull(leads.archivedAt));
    }
    if (options.status && options.status !== 'all') {
      const variants = getLeadStatusVariants(options.status);
      filters.push(
        variants.length === 1
          ? eq(leads.status, variants[0])
          : inArray(leads.status, variants)
      );
    }
    if (options.acquisitionStatus === 'pending_confirmation') {
      filters.push(isNull(leads.acquiredAt));
    } else if (options.acquisitionStatus === 'confirmed') {
      filters.push(isNotNull(leads.acquiredAt));
    }
    if (options.source) filters.push(eq(leads.source, options.source));
    if (options.phone) filters.push(eq(leads.phone, options.phone));
    if (options.query?.trim()) {
      const query = options.query.trim().replace(/[%_]/g, '\\$&');
      filters.push(or(
        ilike(leads.name, `%${query}%`),
        ilike(leads.phone, `%${query}%`),
        ilike(leads.communityName, `%${query}%`)
      )!);
    }
    if (options.createdSince) {
      filters.push(gte(leads.createdAt, options.createdSince));
    }
    if (options.staffId) {
      filters.push(
        options.staffVisibility === 'promoted-or-assigned'
          ? or(
              eq(leads.promoterId, options.staffId),
              eq(leads.assignedTo, options.staffId)
            )!
          : eq(leads.assignedTo, options.staffId)
      );
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  private async attachRelations(
    rows: LeadRecord[]
  ): Promise<LeadWithRelations[]> {
    if (rows.length === 0) return [];

    const leadIds = rows.map((row) => row.id);
    const links = await this.transaction
      .select({
        leadId: leadFloorPlans.leadId,
        floorPlanId: leadFloorPlans.floorPlanId,
        measurementSequence: leadFloorPlans.measurementSequence,
      })
      .from(leadFloorPlans)
      .where(inArray(leadFloorPlans.leadId, leadIds));

    const floorPlanIds = Array.from(
      new Set([
        ...links.map((link) => link.floorPlanId),
        ...rows.flatMap((row) =>
          row.primaryFloorPlanId ? [row.primaryFloorPlanId] : []
        ),
      ])
    );
    const planRows =
      floorPlanIds.length > 0
        ? await this.transaction
            .select()
            .from(floorPlans)
            .where(inArray(floorPlans.id, floorPlanIds))
            .orderBy(desc(floorPlans.createdAt), desc(floorPlans.id))
        : [];
    const planMap = new Map(planRows.map((plan) => [plan.id, plan]));
    const linkMap = new Map(
      links.map((link) => [`${link.leadId}:${link.floorPlanId}`, link])
    );
    const leadPlanMap = new Map<bigint, LeadFloorPlanRecord[]>();
    for (const link of links) {
      const plan = planMap.get(link.floorPlanId);
      if (!plan) continue;
      const values = leadPlanMap.get(link.leadId) ?? [];
      values.push({ ...plan, measurementSequence: link.measurementSequence });
      leadPlanMap.set(link.leadId, values);
    }

    const staffIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          [row.assignedTo, row.promoterId, row.archivedBy, row.convertedBy].filter(
            (value): value is bigint => value !== null
          )
        )
      )
    );
    const [staffRows, acquisitionRows] = await Promise.all([
      staffIds.length > 0
        ? await this.transaction
            .select({
              id: adminUsers.id,
              displayName: adminUsers.displayName,
              username: adminUsers.username,
              role: adminUsers.role,
              wechatId: adminUsers.wechatId,
              wechatQrAssetId: adminUsers.wechatQrAssetId,
            })
            .from(adminUsers)
            .where(inArray(adminUsers.id, staffIds))
        : [],
      this.transaction
        .select({
          leadId: leadAcquisitionCommissions.leadId,
          status: leadAcquisitionCommissions.status,
          commissionAmount: leadAcquisitionCommissions.commissionAmount,
        })
        .from(leadAcquisitionCommissions)
        .where(inArray(leadAcquisitionCommissions.leadId, leadIds)),
    ]);
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));
    const acquisitionMap = new Map(acquisitionRows.map((item) => [item.leadId, item]));

    return rows.map((row) => ({
      ...row,
      floorPlanRecords: leadPlanMap.get(row.id) ?? [],
      primaryFloorPlanRecord: row.primaryFloorPlanId
        ? (() => {
            const plan = planMap.get(row.primaryFloorPlanId);
            const link = linkMap.get(`${row.id}:${row.primaryFloorPlanId}`);
            return plan && link
              ? { ...plan, measurementSequence: link.measurementSequence }
              : null;
          })()
        : null,
      assignedUser: row.assignedTo
        ? staffMap.get(row.assignedTo) ?? null
        : null,
      promoter: row.promoterId ? staffMap.get(row.promoterId) ?? null : null,
      archivedUser: row.archivedBy ? staffMap.get(row.archivedBy) ?? null : null,
      convertedUser: row.convertedBy ? staffMap.get(row.convertedBy) ?? null : null,
      acquisitionCommission: acquisitionMap.get(row.id) ?? null,
    }));
  }

  async list(options: LeadListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const orderColumn = options.orderBy === 'updatedAt' ? leads.updatedAt : leads.createdAt;
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(orderColumn), desc(leads.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction.select({ value: count() }).from(leads).where(where),
    ]);
    return {
      rows: await this.attachRelations(rows),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async count(options: LeadListOptions = {}) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(leads)
      .where(this.buildFilters(options));
    return Number(rows[0]?.value ?? 0);
  }

  async countStatuses(
    options: Omit<LeadListOptions, 'status'>,
    statuses: string[]
  ) {
    const rows = await this.transaction
      .select({ status: leads.status, value: count() })
      .from(leads)
      .where(this.buildFilters(options))
      .groupBy(leads.status);
    const counts = new Map(
      rows.map((row) => [row.status, Number(row.value)] as const)
    );
    return Object.fromEntries(
      statuses.map((status) => [status, counts.get(status) ?? 0])
    ) as Record<string, number>;
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    if (!rows[0]) return null;
    return (await this.attachRelations(rows))[0] ?? null;
  }

  async findByIds(ids: bigint[], options: { includeArchived?: boolean } = {}) {
    if (!ids.length) return [];
    const rows = await this.transaction
      .select()
      .from(leads)
      .where(options.includeArchived
        ? inArray(leads.id, ids)
        : and(inArray(leads.id, ids), isNull(leads.archivedAt)));
    return this.attachRelations(rows);
  }

  async findByPhone(phone: string) {
    const rows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.phone, phone))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(1);
    if (!rows[0]) return null;
    return (await this.attachRelations(rows))[0] ?? null;
  }

  async findByFloorPlanId(floorPlanId: bigint) {
    const rows = await this.transaction
      .select({ lead: leads })
      .from(leadFloorPlans)
      .innerJoin(leads, eq(leadFloorPlans.leadId, leads.id))
      .where(eq(leadFloorPlans.floorPlanId, floorPlanId))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(1);
    if (!rows[0]) return null;
    return (await this.attachRelations([rows[0].lead]))[0] ?? null;
  }

  async findByFloorPlanIds(floorPlanIds: bigint[]) {
    if (!floorPlanIds.length) return new Map<bigint, LeadWithRelations>();
    const rows = await this.transaction
      .select({ lead: leads })
      .from(leadFloorPlans)
      .innerJoin(leads, eq(leadFloorPlans.leadId, leads.id))
      .where(inArray(leadFloorPlans.floorPlanId, floorPlanIds))
      .orderBy(desc(leads.createdAt), desc(leads.id));
    const relatedLeads = await this.attachRelations(
      Array.from(new Map(rows.map((row) => [row.lead.id, row.lead])).values())
    );
    const requestedIds = new Set(floorPlanIds);
    const result = new Map<bigint, LeadWithRelations>();
    relatedLeads.forEach((lead) => {
      lead.floorPlanRecords.forEach((plan) => {
        if (requestedIds.has(plan.id) && !result.has(plan.id)) result.set(plan.id, lead);
      });
    });
    return result;
  }

  async create(input: NewLead) {
    const rows = await this.transaction.insert(leads).values(input).returning();
    return rows[0];
  }

  async update(id: bigint, input: LeadUpdate) {
    const current = await this.transaction
      .select({ archivedAt: leads.archivedAt, status: leads.status })
      .from(leads)
      .where(eq(leads.id, id))
      .for('update')
      .limit(1);
    if (current[0]?.archivedAt) {
      throw Object.assign(new Error('该客户线索已归档，请先恢复后再操作'), {
        status: 409,
        code: 'LEAD_ARCHIVED',
      });
    }
    if (current[0] && input.status !== undefined) {
      const currentStatus = normalizeLeadStatus(current[0].status);
      const nextStatus = normalizeLeadStatus(input.status);
      if (
        (currentStatus === 'converted' && nextStatus !== 'converted') ||
        (currentStatus !== 'converted' && nextStatus === 'converted')
      ) {
        throw Object.assign(
          new Error('已签约状态只能通过专用签约操作修改或撤销'),
          { status: 400 }
        );
      }
    }
    const nextStatus = input.status === undefined
      ? current[0]?.status
      : normalizeLeadStatus(input.status);
    const rows = await this.transaction
      .update(leads)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    if (!rows[0]) return null;
    if (nextStatus === 'closed' && current[0]?.status !== 'closed') {
      await this.transaction
        .update(customerAttributionLocks)
        .set({
          releasedAt: new Date(),
          releaseReason: 'lead_closed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customerAttributionLocks.leadId, id),
            isNull(customerAttributionLocks.releasedAt)
          )
        );
    }
    return (await this.attachRelations(rows))[0] ?? null;
  }

  async linkFloorPlan(
    leadId: bigint,
    floorPlanId: bigint,
    status?: string
  ) {
    const [lead, plan] = await Promise.all([
      this.transaction
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .for('update')
        .limit(1),
      this.transaction
        .select()
        .from(floorPlans)
        .where(eq(floorPlans.id, floorPlanId))
        .limit(1),
    ]);
    if (!lead[0] || !plan[0]) return null;
    if (lead[0].archivedAt) {
      throw Object.assign(new Error('该客户线索已归档，请先恢复后再操作'), {
        status: 409,
        code: 'LEAD_ARCHIVED',
      });
    }
    if (lead[0].enterpriseId !== plan[0].enterpriseId) {
      throw new Error('Lead and floor plan belong to different enterprises');
    }

    const existingLink = await this.transaction
      .select({ measurementSequence: leadFloorPlans.measurementSequence })
      .from(leadFloorPlans)
      .where(and(
        eq(leadFloorPlans.leadId, leadId),
        eq(leadFloorPlans.floorPlanId, floorPlanId)
      ))
      .limit(1);
    if (!existingLink[0]) {
      const sequences = await this.transaction
        .select({ value: max(leadFloorPlans.measurementSequence) })
        .from(leadFloorPlans)
        .where(eq(leadFloorPlans.leadId, leadId));
      await this.transaction
        .insert(leadFloorPlans)
        .values({
          leadId,
          floorPlanId,
          measurementSequence: Number(sequences[0]?.value ?? 0) + 1,
        });
    }
    const rows = await this.transaction
      .update(leads)
      .set({
        primaryFloorPlanId: floorPlanId,
        status: resolveLeadStatusAfterFloorPlan(lead[0].status, plan[0].status, status),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning();
    return rows[0] ? (await this.attachRelations(rows))[0] : null;
  }

  async unlinkFloorPlan(floorPlanId: bigint) {
    await this.transaction
      .update(leads)
      .set({ primaryFloorPlanId: null, updatedAt: new Date() })
      .where(eq(leads.primaryFloorPlanId, floorPlanId));
    await this.transaction
      .delete(leadFloorPlans)
      .where(eq(leadFloorPlans.floorPlanId, floorPlanId));
  }

}
