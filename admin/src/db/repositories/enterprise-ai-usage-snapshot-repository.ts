import { eq } from 'drizzle-orm';
import { enterpriseAiUsageSnapshots } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type EnterpriseAiUsageSnapshotRecord =
  typeof enterpriseAiUsageSnapshots.$inferSelect;
export type NewEnterpriseAiUsageSnapshot =
  typeof enterpriseAiUsageSnapshots.$inferInsert;

export class EnterpriseAiUsageSnapshotRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findByEnterpriseId(enterpriseId: bigint) {
    const rows = await this.transaction
      .select()
      .from(enterpriseAiUsageSnapshots)
      .where(eq(enterpriseAiUsageSnapshots.enterpriseId, enterpriseId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(input: Omit<NewEnterpriseAiUsageSnapshot, 'id' | 'createdAt' | 'updatedAt'>) {
    const rows = await this.transaction
      .insert(enterpriseAiUsageSnapshots)
      .values(input)
      .onConflictDoUpdate({
        target: enterpriseAiUsageSnapshots.enterpriseId,
        set: {
          balance: input.balance,
          currency: input.currency,
          dailyUsage: input.dailyUsage,
          keyInfo: input.keyInfo,
          lastSyncedAt: input.lastSyncedAt,
          syncError: input.syncError,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  }
}
