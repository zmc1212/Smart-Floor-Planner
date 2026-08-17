import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { users, wechatIdentities } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { MiniProgramIdentityRepository } from './miniprogram-identity-repository';

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

  private withWechatOpenid(
    row: { user: UserRecord; identityOpenid: string | null } | undefined
  ) {
    return row
      ? { ...row.user, openid: row.identityOpenid || row.user.openid }
      : null;
  }

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
          ilike(wechatIdentities.openid, pattern),
          ilike(users.communityName, pattern)
        )
      : undefined;
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const [rows, totals] = await Promise.all([
      this.transaction
        .select({ user: users, identityOpenid: wechatIdentities.openid })
        .from(users)
        .leftJoin(
          wechatIdentities,
          eq(wechatIdentities.userId, users.id)
        )
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .offset((page - 1) * limit)
        .limit(limit),
      this.transaction
        .select({ value: count() })
        .from(users)
        .leftJoin(
          wechatIdentities,
          eq(wechatIdentities.userId, users.id)
        )
        .where(where),
    ]);
    return {
      rows: rows.map((row) => this.withWechatOpenid(row)!),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select({ user: users, identityOpenid: wechatIdentities.openid })
      .from(users)
      .leftJoin(wechatIdentities, eq(wechatIdentities.userId, users.id))
      .where(eq(users.id, id))
      .limit(1);
    return this.withWechatOpenid(rows[0]);
  }

  async findByOpenid(openid: string) {
    const rows = await this.transaction
      .select({ user: users, identityOpenid: wechatIdentities.openid })
      .from(users)
      .leftJoin(wechatIdentities, eq(wechatIdentities.userId, users.id))
      .where(
        or(eq(wechatIdentities.openid, openid), eq(users.openid, openid))
      )
      .limit(1);
    return this.withWechatOpenid(rows[0]);
  }

  async findByPhone(phone: string) {
    const rows = await this.transaction
      .select({ user: users, identityOpenid: wechatIdentities.openid })
      .from(users)
      .leftJoin(wechatIdentities, eq(wechatIdentities.userId, users.id))
      .where(eq(users.phone, phone))
      .orderBy(asc(users.id))
      .limit(1);
    return this.withWechatOpenid(rows[0]);
  }

  async findByPhoneInEnterprise(phone: string, enterpriseId: bigint | null) {
    const rows = await this.transaction
      .select({ user: users, identityOpenid: wechatIdentities.openid })
      .from(users)
      .leftJoin(wechatIdentities, eq(wechatIdentities.userId, users.id))
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
    return this.withWechatOpenid(rows[0]);
  }

  async create(input: NewUser) {
    const { openid, ...values } = input;
    const rows = await this.transaction
      .insert(users)
      .values({ ...values, openid: null })
      .returning();
    if (openid) {
      await new MiniProgramIdentityRepository(
        this.transaction
      ).attachWechatIdentity({ userId: rows[0].id, openid });
    }
    return { ...rows[0], openid: openid ?? null };
  }

  async update(id: bigint, input: UserUpdate) {
    const { openid, ...values } = input;
    const rows = await this.transaction
      .update(users)
      .set({
        ...values,
        ...(openid !== undefined ? { openid: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    if (!rows[0]) return null;
    if (openid !== undefined) {
      const identities = new MiniProgramIdentityRepository(this.transaction);
      if (openid) {
        await identities.attachWechatIdentity({ userId: id, openid });
      } else {
        await this.transaction
          .delete(wechatIdentities)
          .where(eq(wechatIdentities.userId, id));
      }
      await identities.bumpContextVersion(id);
    }
    return this.findById(id);
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return rows[0] ?? null;
  }
}
