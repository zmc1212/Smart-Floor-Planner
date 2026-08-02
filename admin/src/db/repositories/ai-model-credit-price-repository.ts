import { and, asc, eq } from 'drizzle-orm';
import { aiModelCreditPrices } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiModelCreditPriceRecord = typeof aiModelCreditPrices.$inferSelect;
export type NewAiModelCreditPrice = typeof aiModelCreditPrices.$inferInsert;

export class AiModelCreditPriceRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async ensureDefault(input: NewAiModelCreditPrice) {
    await this.transaction
      .insert(aiModelCreditPrices)
      .values(input)
      .onConflictDoNothing({
        target: [aiModelCreditPrices.modelProfileKey, aiModelCreditPrices.resolutionTier],
      });
  }

  list(options: { actionKey?: string; enabledOnly?: boolean } = {}) {
    const filters = [
      ...(options.actionKey ? [eq(aiModelCreditPrices.actionKey, options.actionKey)] : []),
      ...(options.enabledOnly ? [eq(aiModelCreditPrices.enabled, true)] : []),
    ];
    return this.transaction
      .select()
      .from(aiModelCreditPrices)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(aiModelCreditPrices.modelProfileKey), asc(aiModelCreditPrices.resolutionTier));
  }

  async findEnabled(modelProfileKey: string, resolutionTier: string) {
    const rows = await this.transaction
      .select()
      .from(aiModelCreditPrices)
      .where(
        and(
          eq(aiModelCreditPrices.actionKey, 'image.free_create'),
          eq(aiModelCreditPrices.modelProfileKey, modelProfileKey),
          eq(aiModelCreditPrices.resolutionTier, resolutionTier),
          eq(aiModelCreditPrices.enabled, true)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async update(
    modelProfileKey: string,
    resolutionTier: string,
    values: Pick<NewAiModelCreditPrice, 'credits' | 'enabled' | 'updatedBy'>
  ) {
    const rows = await this.transaction
      .update(aiModelCreditPrices)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(aiModelCreditPrices.actionKey, 'image.free_create'),
          eq(aiModelCreditPrices.modelProfileKey, modelProfileKey),
          eq(aiModelCreditPrices.resolutionTier, resolutionTier)
        )
      )
      .returning();
    return rows[0] ?? null;
  }
}
