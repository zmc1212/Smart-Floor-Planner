import { eq } from 'drizzle-orm';
import { platformConfigs } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type PlatformConfigRecord = typeof platformConfigs.$inferSelect;
export type PlatformConfigValues = Pick<
  typeof platformConfigs.$inferInsert,
  'mediaStorage' | 'promotionConfig' | 'notificationConfig' | 'smsConfig' | 'miniProgramCodeConfig'
>;

export class PlatformConfigRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findByKey(key: string) {
    const rows = await this.transaction
      .select()
      .from(platformConfigs)
      .where(eq(platformConfigs.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async ensureForUpdate(key: string) {
    await this.transaction
      .insert(platformConfigs)
      .values({ key })
      .onConflictDoNothing({ target: platformConfigs.key });
    const rows = await this.transaction
      .select()
      .from(platformConfigs)
      .where(eq(platformConfigs.key, key))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async upsert(key: string, values: PlatformConfigValues) {
    const rows = await this.transaction
      .insert(platformConfigs)
      .values({ key, ...values })
      .onConflictDoUpdate({
        target: platformConfigs.key,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return rows[0];
  }

  async update(key: string, values: PlatformConfigValues) {
    const rows = await this.transaction
      .update(platformConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(platformConfigs.key, key))
      .returning();
    return rows[0] ?? null;
  }
}
