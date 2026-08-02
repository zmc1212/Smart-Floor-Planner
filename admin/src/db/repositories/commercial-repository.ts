import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  adminUsers,
  commissionRecords,
  enterpriseOrders,
  enterprises,
  promotionEnterpriseRecords,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type EnterpriseOrderRecord = typeof enterpriseOrders.$inferSelect;
export type NewEnterpriseOrder = typeof enterpriseOrders.$inferInsert;
export type EnterpriseOrderUpdate = Partial<
  Omit<NewEnterpriseOrder, 'id' | 'createdAt' | 'updatedAt'>
>;
export type CommissionRecord = typeof commissionRecords.$inferSelect;
export type NewCommissionRecord = typeof commissionRecords.$inferInsert;

type StaffSummary = { id: bigint; displayName: string; username: string; role: string };

export interface EnterpriseOrderWithRelations extends EnterpriseOrderRecord {
  record: { id: bigint; enterpriseName: string; businessStage: string; promoterId: bigint | null } | null;
  createdByUser: StaffSummary | null;
}

export interface CommissionWithRelations extends CommissionRecord {
  promoter: StaffSummary | null;
  record: { id: bigint; enterpriseName: string; contactPerson: string } | null;
  order: Pick<EnterpriseOrderRecord, 'id' | 'packageName' | 'amount' | 'status'> | null;
}

export class CommercialRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async attachOrders(rows: EnterpriseOrderRecord[]): Promise<EnterpriseOrderWithRelations[]> {
    if (!rows.length) return [];
    const recordIds = Array.from(new Set(rows.map((row) => row.recordId)));
    const creatorIds = Array.from(
      new Set(rows.map((row) => row.createdBy).filter((id): id is bigint => id !== null))
    );
    const [records, creators] = await Promise.all([
      this.transaction
        .select({
          id: promotionEnterpriseRecords.id,
          enterpriseName: promotionEnterpriseRecords.enterpriseName,
          businessStage: promotionEnterpriseRecords.businessStage,
          promoterId: promotionEnterpriseRecords.promoterId,
        })
        .from(promotionEnterpriseRecords)
        .where(inArray(promotionEnterpriseRecords.id, recordIds)),
      creatorIds.length
        ? this.transaction
            .select({ id: adminUsers.id, displayName: adminUsers.displayName, username: adminUsers.username, role: adminUsers.role })
            .from(adminUsers)
            .where(inArray(adminUsers.id, creatorIds))
        : Promise.resolve([]),
    ]);
    const recordMap = new Map(records.map((record) => [record.id, record]));
    const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
    return rows.map((row) => ({
      ...row,
      record: recordMap.get(row.recordId) ?? null,
      createdByUser: row.createdBy ? creatorMap.get(row.createdBy) ?? null : null,
    }));
  }

  private async attachCommissions(rows: CommissionRecord[]): Promise<CommissionWithRelations[]> {
    if (!rows.length) return [];
    const promoterIds = Array.from(new Set(rows.map((row) => row.promoterId)));
    const recordIds = Array.from(new Set(rows.map((row) => row.recordId)));
    const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
    const [promoters, records, orders] = await Promise.all([
      this.transaction
        .select({ id: adminUsers.id, displayName: adminUsers.displayName, username: adminUsers.username, role: adminUsers.role })
        .from(adminUsers)
        .where(inArray(adminUsers.id, promoterIds)),
      this.transaction
        .select({ id: promotionEnterpriseRecords.id, enterpriseName: promotionEnterpriseRecords.enterpriseName, contactPerson: promotionEnterpriseRecords.contactPerson })
        .from(promotionEnterpriseRecords)
        .where(inArray(promotionEnterpriseRecords.id, recordIds)),
      this.transaction
        .select({ id: enterpriseOrders.id, packageName: enterpriseOrders.packageName, amount: enterpriseOrders.amount, status: enterpriseOrders.status })
        .from(enterpriseOrders)
        .where(inArray(enterpriseOrders.id, orderIds)),
    ]);
    const promoterMap = new Map(promoters.map((row) => [row.id, row]));
    const recordMap = new Map(records.map((row) => [row.id, row]));
    const orderMap = new Map(orders.map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...row,
      promoter: promoterMap.get(row.promoterId) ?? null,
      record: recordMap.get(row.recordId) ?? null,
      order: orderMap.get(row.orderId) ?? null,
    }));
  }

  async listOrders(options: { promoterId?: bigint; enterpriseId?: bigint | null } = {}) {
    const filters = [];
    if (options.enterpriseId !== undefined) {
      filters.push(options.enterpriseId === null ? isNull(enterpriseOrders.enterpriseId) : eq(enterpriseOrders.enterpriseId, options.enterpriseId));
    }
    if (options.promoterId) {
      filters.push(sql`${enterpriseOrders.recordId} in (select id from app.promotion_enterprise_records where promoter_id = ${options.promoterId})`);
    }
    const rows = await this.transaction.select().from(enterpriseOrders)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(enterpriseOrders.createdAt), desc(enterpriseOrders.id));
    return this.attachOrders(rows);
  }

  async findOrderById(id: bigint) {
    const rows = await this.transaction.select().from(enterpriseOrders).where(eq(enterpriseOrders.id, id)).limit(1);
    return (await this.attachOrders(rows))[0] ?? null;
  }

  async createOrder(input: NewEnterpriseOrder) {
    const rows = await this.transaction.insert(enterpriseOrders).values(input).returning();
    return (await this.attachOrders(rows))[0];
  }

  async updateOrder(id: bigint, input: EnterpriseOrderUpdate) {
    const rows = await this.transaction.update(enterpriseOrders)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(enterpriseOrders.id, id)).returning();
    return (await this.attachOrders(rows))[0] ?? null;
  }

  async upsertCommission(input: NewCommissionRecord) {
    const rows = await this.transaction.insert(commissionRecords).values(input)
      .onConflictDoUpdate({
        target: commissionRecords.orderId,
        set: { ...input, updatedAt: new Date() },
      }).returning();
    return (await this.attachCommissions(rows))[0];
  }

  async voidCommissionForOrder(orderId: bigint, settledBy: bigint) {
    const rows = await this.transaction.update(commissionRecords)
      .set({ status: 'voided', settledBy, settledAt: new Date(), updatedAt: new Date() })
      .where(eq(commissionRecords.orderId, orderId)).returning();
    return (await this.attachCommissions(rows))[0] ?? null;
  }

  async listCommissions(options: { status?: string; promoterId?: bigint } = {}) {
    const filters = [];
    if (options.status) filters.push(eq(commissionRecords.status, options.status));
    if (options.promoterId) filters.push(eq(commissionRecords.promoterId, options.promoterId));
    const rows = await this.transaction.select().from(commissionRecords)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(commissionRecords.createdAt), desc(commissionRecords.id));
    return this.attachCommissions(rows);
  }

  async findCommissionById(id: bigint) {
    const rows = await this.transaction.select().from(commissionRecords).where(eq(commissionRecords.id, id)).limit(1);
    return (await this.attachCommissions(rows))[0] ?? null;
  }

  async updateCommission(id: bigint, values: Partial<NewCommissionRecord>) {
    const rows = await this.transaction.update(commissionRecords)
      .set({ ...values, updatedAt: new Date() }).where(eq(commissionRecords.id, id)).returning();
    return (await this.attachCommissions(rows))[0] ?? null;
  }

  async commissionSummary(options: { status?: string; promoterId?: bigint } = {}) {
    const filters = [];
    if (options.status) filters.push(eq(commissionRecords.status, options.status));
    if (options.promoterId) filters.push(eq(commissionRecords.promoterId, options.promoterId));
    const rows = await this.transaction.select({ status: commissionRecords.status, amount: sql<string>`coalesce(sum(${commissionRecords.commissionAmount}), 0)`, count: sql<number>`count(*)` })
      .from(commissionRecords).where(filters.length ? and(...filters) : undefined).groupBy(commissionRecords.status);
    return Object.fromEntries(rows.map((row) => [row.status, { amount: Number(row.amount), count: Number(row.count) }]));
  }

  async activateRecord(recordId: bigint, enterpriseId: bigint, orderId?: bigint) {
    await this.transaction.update(promotionEnterpriseRecords)
      .set({ enterpriseId, businessStage: 'paid', pendingActionRole: 'none', nextFollowUpAt: null, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(promotionEnterpriseRecords.id, recordId));
    const orderFilter = orderId
      ? and(eq(enterpriseOrders.id, orderId), eq(enterpriseOrders.recordId, recordId))
      : and(eq(enterpriseOrders.recordId, recordId), isNull(enterpriseOrders.enterpriseId));
    await this.transaction.update(enterpriseOrders).set({ enterpriseId, updatedAt: new Date() }).where(orderFilter);
  }

  async commissionCalculationContext(recordId: bigint) {
    const rows = await this.transaction.select({ record: promotionEnterpriseRecords, enterprise: enterprises, package: enterpriseOrders.packageName })
      .from(promotionEnterpriseRecords).leftJoin(enterprises, eq(promotionEnterpriseRecords.enterpriseId, enterprises.id))
      .leftJoin(enterpriseOrders, eq(enterpriseOrders.recordId, promotionEnterpriseRecords.id))
      .where(eq(promotionEnterpriseRecords.id, recordId)).limit(1);
    return rows[0] ?? null;
  }
}
