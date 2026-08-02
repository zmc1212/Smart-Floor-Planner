import { and, asc, eq } from 'drizzle-orm';
import { aiStylePresets } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiStylePresetRecord = typeof aiStylePresets.$inferSelect;
export type NewAiStylePreset = typeof aiStylePresets.$inferInsert;
export type AiStylePresetUpdate = Partial<
  Omit<NewAiStylePreset, 'id' | 'createdAt' | 'updatedAt' | 'type' | 'key'>
>;

export class AiStylePresetRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async ensureDefaults(defaults: NewAiStylePreset[]) {
    if (defaults.length === 0) return;
    await this.transaction
      .insert(aiStylePresets)
      .values(defaults)
      .onConflictDoNothing({
        target: [aiStylePresets.type, aiStylePresets.key],
      });
  }

  list(options: { type?: string; includeDisabled?: boolean } = {}) {
    const filters = [
      ...(options.type ? [eq(aiStylePresets.type, options.type)] : []),
      ...(!options.includeDisabled ? [eq(aiStylePresets.enabled, true)] : []),
    ];
    return this.transaction
      .select()
      .from(aiStylePresets)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(aiStylePresets.sortOrder), asc(aiStylePresets.createdAt));
  }

  async findEnabledByTypeAndKey(type: string, key: string) {
    const rows = await this.transaction
      .select()
      .from(aiStylePresets)
      .where(
        and(
          eq(aiStylePresets.type, type),
          eq(aiStylePresets.key, key),
          eq(aiStylePresets.enabled, true)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiStylePresets)
      .where(eq(aiStylePresets.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(id: bigint, input: AiStylePresetUpdate) {
    const rows = await this.transaction
      .update(aiStylePresets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(aiStylePresets.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
