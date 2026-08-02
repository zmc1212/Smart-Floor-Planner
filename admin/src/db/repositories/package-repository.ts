import { desc, eq } from 'drizzle-orm';
import { packages } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type PackageRecord = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
export type PackageUpdate = Partial<
  Omit<NewPackage, 'id' | 'createdAt' | 'updatedAt'>
>;

export class PackageRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list(status?: string | null) {
    return this.transaction
      .select()
      .from(packages)
      .where(status ? eq(packages.status, status) : undefined)
      .orderBy(desc(packages.createdAt), desc(packages.id));
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(packages)
      .where(eq(packages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewPackage) {
    const rows = await this.transaction
      .insert(packages)
      .values(input)
      .returning();
    return rows[0];
  }

  async update(id: bigint, values: PackageUpdate) {
    const rows = await this.transaction
      .update(packages)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(packages.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(packages)
      .where(eq(packages.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
