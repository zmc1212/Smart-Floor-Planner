import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { leadSitePhotos, mediaAssets } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type LeadSitePhotoRecord = typeof leadSitePhotos.$inferSelect;
export type LeadSitePhotoInsert = typeof leadSitePhotos.$inferInsert;
export type LeadSitePhotoWithAsset = LeadSitePhotoRecord & {
  mimeType: string;
  width: number | null;
  height: number | null;
  size: bigint;
};

export class LeadSitePhotoRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async countActive(leadId: bigint) {
    const rows = await this.transaction
      .select({ value: sql<string>`count(*)::text` })
      .from(leadSitePhotos)
      .where(and(eq(leadSitePhotos.leadId, leadId), isNull(leadSitePhotos.deletedAt)));
    return Number(rows[0]?.value ?? 0);
  }

  async listActive(leadId: bigint): Promise<LeadSitePhotoWithAsset[]> {
    return this.transaction
      .select({
        id: leadSitePhotos.id,
        enterpriseId: leadSitePhotos.enterpriseId,
        leadId: leadSitePhotos.leadId,
        assetId: leadSitePhotos.assetId,
        spaceTag: leadSitePhotos.spaceTag,
        source: leadSitePhotos.source,
        createdByUserId: leadSitePhotos.createdByUserId,
        createdByStaffId: leadSitePhotos.createdByStaffId,
        deletedAt: leadSitePhotos.deletedAt,
        createdAt: leadSitePhotos.createdAt,
        updatedAt: leadSitePhotos.updatedAt,
        mimeType: mediaAssets.mimeType,
        width: mediaAssets.width,
        height: mediaAssets.height,
        size: mediaAssets.size,
      })
      .from(leadSitePhotos)
      .innerJoin(mediaAssets, eq(leadSitePhotos.assetId, mediaAssets.id))
      .where(and(
        eq(leadSitePhotos.leadId, leadId),
        isNull(leadSitePhotos.deletedAt),
        isNull(mediaAssets.deletedAt),
      ))
      .orderBy(desc(leadSitePhotos.createdAt));
  }

  async findActiveById(leadId: bigint, photoId: bigint): Promise<LeadSitePhotoWithAsset | null> {
    const rows = await this.transaction
      .select({
        id: leadSitePhotos.id,
        enterpriseId: leadSitePhotos.enterpriseId,
        leadId: leadSitePhotos.leadId,
        assetId: leadSitePhotos.assetId,
        spaceTag: leadSitePhotos.spaceTag,
        source: leadSitePhotos.source,
        createdByUserId: leadSitePhotos.createdByUserId,
        createdByStaffId: leadSitePhotos.createdByStaffId,
        deletedAt: leadSitePhotos.deletedAt,
        createdAt: leadSitePhotos.createdAt,
        updatedAt: leadSitePhotos.updatedAt,
        mimeType: mediaAssets.mimeType,
        width: mediaAssets.width,
        height: mediaAssets.height,
        size: mediaAssets.size,
      })
      .from(leadSitePhotos)
      .innerJoin(mediaAssets, eq(leadSitePhotos.assetId, mediaAssets.id))
      .where(and(
        eq(leadSitePhotos.id, photoId),
        eq(leadSitePhotos.leadId, leadId),
        isNull(leadSitePhotos.deletedAt),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: LeadSitePhotoInsert) {
    const rows = await this.transaction.insert(leadSitePhotos).values(input).returning();
    return rows[0];
  }

  async updateSpaceTag(leadId: bigint, photoId: bigint, spaceTag: string | null) {
    const rows = await this.transaction
      .update(leadSitePhotos)
      .set({ spaceTag, updatedAt: new Date() })
      .where(and(
        eq(leadSitePhotos.id, photoId),
        eq(leadSitePhotos.leadId, leadId),
        isNull(leadSitePhotos.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(leadId: bigint, photoId: bigint) {
    const now = new Date();
    const rows = await this.transaction
      .update(leadSitePhotos)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(
        eq(leadSitePhotos.id, photoId),
        eq(leadSitePhotos.leadId, leadId),
        isNull(leadSitePhotos.deletedAt),
      ))
      .returning();
    return rows[0] ?? null;
  }
}
