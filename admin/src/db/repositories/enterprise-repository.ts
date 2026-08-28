import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { enterprises, enterpriseStatusEvents } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  resolveEnterpriseStatusTransition,
  type EnterpriseStatusAction,
} from '@/lib/enterprise-status';
import {
  escapeIlikePattern,
  platformEnterpriseSearchTerms,
} from '@/lib/miniprogram-platform-enterprises';

export type NewEnterprise = typeof enterprises.$inferInsert;
export type EnterpriseRecord = typeof enterprises.$inferSelect;
export type EnterpriseUpdate = Partial<
  Omit<NewEnterprise, 'id' | 'createdAt' | 'updatedAt'>
>;
export type EnterpriseStatusEventRecord =
  typeof enterpriseStatusEvents.$inferSelect;

export class EnterpriseRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async list() {
    return this.transaction
      .select()
      .from(enterprises)
      .orderBy(desc(enterprises.createdAt), desc(enterprises.id));
  }

  async listByStatus(status: string) {
    return this.listForPlatformReview({ status });
  }

  private buildPlatformReviewWhere(input: {
    status?: string | null;
    q?: string | null;
  } = {}) {
    const filters: SQL[] = [];
    if (input.status) {
      filters.push(eq(enterprises.status, input.status));
    }

    const terms = platformEnterpriseSearchTerms(input.q);
    if (terms.text) {
      const pattern = `%${escapeIlikePattern(terms.text)}%`;
      const textMatch = or(
        ilike(enterprises.name, pattern),
        ilike(enterprises.code, pattern),
        sql`(coalesce(${enterprises.contactPerson}->>'name', '')) ilike ${pattern} escape '\\'`,
        sql`(coalesce(${enterprises.contactPerson}->>'phone', '')) ilike ${pattern} escape '\\'`
      );
      if (terms.digits) {
        const digitPattern = `%${terms.digits}%`;
        const match = or(
          textMatch,
          sql`regexp_replace(coalesce(${enterprises.contactPerson}->>'phone', ''), '[^0-9]', '', 'g') like ${digitPattern}`
        );
        if (match) filters.push(match);
      } else if (textMatch) {
        filters.push(textMatch);
      }
    }

    return filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);
  }

  async listForPlatformReview(input: {
    status?: string | null;
    q?: string | null;
    page?: number;
    limit?: number;
  } = {}) {
    const where = this.buildPlatformReviewWhere(input);
    const query = this.transaction.select().from(enterprises);
    const ordered = (where ? query.where(where) : query).orderBy(
      desc(enterprises.createdAt),
      desc(enterprises.id)
    );
    const page = input.page != null ? Math.max(1, input.page) : null;
    const limit = input.limit != null ? Math.max(1, input.limit) : null;
    if (page != null && limit != null) {
      return ordered.offset((page - 1) * limit).limit(limit);
    }
    return ordered;
  }

  async countForPlatformReview(input: {
    status?: string | null;
    q?: string | null;
  } = {}) {
    const where = this.buildPlatformReviewWhere(input);
    const query = this.transaction.select({ value: count() }).from(enterprises);
    const rows = await (where ? query.where(where) : query);
    return Number(rows[0]?.value ?? 0);
  }

  async countByStatus(status: string) {
    const rows = await this.transaction
      .select({ value: sql<number>`count(*)::int` })
      .from(enterprises)
      .where(eq(enterprises.status, status));
    return Number(rows[0]?.value || 0);
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

  async listStatusEvents(enterpriseId: bigint, limit = 20) {
    return this.transaction
      .select()
      .from(enterpriseStatusEvents)
      .where(eq(enterpriseStatusEvents.enterpriseId, enterpriseId))
      .orderBy(
        desc(enterpriseStatusEvents.createdAt),
        desc(enterpriseStatusEvents.id)
      )
      .limit(limit);
  }

  async applyStatusAction(input: {
    enterpriseId: bigint;
    action: EnterpriseStatusAction | string;
    reason?: unknown;
    actorAdminId: bigint;
  }) {
    const current = await this.findById(input.enterpriseId);
    if (!current) return null;

    const transition = resolveEnterpriseStatusTransition({
      currentStatus: current.status,
      action: input.action,
      reason: input.reason,
    });

    const changedAt = new Date();
    const updated = await this.update(input.enterpriseId, {
      status: transition.toStatus,
      statusReason: transition.reason,
      statusChangedAt: changedAt,
      statusChangedByAdminId: input.actorAdminId,
    });
    if (!updated) return null;

    const [event] = await this.transaction
      .insert(enterpriseStatusEvents)
      .values({
        enterpriseId: input.enterpriseId,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        action: transition.action,
        reason: transition.reason,
        actorAdminId: input.actorAdminId,
        createdAt: changedAt,
      })
      .returning();

    return { enterprise: updated, event, transition };
  }
}
