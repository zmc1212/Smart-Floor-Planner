import { and, desc, eq } from 'drizzle-orm';
import { inspirations } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type InspirationRecord = typeof inspirations.$inferSelect;
export type NewInspiration = typeof inspirations.$inferInsert;

export interface InspirationListOptions {
  style?: string;
  roomType?: string;
  isRecommended?: boolean;
  limit?: number;
}

export class InspirationRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list(options: InspirationListOptions = {}) {
    const filters = [
      ...(options.style ? [eq(inspirations.style, options.style)] : []),
      ...(options.roomType ? [eq(inspirations.roomType, options.roomType)] : []),
      ...(options.isRecommended !== undefined
        ? [eq(inspirations.isRecommended, options.isRecommended)]
        : []),
    ];
    const query = this.transaction
      .select()
      .from(inspirations)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(inspirations.createdAt), desc(inspirations.id));

    return options.limit ? query.limit(options.limit) : query;
  }

  async create(input: NewInspiration) {
    const rows = await this.transaction.insert(inspirations).values(input).returning();
    return rows[0];
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(inspirations)
      .where(eq(inspirations.id, id))
      .returning({ id: inspirations.id });
    return rows[0] ?? null;
  }
}
