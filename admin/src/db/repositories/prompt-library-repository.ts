import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
} from 'drizzle-orm';
import {
  aiPromptCategories,
  aiPromptLibraryRevisions,
  aiPromptParameterTemplates,
  aiPromptSourceModels,
  aiPromptTemplateAssets,
  aiPromptTemplates,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type PromptRevisionRecord = typeof aiPromptLibraryRevisions.$inferSelect;
export type PromptCategoryRecord = typeof aiPromptCategories.$inferSelect;
export type PromptTemplateRecord = typeof aiPromptTemplates.$inferSelect;
export type PromptParameterTemplateRecord =
  typeof aiPromptParameterTemplates.$inferSelect;
export type PromptSourceModelRecord = typeof aiPromptSourceModels.$inferSelect;
export type PromptTemplateAssetRecord =
  typeof aiPromptTemplateAssets.$inferSelect;

export class PromptLibraryRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findActiveRevision(source = 'roomi'): Promise<PromptRevisionRecord | null> {
    const rows = await this.transaction
      .select()
      .from(aiPromptLibraryRevisions)
      .where(
        and(
          eq(aiPromptLibraryRevisions.source, source),
          eq(aiPromptLibraryRevisions.status, 'active')
        )
      )
      .orderBy(desc(aiPromptLibraryRevisions.publishedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  listCategories(revisionId: bigint): Promise<PromptCategoryRecord[]> {
    return this.transaction
      .select()
      .from(aiPromptCategories)
      .where(
        and(
          eq(aiPromptCategories.importRevisionId, revisionId),
          eq(aiPromptCategories.enabled, true)
        )
      )
      .orderBy(
        asc(aiPromptCategories.level),
        desc(aiPromptCategories.weight),
        asc(aiPromptCategories.sourceId)
      );
  }

  async listTemplates(
    revisionId: bigint,
    input: {
      page: number;
      limit: number;
      query?: string;
      categorySourceIds?: string[];
    }
  ) {
    const filters = [
      eq(aiPromptTemplates.importRevisionId, revisionId),
      eq(aiPromptTemplates.enabled, true),
    ];
    const query = input.query?.trim();
    if (query) {
      filters.push(
        or(
          ilike(aiPromptTemplates.name, `%${query}%`),
          ilike(aiPromptTemplates.promptContent, `%${query}%`)
        )!
      );
    }
    if (input.categorySourceIds?.length) {
      filters.push(
        inArray(aiPromptTemplates.categorySourceId, input.categorySourceIds)
      );
    }

    const where = and(...filters);
    const [rows, totalRows] = await Promise.all([
      this.transaction
        .select()
        .from(aiPromptTemplates)
        .where(where)
        .orderBy(desc(aiPromptTemplates.weight), asc(aiPromptTemplates.sourceId))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.transaction
        .select({ value: count() })
        .from(aiPromptTemplates)
        .where(where),
    ]);

    return { rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async findTemplate(revisionId: bigint, templateId: bigint) {
    return this.transaction
      .select()
      .from(aiPromptTemplates)
      .where(
        and(
          eq(aiPromptTemplates.id, templateId),
          eq(aiPromptTemplates.importRevisionId, revisionId),
          eq(aiPromptTemplates.enabled, true)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async findParameterTemplate(
    revisionId: bigint,
    parameterTemplateId: bigint | null
  ) {
    if (!parameterTemplateId) return null;
    const rows = await this.transaction
      .select()
      .from(aiPromptParameterTemplates)
      .where(
        and(
          eq(aiPromptParameterTemplates.id, parameterTemplateId),
          eq(aiPromptParameterTemplates.importRevisionId, revisionId),
          eq(aiPromptParameterTemplates.enabled, true)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findSourceModel(revisionId: bigint, sourceModelId: bigint | null) {
    if (!sourceModelId) return null;
    const rows = await this.transaction
      .select()
      .from(aiPromptSourceModels)
      .where(
        and(
          eq(aiPromptSourceModels.id, sourceModelId),
          eq(aiPromptSourceModels.importRevisionId, revisionId),
          eq(aiPromptSourceModels.enabled, true)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listSourceModels(revisionId: bigint, sourceIds: string[]) {
    if (!sourceIds.length) return [];
    return this.transaction
      .select()
      .from(aiPromptSourceModels)
      .where(
        and(
          eq(aiPromptSourceModels.importRevisionId, revisionId),
          eq(aiPromptSourceModels.enabled, true),
          inArray(aiPromptSourceModels.sourceId, sourceIds)
        )
      );
  }

  async findTemplateAsset(
    revisionId: bigint,
    assetId: bigint | null
  ): Promise<PromptTemplateAssetRecord | null> {
    if (!assetId) return null;
    const rows = await this.transaction
      .select()
      .from(aiPromptTemplateAssets)
      .where(
        and(
          eq(aiPromptTemplateAssets.id, assetId),
          eq(aiPromptTemplateAssets.importRevisionId, revisionId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listTemplateAssets(revisionId: bigint, assetIds: bigint[]) {
    if (!assetIds.length) return [];
    return this.transaction
      .select()
      .from(aiPromptTemplateAssets)
      .where(
        and(
          eq(aiPromptTemplateAssets.importRevisionId, revisionId),
          inArray(aiPromptTemplateAssets.id, assetIds)
        )
      );
  }
}
