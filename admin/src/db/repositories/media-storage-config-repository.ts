import { and, asc, eq } from 'drizzle-orm';
import { mediaStorageConfigs } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type MediaStorageConfigRecord =
  typeof mediaStorageConfigs.$inferSelect;
export type NewMediaStorageConfig =
  typeof mediaStorageConfigs.$inferInsert;
export type MediaStorageConfigUpdate = Partial<
  Omit<
    NewMediaStorageConfig,
    'id' | 'key' | 'createdAt' | 'updatedAt'
  >
>;

export class MediaStorageConfigRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list() {
    return this.transaction
      .select()
      .from(mediaStorageConfigs)
      .orderBy(
        asc(mediaStorageConfigs.status),
        asc(mediaStorageConfigs.createdAt)
      );
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(mediaStorageConfigs)
      .where(eq(mediaStorageConfigs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKey(key: string) {
    const rows = await this.transaction
      .select()
      .from(mediaStorageConfigs)
      .where(eq(mediaStorageConfigs.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdForUpdate(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(mediaStorageConfigs)
      .where(eq(mediaStorageConfigs.id, id))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  async findByKeyForUpdate(key: string) {
    const rows = await this.transaction
      .select()
      .from(mediaStorageConfigs)
      .where(eq(mediaStorageConfigs.key, key))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  async create(input: NewMediaStorageConfig) {
    const rows = await this.transaction
      .insert(mediaStorageConfigs)
      .values(input)
      .returning();
    return rows[0];
  }

  async update(id: bigint, values: MediaStorageConfigUpdate) {
    const rows = await this.transaction
      .update(mediaStorageConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(mediaStorageConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async recordTestResult(
    id: bigint,
    expectedUpdatedAt: Date,
    values: Pick<
      MediaStorageConfigUpdate,
      'lastTestedAt' | 'lastTestOk' | 'lastTestMessage'
    >
  ) {
    const rows = await this.transaction
      .update(mediaStorageConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(mediaStorageConfigs.id, id),
          eq(mediaStorageConfigs.updatedAt, expectedUpdatedAt)
        )
      )
      .returning();
    return rows[0] ?? null;
  }
}
