import { and, asc, eq, inArray } from 'drizzle-orm';
import { aiProviderAttempts, aiProviderConfigs } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect;
export type NewAiProviderConfig = typeof aiProviderConfigs.$inferInsert;
export type AiProviderConfigUpdate = Partial<
  Omit<NewAiProviderConfig, 'id' | 'key' | 'createdAt' | 'updatedAt'>
>;

export class AiProviderConfigRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list() {
    return this.transaction
      .select()
      .from(aiProviderConfigs)
      .orderBy(asc(aiProviderConfigs.priority), asc(aiProviderConfigs.createdAt));
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKey(key: string) {
    const rows = await this.transaction
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async listEnabled(options: { capability?: string; adapterType?: string } = {}) {
    const filters = [eq(aiProviderConfigs.enabled, true)];
    if (options.adapterType) {
      filters.push(eq(aiProviderConfigs.adapterType, options.adapterType));
    }
    const rows = await this.transaction
      .select()
      .from(aiProviderConfigs)
      .where(and(...filters))
      .orderBy(asc(aiProviderConfigs.priority), asc(aiProviderConfigs.createdAt));
    return options.capability
      ? rows.filter((row) => row.capabilities.includes(options.capability!))
      : rows;
  }

  async create(input: NewAiProviderConfig) {
    const rows = await this.transaction
      .insert(aiProviderConfigs)
      .values(input)
      .returning();
    return rows[0];
  }

  async createIfMissing(input: NewAiProviderConfig) {
    await this.transaction
      .insert(aiProviderConfigs)
      .values(input)
      .onConflictDoNothing({ target: aiProviderConfigs.key });
    return this.findByKey(input.key);
  }

  async update(id: bigint, values: AiProviderConfigUpdate) {
    const rows = await this.transaction
      .update(aiProviderConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiProviderConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: bigint) {
    const rows = await this.transaction
      .delete(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findAttemptReferencedIds(ids: bigint[]) {
    if (!ids.length) return new Set<bigint>();
    const rows = await this.transaction
      .select({ providerConfigId: aiProviderAttempts.providerConfigId })
      .from(aiProviderAttempts)
      .where(inArray(aiProviderAttempts.providerConfigId, ids));
    return new Set(rows.map((row) => row.providerConfigId));
  }

  async deleteMany(ids: bigint[]) {
    if (!ids.length) return [];
    return this.transaction
      .delete(aiProviderConfigs)
      .where(inArray(aiProviderConfigs.id, ids))
      .returning({ id: aiProviderConfigs.id });
  }

}
