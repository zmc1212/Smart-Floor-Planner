import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  adminUsers,
  enterprises,
  referrerEnterpriseMemberships,
  referrerProfiles,
  users,
  wechatIdentities,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type MiniProgramIdentityMode = 'customer' | 'staff' | 'referrer';

export interface MiniProgramIdentityContextRecord {
  mode: MiniProgramIdentityMode;
  enterpriseId: bigint | null;
  enterpriseName: string | null;
  staffId: bigint | null;
  staffRole: string | null;
  staffDisplayName: string | null;
  referrerMembershipId: bigint | null;
}

export interface SelectMiniProgramIdentityContextInput {
  mode: MiniProgramIdentityMode;
  enterpriseId?: bigint | null;
  staffId?: bigint | null;
  referrerMembershipId?: bigint | null;
}

export interface ActiveStaffLookupOptions {
  enterpriseId?: bigint | null;
  staffId?: bigint;
}

export type MiniProgramIdentityUser = typeof users.$inferSelect;
export type MiniProgramWechatIdentity = typeof wechatIdentities.$inferSelect;

export class MiniProgramIdentityRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findUserById(userId: bigint) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOpenid(openid: string) {
    const rows = await this.transaction
      .select({ user: users, identity: wechatIdentities })
      .from(wechatIdentities)
      .innerJoin(users, eq(wechatIdentities.userId, users.id))
      .where(eq(wechatIdentities.openid, openid))
      .limit(1);
    return rows[0] ?? null;
  }

  async findWechatIdentityByUserId(userId: bigint) {
    const rows = await this.transaction
      .select()
      .from(wechatIdentities)
      .where(eq(wechatIdentities.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  private filterActiveStaffMatches(
    rows: Array<typeof adminUsers.$inferSelect>,
    options?: ActiveStaffLookupOptions
  ) {
    let matched = rows;
    if (options?.staffId !== undefined) {
      matched = matched.filter((row) => row.id === options.staffId);
    }
    if (options && Object.prototype.hasOwnProperty.call(options, 'enterpriseId')) {
      matched = matched.filter((row) =>
        options.enterpriseId === null || options.enterpriseId === undefined
          ? row.enterpriseId === null
          : row.enterpriseId === options.enterpriseId
      );
    }
    return matched;
  }

  private resolveSingleActiveStaff(
    rows: Array<typeof adminUsers.$inferSelect>,
    options?: ActiveStaffLookupOptions
  ) {
    const matched = this.filterActiveStaffMatches(rows, options);
    if (matched.length === 0) return null;
    if (matched.length === 1) return matched[0];
    throw Object.assign(new Error('Multiple admin users match this identity'), {
      code: 'AMBIGUOUS_ADMIN_USER',
    });
  }

  async listActiveStaffByUserId(userId: bigint) {
    return this.transaction
      .select()
      .from(adminUsers)
      .where(
        and(eq(adminUsers.userId, userId), eq(adminUsers.status, 'active'))
      )
      .orderBy(asc(adminUsers.id));
  }

  async findActiveStaffByUserId(
    userId: bigint,
    options?: ActiveStaffLookupOptions
  ) {
    const rows = await this.listActiveStaffByUserId(userId);
    return this.resolveSingleActiveStaff(rows, options);
  }

  async listActiveStaffByPhone(phone: string) {
    return this.transaction
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.phone, phone), eq(adminUsers.status, 'active')))
      .orderBy(asc(adminUsers.id));
  }

  async findActiveStaffByPhone(
    phone: string,
    options?: ActiveStaffLookupOptions
  ) {
    const rows = await this.listActiveStaffByPhone(phone);
    return this.resolveSingleActiveStaff(rows, options);
  }

  async ensureStaffUser(staff: typeof adminUsers.$inferSelect) {
    if (staff.userId) {
      const linked = await this.findUserById(staff.userId);
      if (linked) return linked;
    }

    let user: MiniProgramIdentityUser | null = null;
    if (staff.openid) {
      user = (await this.findByOpenid(staff.openid))?.user ?? null;
    }
    if (!user && staff.phone) {
      const rows = await this.transaction
        .select()
        .from(users)
        .where(eq(users.phone, staff.phone))
        .orderBy(asc(users.id))
        .limit(1);
      user = rows[0] ?? null;
    }
    if (!user) {
      const rows = await this.transaction
        .insert(users)
        .values({
          phone: staff.phone,
          nickname: staff.displayName || staff.username,
          role: 'staff',
        })
        .returning();
      user = rows[0];
    }

    await this.transaction
      .update(adminUsers)
      .set({ userId: user.id, updatedAt: new Date() })
      .where(eq(adminUsers.id, staff.id));
    return user;
  }

  async attachWechatIdentity(input: {
    userId: bigint;
    openid: string;
    unionid?: string | null;
  }) {
    const existing = await this.findByOpenid(input.openid);
    if (existing && existing.user.id !== input.userId) {
      throw new Error('WECHAT_IDENTITY_ALREADY_LINKED');
    }
    const existingForUser = await this.findWechatIdentityByUserId(input.userId);
    if (existingForUser && existingForUser.openid !== input.openid) {
      throw new Error('WECHAT_USER_ALREADY_LINKED');
    }

    await this.transaction
      .insert(wechatIdentities)
      .values(input)
      .onConflictDoUpdate({
        target: wechatIdentities.userId,
        set: {
          ...(input.unionid !== undefined
            ? { unionid: input.unionid }
            : {}),
          updatedAt: new Date(),
        },
      });
    return (await this.findByOpenid(input.openid))!.identity;
  }

  private async linkActiveStaffPhoneToUser(phone: string, userId: bigint) {
    const staffRows = await this.listActiveStaffByPhone(phone);
    for (const staff of staffRows) {
      if (staff.userId && staff.userId !== userId) {
        throw new Error('STAFF_PHONE_LINKED_TO_OTHER_USER');
      }
    }
    const unlinkedIds = staffRows
      .filter((staff) => !staff.userId)
      .map((staff) => staff.id);
    if (unlinkedIds.length === 0) return staffRows[0] ?? null;
    await this.transaction
      .update(adminUsers)
      .set({ userId, updatedAt: new Date() })
      .where(inArray(adminUsers.id, unlinkedIds));
    return staffRows[0] ?? null;
  }

  async resolveWechatPhoneUser(input: {
    openid: string;
    unionid?: string | null;
    phone: string;
  }) {
    const byOpenid = await this.findByOpenid(input.openid);
    if (byOpenid) {
      const rows = await this.transaction
        .update(users)
        .set({ phone: input.phone, updatedAt: new Date() })
        .where(eq(users.id, byOpenid.user.id))
        .returning();
      if (input.unionid && byOpenid.identity.unionid !== input.unionid) {
        await this.transaction
          .update(wechatIdentities)
          .set({ unionid: input.unionid, updatedAt: new Date() })
          .where(eq(wechatIdentities.id, byOpenid.identity.id));
      }
      await this.linkActiveStaffPhoneToUser(input.phone, byOpenid.user.id);
      return rows[0];
    }

    const staffRows = await this.listActiveStaffByPhone(input.phone);
    let user =
      staffRows[0] != null ? await this.ensureStaffUser(staffRows[0]) : null;
    if (!user) {
      const existingUsers = await this.transaction
        .select()
        .from(users)
        .where(eq(users.phone, input.phone))
        .orderBy(asc(users.id))
        .limit(1);
      user = existingUsers[0] ?? null;
    }
    if (!user) {
      const created = await this.transaction
        .insert(users)
        .values({ phone: input.phone, role: 'user' })
        .returning();
      user = created[0];
    }

    await this.linkActiveStaffPhoneToUser(input.phone, user.id);
    await this.attachWechatIdentity({
      userId: user.id,
      openid: input.openid,
      unionid: input.unionid,
    });
    return user;
  }

  async listContexts(userId: bigint): Promise<MiniProgramIdentityContextRecord[]> {
    const contexts: MiniProgramIdentityContextRecord[] = [
      {
        mode: 'customer',
        enterpriseId: null,
        enterpriseName: null,
        staffId: null,
        staffRole: null,
        staffDisplayName: null,
        referrerMembershipId: null,
      },
    ];

    const staffRows = await this.transaction
      .select({ staff: adminUsers, enterpriseName: enterprises.name })
      .from(adminUsers)
      .leftJoin(enterprises, eq(adminUsers.enterpriseId, enterprises.id))
      .where(
        and(eq(adminUsers.userId, userId), eq(adminUsers.status, 'active'))
      )
      .orderBy(asc(adminUsers.id));
    contexts.push(
      ...staffRows.map(({ staff, enterpriseName }) => ({
        mode: 'staff' as const,
        enterpriseId: staff.enterpriseId,
        enterpriseName,
        staffId: staff.id,
        staffRole: staff.role,
        staffDisplayName: staff.displayName || staff.username,
        referrerMembershipId: null,
      }))
    );

    const membershipRows = await this.transaction
      .select({
        membership: referrerEnterpriseMemberships,
        enterpriseName: enterprises.name,
      })
      .from(referrerProfiles)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id)
      )
      .innerJoin(
        enterprises,
        eq(referrerEnterpriseMemberships.enterpriseId, enterprises.id)
      )
      .where(
        and(
          eq(referrerProfiles.userId, userId),
          eq(referrerProfiles.status, 'active'),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      )
      .orderBy(
        asc(referrerEnterpriseMemberships.enterpriseId),
        asc(referrerEnterpriseMemberships.id)
      );
    contexts.push(
      ...membershipRows.map(({ membership, enterpriseName }) => ({
        mode: 'referrer' as const,
        enterpriseId: membership.enterpriseId,
        enterpriseName,
        staffId: null,
        staffRole: null,
        staffDisplayName: null,
        referrerMembershipId: membership.id,
      }))
    );
    return contexts;
  }

  async selectContext(
    userId: bigint,
    input: SelectMiniProgramIdentityContextInput
  ) {
    const contexts = await this.listContexts(userId);
    return (
      contexts.find((context) => {
        if (context.mode !== input.mode) return false;
        if (context.mode === 'customer') return true;
        if (context.mode === 'staff') {
          return (
            input.staffId === undefined || context.staffId === input.staffId
          );
        }
        return (
          context.referrerMembershipId === input.referrerMembershipId &&
          (input.enterpriseId === undefined ||
            context.enterpriseId === input.enterpriseId)
        );
      }) ?? null
    );
  }

  async bumpContextVersion(userId: bigint) {
    const rows = await this.transaction
      .update(users)
      .set({
        contextVersion: sql`${users.contextVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ contextVersion: users.contextVersion });
    return rows[0]?.contextVersion ?? null;
  }
}
