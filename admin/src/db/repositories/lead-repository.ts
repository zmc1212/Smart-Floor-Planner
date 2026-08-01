import {
  and,
  count,
  desc,
  eq,
  inArray,
  or,
  type SQL,
} from 'drizzle-orm';
import {
  adminUsers,
  floorPlans,
  leadFloorPlans,
  leads,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewLead = typeof leads.$inferInsert;
export type LeadRecord = typeof leads.$inferSelect;
export type LeadUpdate = Partial<
  Omit<NewLead, 'id' | 'createdAt' | 'updatedAt'>
>;
export type LeadFloorPlanRecord = typeof floorPlans.$inferSelect;

export interface LeadStaffSummary {
  id: bigint;
  displayName: string;
  username: string;
  role: string;
}

export interface LeadWithRelations extends LeadRecord {
  floorPlanRecords: LeadFloorPlanRecord[];
  primaryFloorPlanRecord: LeadFloorPlanRecord | null;
  assignedUser: LeadStaffSummary | null;
  promoter: LeadStaffSummary | null;
}

export interface LeadListOptions {
  status?: string;
  source?: string;
  phone?: string;
  staffId?: bigint;
  staffVisibility?: 'assigned' | 'promoted-or-assigned';
  page?: number;
  limit?: number;
}

export class LeadRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private buildFilters(options: LeadListOptions) {
    const filters: SQL[] = [];
    if (options.status && options.status !== 'all') {
      filters.push(eq(leads.status, options.status));
    }
    if (options.source) filters.push(eq(leads.source, options.source));
    if (options.phone) filters.push(eq(leads.phone, options.phone));
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
    const leadPlanMap = new Map<bigint, LeadFloorPlanRecord[]>();
    for (const link of links) {
      const plan = planMap.get(link.floorPlanId);
      if (!plan) continue;
      const values = leadPlanMap.get(link.leadId) ?? [];
      values.push(plan);
      leadPlanMap.set(link.leadId, values);
    }

    const staffIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          [row.assignedTo, row.promoterId].filter(
            (value): value is bigint => value !== null
          )
        )
      )
    );
    const staffRows =
      staffIds.length > 0
        ? await this.transaction
            .select({
              id: adminUsers.id,
              displayName: adminUsers.displayName,
              username: adminUsers.username,
              role: adminUsers.role,
            })
            .from(adminUsers)
            .where(inArray(adminUsers.id, staffIds))
        : [];
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));

    return rows.map((row) => ({
      ...row,
      floorPlanRecords: leadPlanMap.get(row.id) ?? [],
      primaryFloorPlanRecord: row.primaryFloorPlanId
        ? planMap.get(row.primaryFloorPlanId) ?? null
        : null,
      assignedUser: row.assignedTo
        ? staffMap.get(row.assignedTo) ?? null
        : null,
      promoter: row.promoterId ? staffMap.get(row.promoterId) ?? null : null,
    }));
  }

  async list(options: LeadListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt), desc(leads.id))
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

  async create(input: NewLead) {
    const rows = await this.transaction.insert(leads).values(input).returning();
    return rows[0];
  }

  async update(id: bigint, input: LeadUpdate) {
    const rows = await this.transaction
      .update(leads)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    if (!rows[0]) return null;
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
        .limit(1),
      this.transaction
        .select()
        .from(floorPlans)
        .where(eq(floorPlans.id, floorPlanId))
        .limit(1),
    ]);
    if (!lead[0] || !plan[0]) return null;
    if (lead[0].enterpriseId !== plan[0].enterpriseId) {
      throw new Error('Lead and floor plan belong to different enterprises');
    }

    await this.transaction
      .insert(leadFloorPlans)
      .values({ leadId, floorPlanId })
      .onConflictDoNothing();
    const rows = await this.transaction
      .update(leads)
      .set({
        primaryFloorPlanId: floorPlanId,
        status: status ?? (lead[0].status === 'new' ? 'measuring' : lead[0].status),
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

  async deleteWithFloorPlans(id: bigint) {
    const links = await this.transaction
      .select({ floorPlanId: leadFloorPlans.floorPlanId })
      .from(leadFloorPlans)
      .where(eq(leadFloorPlans.leadId, id));
    const deleted = await this.transaction
      .delete(leads)
      .where(eq(leads.id, id))
      .returning();
    if (!deleted[0]) return null;
    if (links.length > 0) {
      await this.transaction
        .delete(floorPlans)
        .where(inArray(floorPlans.id, links.map((link) => link.floorPlanId)));
    }
    return deleted[0];
  }
}
