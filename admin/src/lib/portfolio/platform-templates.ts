import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { expected } from '@/lib/assistant/knowledge/service';
import { shortText } from './contracts';

export type PlatformTemplateStatus = 'published' | 'retired';
export type PlatformTemplateFilters = { query?: unknown; style?: unknown; layoutType?: unknown; status?: unknown; limit?: unknown };

function normalizeStatus(value: unknown) {
  if (value === undefined || value === '' || value === null) return '';
  if (value !== 'published' && value !== 'retired') fail('invalid_portfolio', 422);
  return value;
}

function templateDto(row: Row) {
  return {
    ...row, id: String(row.id), version: Number(row.version), sort_order: Number(row.sort_order),
    cover_asset_id: row.cover_asset_id == null ? null : String(row.cover_asset_id), asset_count: Number(row.asset_count),
  };
}

export async function listPlatformTemplates(filters: PlatformTemplateFilters = {}) {
  const limit = filters.limit === undefined ? 50 : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_portfolio', 422);
  const query = shortText(filters.query ?? '', 50), style = shortText(filters.style ?? '', 30);
  const layout = shortText(filters.layoutType ?? '', 30), status = normalizeStatus(filters.status);
  return withPlatformTransaction(async tx => {
    const items = await rows(tx, sql`select t.id,t.key,t.title,t.description,t.primary_style,t.layout_types,t.rooms,t.area,t.city_name,t.district,
        t.status,t.sort_order,t.version,t.updated_at,
        (select a.id from app.platform_portfolio_template_assets a where a.template_id=t.id order by a.position,a.id limit 1) as cover_asset_id,
        (select count(*) from app.platform_portfolio_template_assets a where a.template_id=t.id) as asset_count
      from app.platform_portfolio_templates t
      where (${status}='' or t.status=${status})
        and (${style}='' or t.primary_style=${style})
        and (${query}='' or strpos(t.title,${query})>0 or strpos(t.description,${query})>0)
        and (${layout}='' or t.layout_types ? ${layout})
      order by t.sort_order, t.id desc limit ${limit}`);
    return { items: items.map(templateDto) };
  });
}

export async function platformTemplateDetail(templateId: unknown) {
  const template = id(templateId);
  return withPlatformTransaction(async tx => {
    const found = await one(tx, sql`select * from app.platform_portfolio_templates where id=${template}`);
    if (!found) fail('portfolio_template_not_found', 404);
    const images = await rows(tx, sql`select id,space,position,content_hash from app.platform_portfolio_template_assets where template_id=${template} order by position,id`);
    return { template: templateDto({ ...found, asset_count: images.length, cover_asset_id: images[0]?.id ?? null }), images: images.map(image => ({ ...image, id: String(image.id) })) };
  });
}

export async function platformTemplateAsset(templateId: unknown, assetId: unknown) {
  const template = id(templateId), asset = id(assetId);
  return withPlatformTransaction(async tx => {
    const found = await one(tx, sql`select a.image_base64 from app.platform_portfolio_template_assets a
      join app.platform_portfolio_templates t on t.id=a.template_id
      where a.template_id=${template} and a.id=${asset}`);
    if (!found) fail('portfolio_template_not_found', 404);
    return found;
  });
}

export async function setPlatformTemplateStatus(templateId: unknown, status: PlatformTemplateStatus, expectedVersion: unknown, actorId: string) {
  const template = id(templateId);
  if (status !== 'published' && status !== 'retired') fail('invalid_portfolio', 422);
  const version = expected(expectedVersion);
  return withPlatformTransaction(async tx => {
    const current = await one(tx, sql`select id,status,version from app.platform_portfolio_templates where id=${template} for update`);
    if (!current) fail('portfolio_template_not_found', 404);
    if (String(current.status) === status) return { id: String(current.id), status, version: Number(current.version) };
    if (Number(current.version) !== version) fail('version_conflict');
    const updated = await one(tx, sql`update app.platform_portfolio_templates
      set status=${status}, version=version+1, updated_by=${actorId}, updated_at=now()
      where id=${template} returning id,status,version`);
    await tx.execute(sql`insert into app.platform_portfolio_template_audits(template_id,actor_id,action,note)
      values(${template},${actorId},${status === 'published' ? 'publish' : 'retire'},'')`);
    return { id: String(updated!.id), status: String(updated!.status), version: Number(updated!.version) };
  });
}
