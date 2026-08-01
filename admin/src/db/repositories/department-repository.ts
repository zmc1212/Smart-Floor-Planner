import { and, asc, eq, isNull } from 'drizzle-orm';
import { departments } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewDepartment = typeof departments.$inferInsert;
export type DepartmentRecord = typeof departments.$inferSelect;
export type DepartmentUpdate = Partial<
  Pick<NewDepartment, 'name' | 'parentId' | 'order'>
>;

export class DepartmentRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list(parentId: bigint | null = null) {
    return this.transaction
      .select()
      .from(departments)
      .where(
        parentId === null
          ? isNull(departments.parentId)
          : eq(departments.parentId, parentId)
      )
      .orderBy(asc(departments.order), asc(departments.id));
  }

  async listAll() {
    return this.transaction
      .select()
      .from(departments)
      .orderBy(asc(departments.order), asc(departments.createdAt), asc(departments.id));
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(departments)
      .where(eq(departments.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByName(enterpriseId: bigint, name: string) {
    const rows = await this.transaction
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.enterpriseId, enterpriseId),
          eq(departments.name, name)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewDepartment) {
    const rows = await this.transaction
      .insert(departments)
      .values(input)
      .returning();
    return rows[0];
  }

  async update(id: bigint, input: DepartmentUpdate) {
    const rows = await this.transaction
      .update(departments)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async countChildren(id: bigint) {
    const rows = await this.transaction
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.parentId, id));
    return rows.length;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(departments)
      .where(eq(departments.id, id))
      .returning({ id: departments.id });
    return rows[0] ?? null;
  }
}
