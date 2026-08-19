import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
} from 'drizzle-orm';
import {
  adminUserPromoters,
  adminUsers,
  departments,
  enterprises,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type NewAdminUser = typeof adminUsers.$inferInsert;
export type AdminUserRecord = typeof adminUsers.$inferSelect;
export type AdminUserUpdate = Partial<
  Omit<NewAdminUser, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface AdminUserWithRelations extends AdminUserRecord {
  enterpriseName: string | null;
  departmentName: string | null;
  promoterIds: bigint[];
}

interface ListAdminUsersOptions {
  roles?: string[];
  search?: string;
  status?: string;
  withoutEnterprise?: boolean;
  departmentId?: bigint | null;
  withoutDepartment?: boolean;
  page?: number;
  limit?: number;
}

export class AdminUserRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async attachPromoters<T extends AdminUserRecord>(
    rows: T[]
  ): Promise<Array<T & { promoterIds: bigint[] }>> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const relations = await this.transaction
      .select()
      .from(adminUserPromoters)
      .where(inArray(adminUserPromoters.adminUserId, ids))
      .orderBy(
        asc(adminUserPromoters.adminUserId),
        asc(adminUserPromoters.promoterId)
      );
    const promoterMap = new Map<bigint, bigint[]>();
    for (const relation of relations) {
      const values = promoterMap.get(relation.adminUserId) ?? [];
      values.push(relation.promoterId);
      promoterMap.set(relation.adminUserId, values);
    }
    return rows.map((row) => ({
      ...row,
      promoterIds: promoterMap.get(row.id) ?? [],
    }));
  }

  private buildFilters(options: ListAdminUsersOptions) {
    const filters = [];
    if (options.roles?.length) {
      filters.push(inArray(adminUsers.role, options.roles));
    }
    if (options.status) {
      filters.push(eq(adminUsers.status, options.status));
    }
    if (options.withoutEnterprise) {
      filters.push(isNull(adminUsers.enterpriseId));
    }
    if (options.withoutDepartment) {
      filters.push(isNull(adminUsers.departmentId));
    } else if (options.departmentId !== undefined && options.departmentId !== null) {
      filters.push(eq(adminUsers.departmentId, options.departmentId));
    }
    const search = options.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[%_]/g, '\\$&')}%`;
      filters.push(
        or(
          ilike(adminUsers.username, pattern),
          ilike(adminUsers.displayName, pattern)
        )!
      );
    }
    return filters.length > 0 ? and(...filters) : undefined;
  }

  async list(options: ListAdminUsersOptions = {}) {
    const where = this.buildFilters(options);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, options.limit ?? 20);
    const query = this.transaction
      .select({
        adminUser: adminUsers,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
      })
      .from(adminUsers)
      .leftJoin(enterprises, eq(adminUsers.enterpriseId, enterprises.id))
      .leftJoin(departments, eq(adminUsers.departmentId, departments.id))
      .where(where)
      .orderBy(desc(adminUsers.createdAt), desc(adminUsers.id))
      .offset((page - 1) * limit)
      .limit(limit);

    const [joinedRows, totalRows] = await Promise.all([
      query,
      this.transaction
        .select({ value: count() })
        .from(adminUsers)
        .where(where),
    ]);
    const records = await this.attachPromoters(
      joinedRows.map((row) => ({
        ...row.adminUser,
        enterpriseName: row.enterpriseName,
        departmentName: row.departmentName,
      })));

    return {
      rows: records as AdminUserWithRelations[],
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select({
        adminUser: adminUsers,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
      })
      .from(adminUsers)
      .leftJoin(enterprises, eq(adminUsers.enterpriseId, enterprises.id))
      .leftJoin(departments, eq(adminUsers.departmentId, departments.id))
      .where(eq(adminUsers.id, id))
      .limit(1);
    if (!rows[0]) return null;
    const [record] = await this.attachPromoters([
      {
        ...rows[0].adminUser,
        enterpriseName: rows[0].enterpriseName,
        departmentName: rows[0].departmentName,
      },
    ]);
    return record as AdminUserWithRelations;
  }

  async findLinkedUserId(id: bigint) {
    const rows = await this.transaction
      .select({ userId: adminUsers.userId })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .limit(1);
    return rows[0]?.userId ?? null;
  }

  async findByUsernameOrPhone(identifier: string, activeOnly = false) {
    const identityFilter = or(
      eq(adminUsers.username, identifier),
      eq(adminUsers.phone, identifier)
    )!;
    const rows = await this.transaction
      .select()
      .from(adminUsers)
      .where(
        activeOnly
          ? and(identityFilter, eq(adminUsers.status, 'active'))
          : identityFilter
      )
      .orderBy(asc(adminUsers.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOpenidOrPhone(openid: string, phone?: string | null) {
    const identityFilter = phone
      ? or(eq(adminUsers.openid, openid), eq(adminUsers.phone, phone))
      : eq(adminUsers.openid, openid);
    const rows = await this.transaction
      .select()
      .from(adminUsers)
      .where(and(eq(adminUsers.status, 'active'), identityFilter))
      .orderBy(asc(adminUsers.id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findDesignerForPromoter(promoterId: bigint) {
    const rows = await this.transaction
      .select({ adminUser: adminUsers })
      .from(adminUserPromoters)
      .innerJoin(
        adminUsers,
        eq(adminUserPromoters.adminUserId, adminUsers.id)
      )
      .where(
        and(
          eq(adminUserPromoters.promoterId, promoterId),
          eq(adminUsers.role, 'designer'),
          eq(adminUsers.status, 'active')
        )
      )
      .orderBy(asc(adminUsers.id))
      .limit(1);
    return rows[0]?.adminUser ?? null;
  }

  async existsWithPhone(phone: string, excludeId?: bigint) {
    const rows = await this.transaction
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(
        excludeId
          ? and(eq(adminUsers.phone, phone), ne(adminUsers.id, excludeId))
          : eq(adminUsers.phone, phone)
      )
      .limit(1);
    return rows.length > 0;
  }

  async existsWithUsername(username: string, excludeId?: bigint) {
    const rows = await this.transaction
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(
        excludeId
          ? and(eq(adminUsers.username, username), ne(adminUsers.id, excludeId))
          : eq(adminUsers.username, username)
      )
      .limit(1);
    return rows.length > 0;
  }

  async create(input: NewAdminUser, promoterIds: bigint[] = []) {
    const rows = await this.transaction
      .insert(adminUsers)
      .values(input)
      .returning();
    const created = rows[0];
    if (promoterIds.length > 0) {
      await this.transaction.insert(adminUserPromoters).values(
        promoterIds.map((promoterId) => ({
          adminUserId: created.id,
          promoterId,
        }))
      );
    }
    return { ...created, promoterIds };
  }

  async update(
    id: bigint,
    input: AdminUserUpdate,
    promoterIds?: bigint[]
  ) {
    const rows = await this.transaction
      .update(adminUsers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();
    if (!rows[0]) return null;
    if (promoterIds !== undefined) {
      await this.transaction
        .delete(adminUserPromoters)
        .where(eq(adminUserPromoters.adminUserId, id));
      if (promoterIds.length > 0) {
        await this.transaction.insert(adminUserPromoters).values(
          promoterIds.map((promoterId) => ({
            adminUserId: id,
            promoterId,
          }))
        );
      }
    }
    return {
      ...rows[0],
      promoterIds:
        promoterIds ??
        (
          await this.transaction
            .select({ promoterId: adminUserPromoters.promoterId })
            .from(adminUserPromoters)
            .where(eq(adminUserPromoters.adminUserId, id))
        ).map((row) => row.promoterId),
    };
  }

  async countByDepartment(departmentId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(adminUsers)
      .where(eq(adminUsers.departmentId, departmentId));
    return Number(rows[0]?.value ?? 0);
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(adminUsers)
      .where(eq(adminUsers.id, id))
      .returning({ id: adminUsers.id });
    return rows[0] ?? null;
  }
}
