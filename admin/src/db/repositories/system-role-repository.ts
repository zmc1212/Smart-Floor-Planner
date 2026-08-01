import { asc, eq } from 'drizzle-orm';
import { systemRoles } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type SystemRoleRecord = typeof systemRoles.$inferSelect;
export type NewSystemRole = typeof systemRoles.$inferInsert;

export class SystemRoleRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list() {
    return this.transaction
      .select()
      .from(systemRoles)
      .orderBy(asc(systemRoles.createdAt), asc(systemRoles.id));
  }

  async findByRoleKey(roleKey: string) {
    const rows = await this.transaction
      .select()
      .from(systemRoles)
      .where(eq(systemRoles.roleKey, roleKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async ensureDefaults(defaults: NewSystemRole[]) {
    if (defaults.length === 0) {
      return;
    }

    await this.transaction
      .insert(systemRoles)
      .values(defaults)
      .onConflictDoNothing({ target: systemRoles.roleKey });
  }

  async updateMenuKeys(id: bigint, menuKeys: string[]) {
    const rows = await this.transaction
      .update(systemRoles)
      .set({ menuKeys, updatedAt: new Date() })
      .where(eq(systemRoles.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
