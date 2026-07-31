import { eq } from 'drizzle-orm';
import { enterprises } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewEnterprise = typeof enterprises.$inferInsert;
export type EnterpriseRecord = typeof enterprises.$inferSelect;

export class EnterpriseRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(enterprises)
      .where(eq(enterprises.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByCode(code: string) {
    const rows = await this.transaction
      .select()
      .from(enterprises)
      .where(eq(enterprises.code, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewEnterprise) {
    const rows = await this.transaction
      .insert(enterprises)
      .values(input)
      .returning();
    return rows[0];
  }
}
