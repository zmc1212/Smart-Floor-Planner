import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { aiCreationModelProfiles } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type AiCreationModelProfileRecord =
  typeof aiCreationModelProfiles.$inferSelect;
export type NewAiCreationModelProfile =
  typeof aiCreationModelProfiles.$inferInsert;

export type AiCreationModelProfileUpdate = Partial<
  Omit<NewAiCreationModelProfile, 'id' | 'key' | 'createdAt' | 'updatedAt'>
>;

/**
 * Platform-wide model profiles are the stable bigint parent for creation tasks,
 * batches, and generations. Tenant records only reference a profile ID.
 */
export class AiCreationModelProfileRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  list(options: { sourceType?: string; enabledOnly?: boolean } = {}) {
    const filters = [
      ...(options.sourceType
        ? [eq(aiCreationModelProfiles.sourceType, options.sourceType)]
        : []),
      ...(options.enabledOnly
        ? [eq(aiCreationModelProfiles.enabled, true)]
        : []),
    ];
    return this.transaction
      .select()
      .from(aiCreationModelProfiles)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(
        desc(aiCreationModelProfiles.isDefault),
        desc(aiCreationModelProfiles.weight),
        asc(aiCreationModelProfiles.name)
      );
  }

  async findById(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiCreationModelProfiles)
      .where(eq(aiCreationModelProfiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKey(key: string) {
    const rows = await this.transaction
      .select()
      .from(aiCreationModelProfiles)
      .where(eq(aiCreationModelProfiles.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCatalogProfilesByIds(ids: bigint[]) {
    if (!ids.length) return [];
    return this.transaction
      .select()
      .from(aiCreationModelProfiles)
      .where(
        and(
          eq(aiCreationModelProfiles.sourceType, 'grs_catalog'),
          inArray(aiCreationModelProfiles.id, ids)
        )
      );
  }

  async findEnabledCatalogProfile(id: bigint) {
    const rows = await this.transaction
      .select()
      .from(aiCreationModelProfiles)
      .where(
        and(
          eq(aiCreationModelProfiles.id, id),
          eq(aiCreationModelProfiles.sourceType, 'grs_catalog'),
          eq(aiCreationModelProfiles.enabled, true)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async ensureCatalogProfiles(profiles: NewAiCreationModelProfile[]) {
    for (const profile of profiles) {
      await this.transaction
        .insert(aiCreationModelProfiles)
        .values(profile)
        .onConflictDoUpdate({
          target: aiCreationModelProfiles.key,
          set: {
            name: profile.name,
            description: profile.description,
            sourceModelSourceIds: profile.sourceModelSourceIds,
            sourceType: profile.sourceType,
            adapterType: profile.adapterType,
            remoteModel: profile.remoteModel,
            family: profile.family,
            catalogVersion: profile.catalogVersion,
            generateLogicalModelKey: profile.generateLogicalModelKey,
            editLogicalModelKey: profile.editLogicalModelKey,
            capabilities: profile.capabilities,
            defaults: profile.defaults,
            weight: profile.weight,
            updatedAt: new Date(),
          },
        });
    }
  }

  async ensureDefaultCatalogProfile(key: string) {
    const current = await this.transaction
      .select({ id: aiCreationModelProfiles.id })
      .from(aiCreationModelProfiles)
      .where(
        and(
          eq(aiCreationModelProfiles.sourceType, 'grs_catalog'),
          eq(aiCreationModelProfiles.enabled, true),
          eq(aiCreationModelProfiles.isDefault, true)
        )
      )
      .limit(1);
    if (current[0]) return this.findById(current[0].id);

    await this.transaction
      .update(aiCreationModelProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(aiCreationModelProfiles.sourceType, 'grs_catalog'));
    const rows = await this.transaction
      .update(aiCreationModelProfiles)
      .set({ enabled: true, isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(aiCreationModelProfiles.key, key),
          eq(aiCreationModelProfiles.sourceType, 'grs_catalog')
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  async update(id: bigint, values: AiCreationModelProfileUpdate) {
    const rows = await this.transaction
      .update(aiCreationModelProfiles)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiCreationModelProfiles.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updateCatalogSettings(input: {
    id: bigint;
    enabled: boolean;
    isDefault: boolean;
    maxReferenceImages: number;
  }) {
    const profile = await this.findById(input.id);
    if (!profile || profile.sourceType !== 'grs_catalog') return null;

    const capabilities = {
      ...(profile.capabilities || {}),
      supportsReferenceImages: input.maxReferenceImages > 0,
      maxReferenceImages: input.maxReferenceImages,
    };
    const rows = await this.transaction
      .update(aiCreationModelProfiles)
      .set({
        enabled: input.enabled,
        isDefault: input.isDefault,
        capabilities,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiCreationModelProfiles.id, input.id),
          eq(aiCreationModelProfiles.sourceType, 'grs_catalog')
        )
      )
      .returning();
    return rows[0] ?? null;
  }

  async clearCatalogDefaults() {
    await this.transaction
      .update(aiCreationModelProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(aiCreationModelProfiles.sourceType, 'grs_catalog'));
  }
}
