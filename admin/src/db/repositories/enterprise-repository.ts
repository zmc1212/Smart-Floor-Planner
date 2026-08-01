import { asc, desc, eq, or } from 'drizzle-orm';
import { enterprises } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewEnterprise = typeof enterprises.$inferInsert;
export type EnterpriseRecord = typeof enterprises.$inferSelect;
export type EnterpriseUpdate = Partial<
  Omit<NewEnterprise, 'id' | 'createdAt' | 'updatedAt'>
>;

export class EnterpriseRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list() {
    return this.transaction
      .select()
      .from(enterprises)
      .orderBy(desc(enterprises.createdAt), desc(enterprises.id));
  }

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

  async findByNameOrCode(name: string, code: string) {
    const rows = await this.transaction
      .select()
      .from(enterprises)
      .where(or(eq(enterprises.name, name), eq(enterprises.code, code)))
      .orderBy(asc(enterprises.id))
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

  async update(id: bigint, input: EnterpriseUpdate) {
    const rows = await this.transaction
      .update(enterprises)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(enterprises.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(enterprises)
      .where(eq(enterprises.id, id))
      .returning({ id: enterprises.id });
    return rows[0] ?? null;
  }
}
