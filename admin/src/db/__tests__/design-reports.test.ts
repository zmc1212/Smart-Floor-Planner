import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import { adminUsers, designReports, enterprises, leads, leadSitePhotos, mediaAssets } from '@/db/schema';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import type { TenantContext } from '@/lib/auth';
import { createReport, exportReport, mutateReport, reportDetail, sharedReport } from '@/lib/design-reports/service';
import { DesignReportRepository } from '@/db/repositories/design-report-repository';

const key = `report-test-${process.pid}-${Date.now()}`;
let tenant: bigint; let otherTenant: bigint; let leadId: bigint; let designer: bigint; let outsider: bigint;
let context: TenantContext;
before(async () => {
  loadEnvConfig(process.cwd());
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(resolvePostgresRuntimeConfig().connectionString).hostname), 'Only local test fixtures may be written');
  await withPlatformTransaction(async (tx) => {
    [tenant, otherTenant] = (await tx.insert(enterprises).values([{ name: key, code: key, status: 'active' }, { name: `${key}-other`, code: `${key}-other`, status: 'active' }]).returning()).map((r) => r.id);
    [designer, outsider] = (await tx.insert(adminUsers).values([{ enterpriseId: tenant, username: `${key}-designer`, passwordHash: 'test-only', role: 'designer', status: 'active' }, { enterpriseId: tenant, username: `${key}-outsider`, passwordHash: 'test-only', role: 'designer', status: 'active' }]).returning()).map((r) => r.id);
    [leadId] = (await tx.insert(leads).values({ enterpriseId: tenant, name: key, phone: `17${String(Date.now()).slice(-9)}`, assignedTo: designer, source: 'manual_entry', status: 'new' }).returning()).map((r) => r.id);
  });
  context = { enterpriseId: tenant.toString(), userId: designer.toString(), role: 'designer', username: key };
});
after(async () => {
  await withPlatformTransaction(async (tx) => {
    if (tenant) {
      await tx.delete(designReports).where(eq(designReports.enterpriseId, tenant));
      await tx.delete(leadSitePhotos).where(eq(leadSitePhotos.enterpriseId, tenant));
      await tx.delete(mediaAssets).where(eq(mediaAssets.enterpriseId, tenant));
      await tx.delete(leads).where(eq(leads.enterpriseId, tenant));
      await tx.delete(adminUsers).where(eq(adminUsers.enterpriseId, tenant));
    }
    const ids = [tenant, otherTenant].filter(Boolean); if (ids.length) await tx.delete(enterprises).where(inArray(enterprises.id, ids));
  });
  await closePostgresPool();
});
test('platform roles manage selected-tenant reports without gaining cross-tenant access', async () => {
  for (const role of ['admin', 'super_admin'] as const) {
    const actor = { ...context, role, userId: outsider.toString() };
    let report = await createReport(actor, { leadId: leadId.toString(), title: `${role}汇报`, purpose: 'proposal' });
    assert.equal((await reportDetail(actor, BigInt(report.id))).draft.title, `${role}汇报`);
    report = await mutateReport(actor, BigInt(report.id), 'save', { version: report.version, draft: { ...report.draft, outlineConfirmed: true } });
    report = await mutateReport(actor, BigInt(report.id), 'publish', { version: report.version });
    assert.ok(report.shareUrl);
    await assert.rejects(reportDetail({ ...actor, enterpriseId: otherTenant.toString() }, BigInt(report.id)), /不存在/);
    await assert.rejects(mutateReport({ ...actor, enterpriseId: otherTenant.toString() }, BigInt(report.id), 'withdraw', { version: report.version }), /不存在/);
    report = await mutateReport(actor, BigInt(report.id), 'withdraw', { version: report.version });
    assert.equal(report.shareUrl, null);
  }
});
test('published media revocation fails closed and disabled enterprises cannot share', async () => {
  const asset = await withTenantTransaction(tenant, async (tx) => {
    const [asset] = await tx.insert(mediaAssets).values({ enterpriseId: tenant, ownerType: 'lead_site_photo', ownerId: leadId, mimeType: 'image/png', size: BigInt(1), storageProvider: 'local', storageKey: `${key}/unused.png` }).returning();
    await tx.insert(leadSitePhotos).values({ enterpriseId: tenant, leadId, assetId: asset.id, source: 'album', spaceTag: 'living_room', createdByStaffId: designer });
    return asset;
  });
  let dto = await createReport(context, { leadId: leadId.toString(), title: '现场说明', purpose: 'proposal' });
  dto.draft.pages[0].assetIds = [asset.id.toString()]; dto.draft.outlineConfirmed = true;
  dto = await mutateReport(context, BigInt(dto.id), 'save', { version: dto.version, draft: dto.draft });
  dto = await mutateReport(context, BigInt(dto.id), 'publish', { version: dto.version });
  const token = dto.shareUrl!.split('/').at(-1)!;
  assert.ok((await sharedReport(token)).publishedDraft);
  await withTenantTransaction(tenant, (tx) => tx.update(enterprises).set({ status: 'disabled' }).where(eq(enterprises.id, tenant)));
  await assert.rejects(sharedReport(token), /停止分享/);
  await withTenantTransaction(tenant, (tx) => tx.update(enterprises).set({ status: 'active' }).where(eq(enterprises.id, tenant)));
  await withTenantTransaction(tenant, (tx) => tx.update(leadSitePhotos).set({ deletedAt: new Date() }).where(eq(leadSitePhotos.assetId, asset.id)));
  await assert.rejects(sharedReport(token), /素材/);
});
test('draft → confirm → publish → edit → restore → republish → withdraw, with optimistic locking and RLS', async () => {
  let dto = await createReport(context, { leadId: leadId.toString(), title: '方案汇报', purpose: 'proposal' });
  const id = BigInt(dto.id);
  await assert.rejects(mutateReport(context, id, 'publish', { version: dto.version }), /确认大纲/);
  await assert.rejects(reportDetail({ ...context, userId: outsider.toString() }, id), /无权访问/);
  await assert.rejects(reportDetail({ ...context, role: 'measurer' }, id), /无权访问/);
  await assert.rejects(reportDetail({ ...context, enterpriseId: otherTenant.toString() }, id), /不存在/);
  const isolated = await withTenantTransaction(otherTenant, (tx) => new DesignReportRepository(tx).find(id)); assert.equal(isolated, null);
  const draft = { ...dto.draft, outlineConfirmed: true };
  draft.pages[0].body = '客户明确要求保留收纳空间';
  dto = await mutateReport(context, id, 'save', { version: dto.version, draft });
  await assert.rejects(mutateReport(context, id, 'save', { version: 1, draft }), /其他窗口/);
  await assert.rejects(mutateReport(context, id, 'save', { version: dto.version, draft: { ...draft, pages: [{ ...draft.pages[0], assetIds: ['99999999'] }] } }), /素材/);
  dto = await mutateReport(context, id, 'publish', { version: dto.version });
  const token = dto.shareUrl!.split('/').at(-1)!;
  const published = await sharedReport(token); assert.equal(published.publishedDraft?.title, '方案汇报');
  dto = await mutateReport(context, id, 'save', { version: dto.version, draft: { ...draft, title: '内部修改' } });
  assert.equal((await sharedReport(token)).publishedDraft?.title, '方案汇报');
  dto = await mutateReport(context, id, 'restore', { version: dto.version }); assert.equal(dto.draft.title, '方案汇报');
  const html = await exportReport(context, id); assert.ok(html.includes('客户明确要求保留收纳空间'));
  dto = await mutateReport(context, id, 'publish', { version: dto.version }); assert.notEqual(dto.shareUrl!.split('/').at(-1), token);
  await assert.rejects(sharedReport(token), /无效或已撤回/);
  const currentToken = dto.shareUrl!.split('/').at(-1)!;
  await withTenantTransaction(tenant, (tx) => tx.update(leads).set({ status: 'closed' }).where(eq(leads.id, leadId)));
  await assert.rejects(sharedReport(currentToken), /停止分享/);
  await assert.rejects(mutateReport(context, id, 'save', { version: dto.version, draft }), /关闭/);
  await withTenantTransaction(tenant, (tx) => tx.update(leads).set({ status: 'new' }).where(eq(leads.id, leadId)));
  dto = await mutateReport(context, id, 'withdraw', { version: dto.version }); assert.equal(dto.shareUrl, null);
  await assert.rejects(sharedReport(currentToken), /无效或已撤回/);
});
