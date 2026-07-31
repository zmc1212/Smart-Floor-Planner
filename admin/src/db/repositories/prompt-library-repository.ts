import { and, asc, desc, eq } from 'drizzle-orm';
import {
  aiPromptCategories,
  aiPromptLibraryRevisions,
  aiPromptTemplates,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export class PromptLibraryRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async findActiveRevision(source = 'roomi') {
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

  listCategories(revisionId: bigint) {
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
        asc(aiPromptCategories.id)
      );
  }

  listTemplates(revisionId: bigint, categoryId: bigint) {
    return this.transaction
      .select()
      .from(aiPromptTemplates)
      .where(
        and(
          eq(aiPromptTemplates.importRevisionId, revisionId),
          eq(aiPromptTemplates.categoryId, categoryId),
          eq(aiPromptTemplates.enabled, true)
        )
      )
      .orderBy(desc(aiPromptTemplates.weight), asc(aiPromptTemplates.id));
  }
}
