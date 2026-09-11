import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { designReports, leads } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export class DesignReportRepository {
  constructor(private readonly tx: PostgresTransaction) {}
  async find(id: bigint, lock = false) {
    const query = this.tx.select().from(designReports).where(eq(designReports.id, id)).limit(1);
    const rows = await (lock ? query.for('update') : query);
    return rows[0] ?? null;
  }
  async list(staffId?: bigint, leadId?: bigint) {
    return this.tx.select({ report: designReports, customer: leads.name }).from(designReports)
      .innerJoin(leads, eq(leads.id, designReports.leadId))
      .where(and(isNull(leads.archivedAt), ne(leads.status, 'closed'), staffId ? eq(leads.assignedTo, staffId) : undefined, leadId ? eq(leads.id, leadId) : undefined))
      .orderBy(desc(designReports.updatedAt)).limit(100);
  }
  async create(input: typeof designReports.$inferInsert) { return (await this.tx.insert(designReports).values(input).returning())[0]; }
  async update(id: bigint, input: Partial<typeof designReports.$inferInsert>) {
    return (await this.tx.update(designReports).set({ ...input, updatedAt: new Date() }).where(eq(designReports.id, id)).returning())[0];
  }
  async findShared(token: string) {
    return (await this.tx.select().from(designReports).where(eq(designReports.shareToken, token)).limit(1))[0] ?? null;
  }
}
