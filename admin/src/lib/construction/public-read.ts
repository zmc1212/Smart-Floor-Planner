import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { publicSourcesAvailable, publicSourceStatus, type PublicSourceFailure } from './public-sources';
import { publicStatusLabels, type PublicContent } from './public-contract';

export type PublicMaterialFailure = PublicSourceFailure | 'source_withdrawn';
export async function publicMaterial(tx: PostgresTransaction, eid: string, siteId: string, versionId?: string) {
  const site = await one(tx, sql`select s.*,p.lead_id,l.customer_user_id,p.status as project_status,p.customer_access
    from app.construction_public_sites s join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=s.enterprise_id and e.status='active'
    join app.assistant_enterprise_settings settings on settings.enterprise_id=s.enterprise_id and settings.enabled
    where s.enterprise_id=${eid} and s.id=${siteId} and p.status='active' and p.customer_access and l.archived_at is null and l.status<>'closed'
      and s.customer_id=l.customer_user_id for share of s,p,l,e,settings`);
  if (!site || !site.current_version_id || (versionId && String(site.current_version_id) !== versionId)) return null;
  const version = await one(tx, sql`select * from app.construction_public_versions where enterprise_id=${eid} and site_id=${siteId} and id=${String(site.current_version_id)} for share`);
  if (!version || !await publicSourcesAvailable(tx, site, version)) return null;
  return { site, version };
}
/** Explain an unavailable material without changing the read contract. Only the
 * failure path runs the extra classification: a deleted original, a lost
 * access, a replaced/withdrawn version and an unreadable store stay distinct so
 * a transient read error is never shown as withdrawn content. */
async function publicMaterialFailure(tx: PostgresTransaction, eid: string, siteId: string, versionId?: string): Promise<PublicMaterialFailure> {
  const site = await one(tx, sql`select s.*,p.lead_id,l.customer_user_id,p.status as project_status,p.customer_access,
      l.archived_at,l.status as lead_status,e.status as enterprise_status,settings.enabled as settings_enabled
    from app.construction_public_sites s
    left join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
    left join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    left join app.enterprises e on e.id=s.enterprise_id
    left join app.assistant_enterprise_settings settings on settings.enterprise_id=s.enterprise_id
    where s.enterprise_id=${eid} and s.id=${siteId}`);
  if (!site) return 'source_missing';
  // The site exists but this customer/enterprise may no longer read it.
  if (String(site.enterprise_status || '') !== 'active' || site.settings_enabled !== true
    || String(site.project_status || '') !== 'active' || !site.customer_access || site.archived_at
    || String(site.lead_status || '') === 'closed' || !site.customer_user_id || String(site.customer_id) !== String(site.customer_user_id))
    return 'source_forbidden';
  if (!site.current_version_id || (versionId && String(site.current_version_id) !== versionId)) return 'source_changed';
  const version = await one(tx, sql`select * from app.construction_public_versions
    where enterprise_id=${eid} and site_id=${siteId} and id=${String(site.current_version_id)}`);
  if (!version) return 'source_changed';
  const status = await publicSourceStatus(tx, site, version);
  return status.ok ? 'source_changed' : status.reason;
}
export async function publicMaterialStatus(tx: PostgresTransaction, eid: string, siteId: string, versionId?: string) {
  const material = await publicMaterial(tx, eid, siteId, versionId);
  return material ? { material } : { material: null, reason: await publicMaterialFailure(tx, eid, siteId, versionId) };
}
export async function publishedPublicMaterial(tx: PostgresTransaction, eid: string, siteId: string, versionId?: string) {
  const material = await publicMaterial(tx, eid, siteId, versionId);
  if (!material || material.site.status !== 'published' || !material.site.reviewed_by
    || String(material.site.consented_version_id) !== String(material.version.id)
    || String(material.site.consented_by) !== String(material.site.customer_id)) return null;
  return material;
}
export async function publishedPublicMaterialStatus(tx: PostgresTransaction, eid: string, siteId: string, versionId?: string) {
  const result = await publicMaterialStatus(tx, eid, siteId, versionId);
  if (!result.material) return result;
  const { site, version } = result.material;
  if (site.status !== 'published' || !site.reviewed_by
    || String(site.consented_version_id) !== String(version.id) || String(site.consented_by) !== String(site.customer_id))
    return { material: null, reason: 'source_withdrawn' as const };
  return result;
}
export async function publicMaterialDto(tx: PostgresTransaction, site: Row, version: Row) {
  const content = version.content as PublicContent;
  const media = await rows(tx, sql`select id::text,width,height from app.construction_public_media where enterprise_id=${String(site.enterprise_id)} and site_id=${String(site.id)} and version_id=${String(version.id)} order by position`);
  return { id: String(site.id), versionId: String(version.id), revision: Number(site.revision), status: String(site.status), statusLabel: publicStatusLabels[String(site.status)] || '当前不可用',
    name: content.name, cityCode: content.cityCode, cityName: content.cityName, district: content.district, stageName: content.stageName,
    designer: content.designerId ? { id: content.designerId, name: content.designerName || '' } : null,
    excerpts: content.excerpts, photos: media as Array<{ id: string; width: number; height: number }>,
    updatedAt: new Date(String(site.updated_at)).toISOString() };
}
export async function publicCandidates(tx: PostgresTransaction, eid: string, cityCode = '', district = '') {
  const candidates = await rows(tx, sql`select s.id::text from app.construction_public_sites s
    join app.construction_public_versions v on v.enterprise_id=s.enterprise_id and v.site_id=s.id and v.id=s.current_version_id
    where s.enterprise_id=${eid} and s.status='published'
      ${cityCode ? sql`and v.content->>'cityCode'=${cityCode}` : sql``} ${district ? sql`and v.content->>'district'=${district}` : sql``}
    order by s.updated_at desc,s.id desc limit 200`);
  const result = [];
  for (const candidate of candidates) {
    const material = await publishedPublicMaterial(tx, eid, String(candidate.id));
    if (material) result.push(await publicMaterialDto(tx, material.site, material.version));
  }
  return result;
}
export class PublicSiteCatalog {
  constructor(readonly enterpriseId: string) { id(enterpriseId); }
  private scope<T>(fn: (tx: PostgresTransaction) => Promise<T>) {
    return withTenantTransaction(this.enterpriseId, async tx => {
      if (!await one(tx, sql`select e.id from app.enterprises e join app.assistant_enterprise_settings s on s.enterprise_id=e.id and s.enabled
        where e.id=${this.enterpriseId} and e.status='active' for share of e,s`)) fail('public_site_unavailable', 404);
      return fn(tx);
    });
  }
  list(cityCode = '', district = '') {
    if ((cityCode && !/^[1-9]\d{5}$/.test(cityCode)) || district.length > 50) fail('invalid_public_material', 422);
    return this.scope(async tx => ({ items: await publicCandidates(tx, this.enterpriseId, cityCode, district) }));
  }
  areas() {
    return this.scope(async tx => {
      const items = await publicCandidates(tx, this.enterpriseId), seen = new Set<string>();
      return { items: items.filter(item => { const k = item.cityCode + ':' + item.district; if (seen.has(k)) return false; seen.add(k); return true; })
        .map(item => ({ cityCode: item.cityCode, cityName: item.cityName, district: item.district, label: item.cityName + ' · ' + item.district })) };
    });
  }
  detail(siteId: string, versionId?: string) {
    id(siteId); if (versionId) id(versionId);
    return this.scope(async tx => {
      const material = await publishedPublicMaterial(tx, this.enterpriseId, siteId, versionId);
      if (!material) fail('public_site_unavailable', 404);
      return publicMaterialDto(tx, material.site, material.version);
    });
  }
  media(siteId: string, versionId: string, mediaId: string) {
    [siteId, versionId, mediaId].forEach(id);
    return this.scope(async tx => {
      if (!await publishedPublicMaterial(tx, this.enterpriseId, siteId, versionId)) fail('public_site_unavailable', 404);
      const media = await one(tx, sql`select data,mime_type from app.construction_public_media
        where enterprise_id=${this.enterpriseId} and site_id=${siteId} and version_id=${versionId} and id=${mediaId}`);
      if (!media) fail('public_site_unavailable', 404);
      return { data: media.data as Buffer, mimeType: String(media.mime_type) };
    });
  }
}
