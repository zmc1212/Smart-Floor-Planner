import { asc, eq } from 'drizzle-orm';
import { aiCreditPrices } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiCreditPriceRecord = typeof aiCreditPrices.$inferSelect;
export type NewAiCreditPrice = typeof aiCreditPrices.$inferInsert;

export class AiCreditPriceRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async ensureDefaults(defaults: NewAiCreditPrice[]) {
    if (!defaults.length) return;
    await this.transaction
      .insert(aiCreditPrices)
      .values(defaults)
      .onConflictDoNothing({ target: aiCreditPrices.actionKey });
  }

  list() {
    return this.transaction
      .select()
      .from(aiCreditPrices)
      .orderBy(asc(aiCreditPrices.actionKey));
  }

  async findEnabledByActionKey(actionKey: string) {
    const rows = await this.transaction
      .select()
      .from(aiCreditPrices)
      .where(eq(aiCreditPrices.actionKey, actionKey))
      .limit(1);
    const row = rows[0] ?? null;
    return row?.enabled ? row : null;
  }

  async updateByActionKey(
    actionKey: string,
    values: Pick<NewAiCreditPrice, 'credits' | 'enabled' | 'updatedBy'>
  ) {
    const rows = await this.transaction
      .update(aiCreditPrices)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiCreditPrices.actionKey, actionKey))
      .returning();
    return rows[0] ?? null;
  }
}
