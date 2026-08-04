import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewUser = typeof users.$inferInsert;
export type UserRecord = typeof users.$inferSelect;
export type UserUpdate = Partial<
  Omit<NewUser, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface UserListOptions {
  search?: string;
  page?: number;
  limit?: number;
}

export class UserRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list(options: UserListOptions = {}) {
    const normalized = options.search?.trim();
    const pattern = normalized
      ? `%${normalized.replace(/[%_]/g, '\\$&')}%`
      : null;
    const where = pattern
      ? or(
          ilike(users.nickname, pattern),
          ilike(users.phone, pattern),
          ilike(users.openid, pattern),
          ilike(users.communityName, pattern)
        )
      : undefined;
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const [rows, totals] = await Promise.all([
      this.transaction
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction.select({ value: count() }).from(users).where(where),
    ]);
    return {
      rows,
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOpenid(openid: string) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.openid, openid))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPhone(phone: string) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .orderBy(asc(users.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPhoneInEnterprise(phone: string, enterpriseId: bigint | null) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(
        and(
          eq(users.phone, phone),
          enterpriseId
            ? eq(users.enterpriseId, enterpriseId)
            : isNull(users.enterpriseId)
        )
      )
      .orderBy(asc(users.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewUser) {
    const rows = await this.transaction.insert(users).values(input).returning();
    return rows[0];
  }

  async update(id: bigint, input: UserUpdate) {
    const rows = await this.transaction
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return rows[0] ?? null;
  }
}
