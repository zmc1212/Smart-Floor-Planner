import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  floorPlans,
  leadFloorPlans,
  leads,
  users,
  wechatIdentities,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewFloorPlan = typeof floorPlans.$inferInsert;
export type FloorPlanRecord = typeof floorPlans.$inferSelect;
export type FloorPlanUpdate = Partial<
  Omit<NewFloorPlan, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface FloorPlanCreatorSummary {
  id: bigint;
  nickname: string | null;
  avatar: string | null;
  openid: string | null;
  communityName: string | null;
  phone: string | null;
}

export interface FloorPlanWithCreator extends FloorPlanRecord {
  creator: FloorPlanCreatorSummary | null;
}

export interface FloorPlanListOptions {
  ids?: bigint[];
  creatorId?: bigint;
  staffId?: bigint;
  status?: string;
  phone?: string;
  search?: string;
  formalOnly?: boolean;
  completedFrom?: Date;
  completedBefore?: Date;
  page?: number;
  limit?: number;
}

export class FloorPlanRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private buildFilters(options: FloorPlanListOptions) {
    const filters: SQL[] = [];
    if (options.ids) {
      if (options.ids.length === 0) return sql`false`;
      filters.push(inArray(floorPlans.id, options.ids));
    }
    if (options.creatorId) filters.push(eq(floorPlans.creatorId, options.creatorId));
    if (options.staffId) filters.push(eq(floorPlans.staffId, options.staffId));
    if (options.status) filters.push(eq(floorPlans.status, options.status));
    if (options.phone) filters.push(eq(users.phone, options.phone));
    if (options.search?.trim()) {
      filters.push(ilike(floorPlans.name, `%${options.search.trim().replace(/[%_]/g, '\\$&')}%`));
    }
    if (options.formalOnly) {
      filters.push(sql`${floorPlans.layoutData} ->> 'version' = '4'`);
      filters.push(sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`);
      filters.push(sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`);
    }
    if (options.completedFrom) {
      filters.push(gte(floorPlans.completedAt, options.completedFrom));
    }
    if (options.completedBefore) {
      filters.push(lt(floorPlans.completedAt, options.completedBefore));
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  private selectWithCreator() {
    return this.transaction
      .select({
        floorPlan: floorPlans,
        creator: {
          id: users.id,
          nickname: users.nickname,
          avatar: users.avatar,
          openid: sql<string | null>`coalesce(${wechatIdentities.openid}, ${users.openid})`,
          communityName: users.communityName,
          phone: users.phone,
        },
      })
      .from(floorPlans)
      .leftJoin(users, eq(floorPlans.creatorId, users.id))
      .leftJoin(wechatIdentities, eq(wechatIdentities.userId, users.id));
  }

  private normalizeRows(
    rows: Array<{
      floorPlan: FloorPlanRecord;
      creator: FloorPlanCreatorSummary | null;
    }>
  ): FloorPlanWithCreator[] {
    return rows.map((row) => ({ ...row.floorPlan, creator: row.creator }));
  }

  async list(options: FloorPlanListOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const [rows, totals] = await Promise.all([
      this.selectWithCreator()
        .where(where)
        .orderBy(desc(floorPlans.updatedAt), desc(floorPlans.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(floorPlans)
        .leftJoin(users, eq(floorPlans.creatorId, users.id))
        .where(where),
    ]);
    return {
      rows: this.normalizeRows(rows),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async listRecent(options: FloorPlanListOptions, limit = 3) {
    const rows = await this.selectWithCreator()
      .where(this.buildFilters(options))
      .orderBy(desc(floorPlans.updatedAt), desc(floorPlans.id))
      .limit(limit);
    return this.normalizeRows(rows);
  }

  async count(options: FloorPlanListOptions = {}) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(floorPlans)
      .leftJoin(users, eq(floorPlans.creatorId, users.id))
      .where(this.buildFilters(options));
    return Number(rows[0]?.value ?? 0);
  }

  async countByCreatorIds(creatorIds: bigint[]) {
    if (creatorIds.length === 0) return new Map<bigint, number>();
    const rows = await this.transaction
      .select({ creatorId: floorPlans.creatorId, value: count() })
      .from(floorPlans)
      .where(inArray(floorPlans.creatorId, creatorIds))
      .groupBy(floorPlans.creatorId);
    return new Map(rows.map((row) => [row.creatorId, Number(row.value)]));
  }

  async findById(id: bigint) {
    const rows = await this.selectWithCreator()
      .where(eq(floorPlans.id, id))
      .limit(1);
    return rows[0] ? this.normalizeRows(rows)[0] : null;
  }

  async findByExternalSource(
    enterpriseId: bigint | null,
    provider: string,
    externalId: string
  ) {
    const enterpriseFilter = enterpriseId
      ? eq(floorPlans.enterpriseId, enterpriseId)
      : sql`${floorPlans.enterpriseId} is null`;
    const rows = await this.selectWithCreator()
      .where(
        and(
          enterpriseFilter,
          sql`${floorPlans.externalSource} ->> 'provider' = ${provider}`,
          sql`${floorPlans.externalSource} ->> 'externalId' = ${externalId}`
        )
      )
      .limit(1);
    return rows[0] ? this.normalizeRows(rows)[0] : null;
  }

  async findByCreateIdempotencyKey(key: string) {
    const rows = await this.selectWithCreator()
      .where(eq(floorPlans.createIdempotencyKey, key))
      .limit(1);
    return rows[0] ? this.normalizeRows(rows)[0] : null;
  }

  async create(input: NewFloorPlan) {
    const rows = await this.transaction
      .insert(floorPlans)
      .values(input)
      .returning();
    return this.findById(rows[0].id);
  }

  async createIdempotent(input: NewFloorPlan) {
    if (!input.createIdempotencyKey) {
      const plan = await this.create(input);
      return { plan, created: true };
    }
    const rows = await this.transaction
      .insert(floorPlans)
      .values(input)
      .onConflictDoNothing({ target: floorPlans.createIdempotencyKey })
      .returning({ id: floorPlans.id });
    if (rows[0]) {
      return { plan: await this.findById(rows[0].id), created: true };
    }
    return {
      plan: await this.findByCreateIdempotencyKey(input.createIdempotencyKey),
      created: false,
    };
  }

  async update(id: bigint, input: FloorPlanUpdate) {
    const rows = await this.transaction
      .update(floorPlans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(floorPlans.id, id))
      .returning({ id: floorPlans.id });
    return rows[0] ? this.findById(rows[0].id) : null;
  }

  async delete(id: bigint) {
    await this.transaction
      .update(leads)
      .set({ primaryFloorPlanId: null, updatedAt: new Date() })
      .where(eq(leads.primaryFloorPlanId, id));
    await this.transaction
      .delete(leadFloorPlans)
      .where(eq(leadFloorPlans.floorPlanId, id));
    const rows = await this.transaction
      .delete(floorPlans)
      .where(eq(floorPlans.id, id))
      .returning({ id: floorPlans.id });
    return rows[0] ?? null;
  }
}
