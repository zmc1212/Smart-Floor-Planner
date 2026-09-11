import { and, eq, inArray, isNull, ne, ilike, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { aiGenerationPublications, aiGenerations, designReports, enterprises, floorPlans, leadFloorPlans, leads, mediaAssets } from '@/db/schema';
import { DesignReportRepository } from '@/db/repositories/design-report-repository';
import { LeadSitePhotoRepository } from '@/db/repositories/lead-site-photo-repository';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import type { TenantContext } from '@/lib/auth';
import { getPostgresAssetIdFromImageUrl, readPostgresMediaAssetBuffer } from '@/lib/ai/postgres-media-assets';
import { assertReportAssets, canManageReport, initialDraft, parseDraft, reportAssetIds, ReportError, type ReportAsset, type ReportDraft } from './contract';
import { renderReport } from './render';
import { isEnterpriseOperationallyActive } from '@/lib/enterprise-status';
import { LEAD_SITE_PHOTO_SPACE_TAG_LABELS, type LeadSitePhotoSpaceTag } from '@/lib/lead-site-photos';

export type ReportRecord = typeof designReports.$inferSelect;
export function reportDto(row: ReportRecord) {
  return { id: row.id.toString(), leadId: row.leadId.toString(), draft: row.draft, version: row.version,
    publishedVersion: row.publishedVersion, publishedAt: row.publishedAt, updatedAt: row.updatedAt,
    canRestore: Boolean(row.previousDraft), shareUrl: row.shareToken ? `/api/public/design-reports/${row.shareToken}` : null };
}
export async function assertLead(tx: PostgresTransaction, context: TenantContext, leadId: bigint) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead || lead.enterpriseId?.toString() !== context.enterpriseId || !canManageReport(context.role, context.userId, lead.assignedTo)) throw new ReportError('无权访问该客户的设计汇报', 403);
  if (lead.archivedAt || lead.status === 'closed') throw new ReportError('客户已归档或服务已关闭', 409);
  return lead;
}
export async function reportCatalog(tx: PostgresTransaction, leadId: bigint): Promise<ReportAsset[]> {
  const photos = await new LeadSitePhotoRepository(tx).listActive(leadId);
  const designs = await tx.select({ image: sql<string>`${aiGenerations.output}->>'imageUrl'`, title: aiGenerationPublications.schemeTitle })
    .from(aiGenerationPublications).innerJoin(aiGenerations, eq(aiGenerations.id, aiGenerationPublications.generationId))
    .where(and(eq(aiGenerationPublications.leadId, leadId), eq(aiGenerations.leadId, leadId), isNull(aiGenerationPublications.withdrawnAt), isNull(aiGenerations.deletedAt), eq(aiGenerations.status, 'succeeded'))).limit(200);
  const plans = await tx.select({ id: floorPlans.previewAssetId, title: floorPlans.name }).from(leadFloorPlans)
    .innerJoin(floorPlans, eq(floorPlans.id, leadFloorPlans.floorPlanId))
    .where(and(eq(leadFloorPlans.leadId, leadId), eq(floorPlans.status, 'completed'), sql`${floorPlans.layoutData}->>'version' = '4'`, sql`${floorPlans.layoutData}->>'measurementMode' = 'surveying'`)).limit(30);
  const assets: ReportAsset[] = [];
  function add(id: bigint | undefined | null, title: string, kind: ReportAsset['kind']) {
    if (id && !assets.some((a) => a.id === id.toString())) assets.push({ id: id.toString(), title, kind, url: '' });
  }
  designs.forEach((row, i) => add(getPostgresAssetIdFromImageUrl(row.image), `${row.title || '已发布方案'} · ${i + 1}`, 'design'));
  photos.forEach((row) => add(row.assetId, LEAD_SITE_PHOTO_SPACE_TAG_LABELS[row.spaceTag as LeadSitePhotoSpaceTag] || '现场照片', 'site'));
  plans.forEach((row) => add(row.id, row.title || '实测户型', 'plan'));
  if (!assets.length) return [];
  const active = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(inArray(mediaAssets.id, assets.map((a) => BigInt(a.id))), isNull(mediaAssets.deletedAt), inArray(mediaAssets.mimeType, ['image/png', 'image/jpeg', 'image/webp'])));
  const activeIds = new Set(active.map((a) => a.id.toString()));
  return assets.filter((a) => activeIds.has(a.id));
}
export async function getReport(tx: PostgresTransaction, context: TenantContext, id: bigint, lock = false) {
  const row = await new DesignReportRepository(tx).find(id, lock);
  if (!row) throw new ReportError('汇报不存在', 404);
  const lead = await assertLead(tx, context, row.leadId);
  return { row, lead };
}
export async function reportDetail(context: TenantContext, id: bigint) {
  return withTenantTransaction(context.enterpriseId!, async (tx) => {
    const { row, lead } = await getReport(tx, context, id);
    const assets = (await reportCatalog(tx, row.leadId)).map((asset) => ({ ...asset, url: `/api/design-reports/${id}/asset?assetId=${asset.id}` }));
    return { ...reportDto(row), customer: lead.name, assets };
  });
}
export function assertVersion(row: ReportRecord, version: unknown) {
  if (!Number.isInteger(version) || row.version !== version) throw new ReportError('汇报已在其他窗口更新，请重新加载后再操作', 409);
}
export async function createReport(context: TenantContext, body: { leadId: string; title: string; purpose: ReportDraft['purpose'] }) {
  return withTenantTransaction(context.enterpriseId!, async (tx) => {
    await assertLead(tx, context, BigInt(body.leadId));
    const draft = parseDraft(initialDraft(body.title, body.purpose));
    return reportDto(await new DesignReportRepository(tx).create({ enterpriseId: BigInt(context.enterpriseId!), leadId: BigInt(body.leadId), createdBy: BigInt(context.userId), draft }));
  });
}
export async function listCustomers(tx: PostgresTransaction, context: TenantContext, query: string) {
  return tx.select({ id: sql<string>`${leads.id}::text`, name: leads.name, communityName: leads.communityName }).from(leads)
    .where(and(isNull(leads.archivedAt), ne(leads.status, 'closed'), context.role === 'designer' ? eq(leads.assignedTo, BigInt(context.userId)) : undefined, query ? ilike(leads.name, `%${query.slice(0, 100)}%`) : undefined)).limit(50);
}
export async function mutateReport(context: TenantContext, id: bigint, action: string, body: { version: number; draft?: unknown }) {
  return withTenantTransaction(context.enterpriseId!, async (tx) => {
    const { row } = await getReport(tx, context, id, true);
    assertVersion(row, body.version);
    const repo = new DesignReportRepository(tx);
    const patch: Partial<typeof designReports.$inferInsert> = { version: row.version + 1 };
    if (action === 'save' || action === 'restore') {
      if (action === 'restore' && !row.previousDraft) throw new ReportError('没有可恢复的上次保存');
      const draft = parseDraft(action === 'restore' ? row.previousDraft : body.draft);
      assertReportAssets(draft, await reportCatalog(tx, row.leadId));
      patch.previousDraft = row.draft; patch.draft = draft;
    } else if (action === 'publish') {
      const draft = parseDraft(row.draft);
      if (!draft.outlineConfirmed) throw new ReportError('请先确认大纲并保存');
      assertReportAssets(draft, await reportCatalog(tx, row.leadId));
      patch.publishedDraft = draft; patch.publishedVersion = row.version;
      patch.publishedAt = new Date(); patch.shareToken = `${context.enterpriseId}.${randomBytes(32).toString('hex')}`;
    } else if (action === 'withdraw') {
      patch.shareToken = null; patch.publishedDraft = null; patch.publishedVersion = null; patch.publishedAt = null;
    } else throw new ReportError('不支持的操作');
    return reportDto(await repo.update(id, patch));
  });
}
export async function sharedReport(token: string) {
  if (!/^[1-9]\d{0,18}\.[a-f0-9]{64}$/.test(token) || BigInt(token.split('.')[0]) > BigInt('9223372036854775807')) throw new ReportError('汇报链接无效或已撤回', 404);
  return withTenantTransaction(token.split('.')[0], async (tx) => {
    const [enterprise] = await tx.select({ status: enterprises.status }).from(enterprises).where(eq(enterprises.id, BigInt(token.split('.')[0])));
    if (!enterprise || !isEnterpriseOperationallyActive(enterprise.status)) throw new ReportError('汇报已停止分享', 404);
    const row = await new DesignReportRepository(tx).findShared(token);
    if (!row?.publishedDraft) throw new ReportError('汇报链接无效或已撤回', 404);
    const [lead] = await tx.select({ archivedAt: leads.archivedAt, status: leads.status }).from(leads).where(eq(leads.id, row.leadId));
    if (!lead || lead.archivedAt || lead.status === 'closed') throw new ReportError('汇报已停止分享', 404);
    assertReportAssets(row.publishedDraft, await reportCatalog(tx, row.leadId));
    return row;
  });
}
export async function reportAsset(enterpriseId: string, draft: ReportDraft, assetId: string) {
  if (!reportAssetIds(draft).includes(assetId)) throw new ReportError('图片不可用', 404);
  const asset = await withTenantTransaction(enterpriseId, async (tx) => (await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, BigInt(assetId)), isNull(mediaAssets.deletedAt))).limit(1))[0]);
  if (!asset || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw new ReportError('图片不可用', 404);
  return { asset, buffer: await readPostgresMediaAssetBuffer(asset) };
}
export async function exportReport(context: TenantContext, id: bigint) {
  const { row } = await withTenantTransaction(context.enterpriseId!, async (tx) => {
    const result = await getReport(tx, context, id);
    assertReportAssets(result.row.draft, await reportCatalog(tx, result.row.leadId));
    return result;
  });
  const urls: Record<string, string> = {}; let size = 0;
  for (const assetId of reportAssetIds(row.draft)) {
    const { asset, buffer } = await reportAsset(context.enterpriseId!, row.draft, assetId);
    size += buffer.length;
    if (size > 30 * 1024 * 1024) throw new ReportError('离线文件素材超过 30MB，请减少图片后重试', 413);
    urls[assetId] = `data:${asset.mimeType};base64,${buffer.toString('base64')}`;
  }
  return renderReport(row.draft, urls);
}
