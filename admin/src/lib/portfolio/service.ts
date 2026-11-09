import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { expected } from '@/lib/assistant/knowledge/service';
import { EMPTY_WORK, cityCode, designerProfile, object, shortText, workContent, workAssetIds, type WorkContent } from './contracts';
import { candidateToken, readCandidate, type CommunityPoi, type CommunityProviderConfig } from './community-provider';
import { getCommunityRuntimeConfig } from '@/lib/map-services/config';
import { createCommunityProvider, type CommunityProvider } from '@/lib/map-services/providers';
import { publicProfessionalForRow } from './public-query';
import { assertCopyCurrent, copyWork } from './copy-service';
import { copySource, type PortfolioCopy } from './copy-contract';
import { contactEditorView, saveContact, storedContact } from './public-contact';

export type PortfolioActor = { enterpriseId: string; adminId: string };
export async function portfolioAccess(tx: PostgresTransaction, actor: PortfolioActor) {
  id(actor.enterpriseId); id(actor.adminId);
  if (!await one(tx, sql`select id from app.enterprises where id=${actor.enterpriseId} and status='active' for share`)) fail('portfolio_not_found', 404);
  const found = await one(tx, sql`select app.portfolio_actor_access(${actor.adminId}::bigint,${actor.enterpriseId}::bigint) as access`);
  if (!found?.access) fail('portfolio_forbidden', 403);
  return found.access === 'manager';
}
const workFields = sql`w.id,w.kind,w.author_id,w.head_version_id,w.published_version_id,w.withdrawn,w.version,w.updated_at`;
function workDto(w: Row) { return { ...w, id: String(w.id), author_id: w.author_id == null ? null : String(w.author_id), head_version_id: String(w.head_version_id), published_version_id: w.published_version_id == null ? null : String(w.published_version_id) }; }
function checkVersion(w: Row, value: unknown) { if (expected(value) !== Number(w.version)) fail('version_conflict'); }
function templateRef(raw: unknown): { source: 'platform' | 'enterprise'; templateId: string } {
  const match = /^(platform|enterprise)-([1-9]\d*)$/.exec(String(raw ?? ''));
  if (!match) fail('portfolio_template_not_found', 404);
  return { source: match[1] as 'platform' | 'enterprise', templateId: match[2] };
}
async function author(tx: PostgresTransaction, eid: string, aid: unknown) {
  const found = await one(tx, sql`select id,display_name,professional_profile_locked from app.admin_users where enterprise_id=${eid} and id=${id(aid)} and role='designer' and status='active' for share`);
  if (!found) fail('portfolio_author_unavailable', 422);
  return found;
}
async function validateContent(tx: PostgresTransaction, eid: string, wid: string, content: WorkContent) {
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 24000) fail('invalid_portfolio', 422);
  if (content.communityId) {
    const c = await one(tx, sql`select id from app.portfolio_communities where enterprise_id=${eid} and id=${content.communityId} and city_code=${content.cityCode}`);
    if (!c) fail('community_candidate_invalid', 422);
  }
  const assets = await rows(tx, sql`select id from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid}`);
  if (workAssetIds(content).some(assetId => !assets.some(a => String(a.id) === assetId))) fail('portfolio_asset_unavailable', 422);
}
async function prepareImage(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 5600000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail('invalid_portfolio_image', 422);
  try {
    const input = Buffer.from(raw, 'base64');
    if (input.toString('base64') !== raw) fail('invalid_portfolio_image', 422);
    const image = sharp(input, { limitInputPixels: 24000000, animated: false });
    const meta = await image.metadata();
    if (!['png', 'jpeg'].includes(meta.format || '') || (meta.pages || 1) > 1) fail('invalid_portfolio_image', 422);
    for (const [size, quality] of [[1200, 75], [1200, 60], [960, 55], [800, 45]]) {
      const bytes = await image.clone().rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (bytes.length <= 300 * 1024) return bytes.toString('base64');
    }
  } catch { return fail('invalid_portfolio_image', 422); }
  return fail('invalid_portfolio_image', 422);
}
async function preparePortrait(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 5600000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail('invalid_portfolio_image', 422);
  try {
    const input = Buffer.from(raw, 'base64');
    if (input.toString('base64') !== raw) fail('invalid_portfolio_image', 422);
    const image = sharp(input, { limitInputPixels: 24000000, animated: false });
    const meta = await image.metadata();
    if (!['png', 'jpeg'].includes(meta.format || '') || (meta.pages || 1) > 1) fail('invalid_portfolio_image', 422);
    for (const quality of [82, 72, 62, 52, 42]) {
      const bytes = await image.clone().rotate().resize(512, 512, { fit: 'cover' }).flatten({ background: '#fff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (bytes.length <= 300 * 1024) { const imageBase64 = bytes.toString('base64'); return { imageBase64, hash: fingerprint(imageBase64) }; }
    }
  } catch (error) { if (error instanceof AssistantError) throw error; }
  return fail('invalid_portfolio_image', 422);
}
export class PortfolioService {
  constructor(readonly actor: PortfolioActor, private readonly dependencies: { provider?: CommunityProvider } = {}) {}
  async execute(action: string, input: Row = {}, requestKey?: string): Promise<Row> {
    const a = this.actor, eid = a.enterpriseId;
    let selectedPoi: CommunityPoi | undefined;
    let selectedConfig: CommunityProviderConfig | undefined;
    if (action === 'bindCommunity') {
      // Count each external attempt in its own committed transaction, including failed details.
      // A replay returns the original result without spending another provider request.
      const prior = await withTenantTransaction(eid, async tx => {
        await portfolioAccess(tx, a); key(requestKey);
        const old = await one(tx, sql`select request_hash,result from app.assistant_idempotency_records where enterprise_id=${eid} and principal_key=${'admin:' + a.adminId} and operation='portfolio:bindCommunity' and key=${requestKey!}`);
        if (old && old.request_hash !== fingerprint(input)) fail('idempotency_conflict');
        return old;
      });
      if (prior) return prior.result as Row;
      const config = this.dependencies.provider?.config || await getCommunityRuntimeConfig(), candidate = await readCandidate(input.token, eid, a.adminId);
      selectedConfig = config;
      if (candidate.providerKey !== (config.providerKey || 'amap') || candidate.configRevision !== config.configRevision) fail('community_candidate_changed', 409);
      const usageId = await withTenantTransaction(eid, async tx => { await portfolioAccess(tx, a); return this.reserve(tx, input.pageKey, config.dailyLimit, config.providerKey || 'amap'); });
      try { selectedPoi = await (this.dependencies.provider || createCommunityProvider(config)).detail(candidate.city, candidate.poiId, candidate.name); }
      catch (error) { await this.providerFailure(usageId, error); throw error; }
      if (fingerprint(selectedPoi) !== candidate.hash) fail('community_candidate_changed', 409);
    }
    return withTenantTransaction(eid, async tx => {
      const manager = await portfolioAccess(tx, a);
      const read = ['list', 'detail', 'asset', 'authors', 'profile', 'profileContactQr', 'portrait', 'communities', 'communityRequests', 'templates', 'templateDetail', 'templateAsset'].includes(action);
      const run = async (): Promise<Row> => {
        if (action === 'authors') {
          const items = await rows(tx, sql`select a.id,a.display_name,a.professional_title,a.professional_career_start_year,a.professional_title_visible,e.name as enterprise_name,
            a.professional_title_admin_override,a.professional_profile_locked,a.professional_show_actual_service_count,
            e.professional_designer_title,e.professional_measurer_title,e.professional_default_experience_years,
            e.professional_service_threshold,e.professional_force_enterprise_profile,e.professional_title_visibility_policy,
            (pt.id is not null) as portrait_available
            from app.admin_users a join app.enterprises e on e.id=a.enterprise_id
            left join app.portfolio_portraits pt on pt.enterprise_id=a.enterprise_id and pt.author_id=a.id
            where a.enterprise_id=${eid} and a.role='designer' and a.status='active' ${manager ? sql`` : sql`and a.id=${a.adminId}`} order by a.id`);
          return { items: items.map(item => { const professional = publicProfessionalForRow(item); return { ...item,
            portrait_available: Boolean(item.portrait_available), professionalTitle: professional?.title ?? null, experienceLabel: professional?.experienceLabel ?? '' }; }) };
        }
        if (action === 'portrait' || action === 'savePortrait' || action === 'removePortrait') {
          const aid = input.authorId == null ? a.adminId : id(input.authorId);
          if (!manager && aid !== a.adminId) fail('portfolio_forbidden', 403);
          await author(tx, eid, aid);
          if (action === 'portrait') {
            const portrait = await one(tx, sql`select image_base64 from app.portfolio_portraits where enterprise_id=${eid} and author_id=${aid}`);
            if (!portrait) fail('portfolio_not_found', 404);
            return portrait;
          }
          if (action === 'savePortrait' && aid !== a.adminId) fail('portfolio_forbidden', 403);
          if (action === 'savePortrait' && input.consent !== true) fail('invalid_portfolio', 422);
          if (action === 'removePortrait') {
            await tx.execute(sql`delete from app.portfolio_portraits where enterprise_id=${eid} and author_id=${aid}`);
            return { removed: true };
          }
          const portrait = await preparePortrait(input.imageBase64);
          await tx.execute(sql`insert into app.portfolio_portraits(enterprise_id,author_id,image_base64,content_hash,consent_at,consent_by)
            values(${eid},${aid},${portrait.imageBase64},${portrait.hash},now(),${a.adminId})
            on conflict(enterprise_id,author_id) do update set image_base64=excluded.image_base64,content_hash=excluded.content_hash,
              consent_at=excluded.consent_at,consent_by=excluded.consent_by,updated_at=now()`);
          return { updated: true };
        }
        if (action === 'profile' || action === 'saveProfile' || action === 'profileContactQr') {
          if (!manager && input.authorId !== undefined && input.authorId !== a.adminId) fail('portfolio_forbidden', 403);
          const aid = manager ? id(input.authorId) : a.adminId; await author(tx, eid, aid);
          // Lock the logical profile even before its first row exists, so two
          // first saves cannot both accept expectedVersion=0 and overwrite.
          if (action === 'saveProfile') await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portfolio-profile:${eid}:${aid}`},0))`);
          const profile = await one(tx, sql`select content-'contact' as content,content->'contact' as contact,version
            from app.portfolio_profiles where enterprise_id=${eid} and author_id=${aid} ${action === 'saveProfile' ? sql`for update` : sql`for share`}`);
          const previous = storedContact(profile?.contact);
          if (action === 'profileContactQr') {
            if (!previous.qrImageBase64) fail('portfolio_not_found', 404);
            return { image_base64: previous.qrImageBase64 };
          }
          if (action === 'profile') return { content: designerProfile(profile?.content || { bio: '', cities: [], styles: [], featuredWorkIds: [] }),
            contact: contactEditorView(previous), version: profile?.version || 0 };
          if (input.expectedVersion !== Number(profile?.version || 0)) fail('version_conflict');
          const content = designerProfile(input.content);
          // Older editors can save the rest of the profile without changing its display choices.
          if (profile) {
            const existing = designerProfile(profile.content);
            if (!Object.hasOwn(input.content as object, 'template')) content.template = existing.template;
            if (content.defaultAvatar === undefined && existing.defaultAvatar) content.defaultAvatar = existing.defaultAvatar;
          }
          for (const wid of content.featuredWorkIds) if (!await one(tx, sql`select id from app.portfolio_works where enterprise_id=${eid} and id=${wid} and author_id=${aid} and kind='designer_work'`)) fail('portfolio_forbidden', 403);
          const contact = input.contact === undefined ? previous : await saveContact(input.contact, previous, a.adminId, prepareImage);
          const stored = { ...content, ...(profile?.contact || input.contact !== undefined ? { contact } : {}) };
          const saved = (await one(tx, sql`insert into app.portfolio_profiles(enterprise_id,author_id,content) values(${eid},${aid},${JSON.stringify(stored)}::jsonb)
            on conflict(enterprise_id,author_id) do update set content=excluded.content,version=app.portfolio_profiles.version+1,updated_at=now() returning version`))!;
          return { content, contact: contactEditorView(contact), version: saved.version };
        }
        if (action === 'communities') {
          const code = cityCode(input.cityCode), query = shortText(input.query ?? '', 50), selected = input.communityId ? id(input.communityId) : null;
          return { items: await rows(tx, sql`select id,name,city_code,city_name,district,address,provider from app.portfolio_communities where enterprise_id=${eid} and city_code=${code}
            and (strpos(name,${query})>0 or ${query}='' or id=${selected}) order by (id=${selected}) desc nulls last,id desc limit 20`) };
        }
        if (action === 'communityRequests') return { items: await rows(tx, sql`select * from app.portfolio_community_requests where enterprise_id=${eid}
          ${manager ? sql`` : sql`and requested_by=${a.adminId}`} order by id desc limit 50`) };
        if (action === 'requestCommunity') {
          const content = object(input.content, ['cityCode', 'cityName', 'name', 'district', 'address']);
          return (await one(tx, sql`insert into app.portfolio_community_requests(enterprise_id,requested_by,city_code,city_name,name,district,address)
            values(${eid},${a.adminId},${cityCode(content.cityCode)},${shortText(content.cityName, 50, true)},${shortText(content.name, 100, true)},${shortText(content.district ?? '', 100)},${shortText(content.address ?? '', 200)}) returning id,status`))!;
        }
        if (action === 'reviewCommunity') {
          if (!manager) fail('portfolio_forbidden', 403);
          const request = await one(tx, sql`select * from app.portfolio_community_requests where enterprise_id=${eid} and id=${id(input.requestId)} for update`);
          if (!request || request.status !== 'pending') fail('version_conflict');
          if (typeof input.approve !== 'boolean') fail('invalid_portfolio', 422);
          const note = shortText(input.note, 500, true); let communityId: string | null = null;
          if (input.approve) {
            if (input.existingCommunityId) {
              const community = await one(tx, sql`select id from app.portfolio_communities where enterprise_id=${eid} and id=${id(input.existingCommunityId)} and city_code=${String(request.city_code)}`);
              if (!community) fail('community_candidate_invalid', 422); communityId = String(community.id);
            } else {
              const community = (await one(tx, sql`insert into app.portfolio_communities(enterprise_id,provider,name,city_code,city_name,district,address,provenance,verified_by)
                values(${eid},'verified',${String(request.name)},${String(request.city_code)},${String(request.city_name)},${String(request.district)},${String(request.address)},${note},${a.adminId}) returning id`))!;
              communityId = String(community.id);
            }
          }
          return (await one(tx, sql`update app.portfolio_community_requests set status=${input.approve ? 'approved' : 'rejected'},community_id=${communityId},review_note=${note},reviewed_by=${a.adminId}
            where enterprise_id=${eid} and id=${String(request.id)} returning id,status,community_id`))!;
        }
        if (action === 'bindCommunity') {
          if (!this.dependencies.provider) await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended('platform-map-services',0))`);
          const config = this.dependencies.provider?.config || await getCommunityRuntimeConfig(tx), poi = selectedPoi!;
          if (fingerprint(config) !== fingerprint(selectedConfig)) fail('community_candidate_changed', 409);
          const c = (await one(tx, sql`insert into app.portfolio_communities(enterprise_id,provider,provider_poi_id,name,city_code,city_name,district,address,provenance,verified_by,license_valid_until)
            values(${eid},${config.providerKey || 'amap'},${poi.poiId},${poi.name},${poi.cityCode},${poi.cityName},${poi.district},${poi.address},${config.license},${a.adminId},${config.validUntil || null}::timestamptz)
            on conflict(enterprise_id,provider,provider_poi_id) do update set provider_poi_id=excluded.provider_poi_id returning id,name,city_code,city_name,district,address,provider`))!;
          return c;
        }
        if (action === 'templates') {
          const limit = input.limit === undefined ? 50 : expected(input.limit); if (limit > 100) fail('invalid_portfolio', 422);
          const query = shortText(input.query ?? '', 50), style = shortText(input.style ?? '', 30), layout = shortText(input.layoutType ?? '', 30);
          const platform = await rows(tx, sql`select t.id,t.key,t.title,t.description,t.primary_style,t.layout_types,t.rooms,t.area,t.city_name,t.district,t.status,t.sort_order,
              (select a.id from app.platform_portfolio_template_assets a where a.template_id=t.id order by a.position,a.id limit 1) as cover_asset_id,
              (select count(*) from app.platform_portfolio_template_assets a where a.template_id=t.id) as asset_count
            from app.platform_portfolio_templates t where t.status='published'
              and (${style}='' or t.primary_style=${style})
              and (${query}='' or strpos(t.title,${query})>0 or strpos(t.description,${query})>0)
              and (${layout}='' or t.layout_types ? ${layout})
            order by t.sort_order, t.id desc limit ${limit}`);
          const local = await rows(tx, sql`select t.id,t.key,t.title,t.description,t.primary_style,t.layout_types,t.rooms,t.area,t.city_name,t.district,t.status,t.sort_order,
              (select a.id from app.portfolio_template_assets a where a.enterprise_id=t.enterprise_id and a.template_id=t.id order by a.position,a.id limit 1) as cover_asset_id,
              (select count(*) from app.portfolio_template_assets a where a.enterprise_id=t.enterprise_id and a.template_id=t.id) as asset_count
            from app.portfolio_templates t where t.enterprise_id=${eid} and t.status='published'
              and (${style}='' or t.primary_style=${style})
              and (${query}='' or strpos(t.title,${query})>0 or strpos(t.description,${query})>0)
              and (${layout}='' or t.layout_types ? ${layout})
            order by t.sort_order, t.id desc limit ${limit}`);
          const normalize = (item: Row, scope: 'platform' | 'enterprise') => ({ ...item, id: scope + '-' + String(item.id), scope,
            cover_asset_id: item.cover_asset_id == null ? null : String(item.cover_asset_id), asset_count: Number(item.asset_count), sort_order: Number(item.sort_order) });
          const items = [...platform.map(item => normalize(item, 'platform')), ...local.map(item => normalize(item, 'enterprise'))]
            .sort((left, right) => (Number(left.sort_order) - Number(right.sort_order)) || (Number(String(right.id).split('-').pop()) - Number(String(left.id).split('-').pop())))
            .slice(0, limit);
          return { items };
        }
        if (action === 'templateDetail') {
          const ref = templateRef(input.templateId);
          const template = ref.source === 'platform'
            ? await one(tx, sql`select * from app.platform_portfolio_templates where id=${ref.templateId} and status='published'`)
            : await one(tx, sql`select * from app.portfolio_templates where enterprise_id=${eid} and id=${ref.templateId} and status='published'`);
          if (!template) fail('portfolio_template_not_found', 404);
          const images = ref.source === 'platform'
            ? await rows(tx, sql`select id,space,position,content_hash from app.platform_portfolio_template_assets where template_id=${ref.templateId} order by position,id`)
            : await rows(tx, sql`select id,space,position,content_hash from app.portfolio_template_assets where enterprise_id=${eid} and template_id=${ref.templateId} order by position,id`);
          return { template: { ...template, id: String(input.templateId), scope: ref.source }, images: images.map(image => ({ ...image, id: String(image.id) })) };
        }
        if (action === 'templateAsset') {
          const ref = templateRef(input.templateId);
          const asset = ref.source === 'platform'
            ? await one(tx, sql`select a.image_base64 from app.platform_portfolio_template_assets a
                join app.platform_portfolio_templates t on t.id=a.template_id
                where a.template_id=${ref.templateId} and a.id=${id(input.assetId)} and t.status='published'`)
            : await one(tx, sql`select a.image_base64 from app.portfolio_template_assets a
                join app.portfolio_templates t on t.enterprise_id=a.enterprise_id and t.id=a.template_id
                where a.template_id=${ref.templateId} and a.id=${id(input.assetId)} and t.status='published' and t.enterprise_id=${eid}`);
          if (!asset) fail('portfolio_template_not_found', 404); return asset;
        }
        if (action === 'instantiateTemplate') {
          const ref = templateRef(input.templateId);
          const template = ref.source === 'platform'
            ? await one(tx, sql`select * from app.platform_portfolio_templates where id=${ref.templateId} and status='published'`)
            : await one(tx, sql`select * from app.portfolio_templates where enterprise_id=${eid} and id=${ref.templateId} and status='published' for update`);
          if (!template) fail('portfolio_template_not_found', 404);
          if (!manager && input.authorId !== undefined && input.authorId !== a.adminId) fail('portfolio_forbidden', 403);
          const aid = manager ? id(input.authorId) : a.adminId;
          await author(tx, eid, aid);
          const sources = ref.source === 'platform'
            ? await rows(tx, sql`select image_base64,content_hash,space from app.platform_portfolio_template_assets where template_id=${ref.templateId} order by position,id`)
            : await rows(tx, sql`select image_base64,content_hash,space from app.portfolio_template_assets where enterprise_id=${eid} and template_id=${ref.templateId} order by position,id`);
          if (!sources.length) fail('portfolio_template_invalid', 422);
          const base = workContent(template.content);
          const w = (await one(tx, sql`insert into app.portfolio_works(enterprise_id,kind,author_id,created_by,updated_by) values(${eid},'designer_work',${aid},${a.adminId},${a.adminId}) returning *`))!;
          const images: WorkContent['images'] = []; let coverAssetId = ''; const seen = new Set<string>();
          for (const source of sources) {
            if (seen.has(String(source.content_hash))) continue;
            seen.add(String(source.content_hash));
            const asset = (await one(tx, sql`insert into app.portfolio_assets(enterprise_id,work_id,image_base64,content_hash) values(${eid},${String(w.id)},${source.image_base64},${source.content_hash}) returning id`))!;
            images.push({ assetId: String(asset.id), kind: 'render', aiGenerated: true, showroom: false, caption: `${String(template.title)}·${String(source.space)}效果图`.slice(0, 100), space: String(source.space) });
            if (!coverAssetId) coverAssetId = String(asset.id);
          }
          const content = workContent({ ...base, images, coverAssetId });
          if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 24000) fail('invalid_portfolio', 422);
          await validateContent(tx, eid, String(w.id), content);
          const v = (await one(tx, sql`insert into app.portfolio_versions(enterprise_id,work_id,number,content) values(${eid},${String(w.id)},1,${JSON.stringify(content)}::jsonb) returning id`))!;
          await tx.execute(sql`update app.portfolio_works set head_version_id=${String(v.id)} where enterprise_id=${eid} and id=${String(w.id)}`);
          await tx.execute(sql`insert into app.portfolio_audits(enterprise_id,work_id,version_id,actor_id,action,note) values(${eid},${String(w.id)},${String(v.id)},${a.adminId},'instantiateTemplate',${'template:' + String(input.templateId)})`);
          return { id: String(w.id), version: 1 };
        }
        if (action === 'list') {
          const limit = input.limit === undefined ? 20 : expected(input.limit); if (limit > 100) fail('invalid_portfolio', 422);
          if (input.status && !['draft', 'submitted', 'returned', 'published', 'withdrawn'].includes(String(input.status))) fail('invalid_portfolio', 422);
          const query = shortText(input.query ?? '', 50), style = shortText(input.style ?? '', 30);
          const condition = sql`w.enterprise_id=${eid} ${manager ? sql`` : sql`and w.author_id=${a.adminId} and w.kind='designer_work'`}
            ${input.authorId ? sql`and w.author_id=${id(input.authorId)}` : sql``}
            ${input.kind ? sql`and w.kind=${String(input.kind)}` : sql``}
            ${input.beforeId ? sql`and w.id<${id(input.beforeId)}` : sql``}
            ${input.communityId ? sql`and v.content->>'communityId'=${id(input.communityId)}` : sql``}
            and (${query}='' or strpos(v.content->>'title',${query})>0)
            and (${style}='' or v.content->>'primaryStyle'=${style})
            ${input.status === 'withdrawn' ? sql`and w.withdrawn` : input.status ? sql`and not w.withdrawn and v.status=${String(input.status)}` : sql``}`;
          const items = await rows(tx, sql`select ${workFields},v.status,v.number,v.content,v.review_note,a.display_name as author_name
            from app.portfolio_works w join app.portfolio_versions v on v.enterprise_id=w.enterprise_id and v.id=w.head_version_id
            left join app.admin_users a on a.enterprise_id=w.enterprise_id and a.id=w.author_id where ${condition} order by w.id desc limit ${limit}`);
          return { items: items.map(workDto), manager };
        }
        if (action === 'create') {
          const kind = input.kind ?? 'designer_work';
          if (!manager && input.authorId !== undefined && input.authorId !== a.adminId) fail('portfolio_forbidden', 403);
          if (!['designer_work', 'enterprise_reference'].includes(String(kind)) || (!manager && kind !== 'designer_work')) fail('portfolio_forbidden', 403);
          const aid = kind === 'designer_work' ? manager ? id(input.authorId) : a.adminId : null;
          if (aid) await author(tx, eid, aid);
          const content = workContent(input.content ?? EMPTY_WORK);
          if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 24000) fail('invalid_portfolio', 422);
          if (workAssetIds(content).length) fail('invalid_portfolio', 422);
          const w = (await one(tx, sql`insert into app.portfolio_works(enterprise_id,kind,author_id,created_by,updated_by) values(${eid},${String(kind)},${aid},${a.adminId},${a.adminId}) returning *`))!;
          const v = (await one(tx, sql`insert into app.portfolio_versions(enterprise_id,work_id,number,content) values(${eid},${String(w.id)},1,${JSON.stringify(content)}::jsonb) returning id`))!;
          await tx.execute(sql`update app.portfolio_works set head_version_id=${String(v.id)} where enterprise_id=${eid} and id=${String(w.id)}`);
          return { id: String(w.id), version: 1 };
        }
        const wid = id(input.workId);
        const w = await one(tx, sql`select ${workFields} from app.portfolio_works w where w.enterprise_id=${eid} and w.id=${wid}
          ${manager ? sql`` : sql`and w.author_id=${a.adminId} and w.kind='designer_work'`} for update`);
        if (!w) fail('portfolio_not_found', 404);
        const v = (await one(tx, sql`select * from app.portfolio_versions where enterprise_id=${eid} and id=${String(w.head_version_id)} for update`))!;
        if (action === 'detail') {
          const versions = await rows(tx, sql`select id,number,status,content,review_note,submitted_at,published_at from app.portfolio_versions where enterprise_id=${eid} and work_id=${wid} order by number desc`);
          return { work: workDto(w), head: v, versions, manager, assets: await rows(tx, sql`select id,content_hash from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid} order by id`),
            audits: await rows(tx, sql`select id,version_id,action,note,created_at from app.portfolio_audits where enterprise_id=${eid} and work_id=${wid} order by id desc limit 30`) };
        }
        if (action === 'asset') {
          const asset = await one(tx, sql`select image_base64 from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid} and id=${id(input.assetId)}`);
          if (!asset) fail('portfolio_not_found', 404); return asset;
        }
        checkVersion(w, input.expectedVersion);
        if (action === 'upload') {
          if (!['draft', 'returned'].includes(String(v.status))) fail('portfolio_draft_required');
          const image = await prepareImage(input.imageBase64), hash = fingerprint(image);
          const old = await one(tx, sql`select id from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid} and content_hash=${hash}`);
          if (old) return { assetId: String(old.id), version: w.version };
          const count = (await one(tx, sql`select count(*) n from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid}`))!;
          if (Number(count.n) >= 60) fail('portfolio_asset_limit', 422);
          const asset = (await one(tx, sql`insert into app.portfolio_assets(enterprise_id,work_id,image_base64,content_hash) values(${eid},${wid},${image},${hash}) returning id`))!;
          return { assetId: String(asset.id), version: w.version };
        }
        if (action === 'newDraft') {
          if (v.status !== 'published') fail('portfolio_draft_required');
          const draft = (await one(tx, sql`insert into app.portfolio_versions(enterprise_id,work_id,number,content) values(${eid},${wid},${Number(v.number) + 1},${JSON.stringify(v.content)}::jsonb) returning id`))!;
          await tx.execute(sql`update app.portfolio_works set head_version_id=${String(draft.id)},version=version+1,updated_by=${a.adminId},updated_at=now() where enterprise_id=${eid} and id=${wid}`);
          return { id: wid, version: Number(w.version) + 1 };
        }
        let content = workContent(v.content);
        if (action === 'adoptCopy') {
          if (!['draft', 'returned'].includes(String(v.status))) fail('portfolio_draft_required');
          const task = await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${eid} and created_by=${a.adminId}
            and id=${id(input.taskId)} and kind='portfolio_copy' for update`);
          if (!task || task.state !== 'completed' || (task.request as Row).workId !== wid || !(task.result as Row)?.output) fail('portfolio_copy_stale', 409);
          assertCopyCurrent(task, await copyWork(tx, a, wid), true);
          const output = (task.result as { output: PortfolioCopy }).output;
          content = workContent({ ...content, title: output.title, description: output.description });
          await validateContent(tx, eid, wid, content);
          await tx.execute(sql`update app.portfolio_versions set content=${JSON.stringify(content)}::jsonb,status='draft',review_note='' where enterprise_id=${eid} and id=${String(v.id)}`);
          await tx.execute(sql`update app.assistant_model_tasks set result=${JSON.stringify({ output, adoptedHash: copySource(content, w) })}::jsonb,version=version+1,updated_at=now()
            where enterprise_id=${eid} and id=${String(task.id)}`);
        } else if (action === 'save') {
          if (!['draft', 'returned'].includes(String(v.status))) fail('portfolio_draft_required');
          const incoming = workContent(input.content);
          // Older editors must not erase a reviewed plan pair while editing unrelated fields.
          if (!Object.hasOwn(input.content as object, 'planComparison')) incoming.planComparison = content.planComparison;
          content = incoming; await validateContent(tx, eid, wid, content);
          await tx.execute(sql`update app.portfolio_versions set content=${JSON.stringify(content)}::jsonb,status='draft',review_note='' where enterprise_id=${eid} and id=${String(v.id)}`);
        } else if (action === 'submit' || action === 'publish') {
          if ((action === 'submit' && !['draft', 'returned'].includes(String(v.status))) || (action === 'publish' && (!manager || v.status !== 'submitted'))) fail('portfolio_forbidden', 403);
          content = workContent(v.content, true); await validateContent(tx, eid, wid, content);
          if (w.author_id) await author(tx, eid, String(w.author_id));
          if (w.kind === 'enterprise_reference' && content.showOnProfile) fail('portfolio_reference_not_original', 422);
          const searchText = [content.title, content.description, content.primaryStyle, ...content.secondaryStyles, content.cityName, content.district].join(' ');
          if (action === 'submit') await tx.execute(sql`update app.portfolio_versions set status='submitted',submitted_at=now(),search_text=${searchText},review_note='' where enterprise_id=${eid} and id=${String(v.id)}`);
          else {
            await tx.execute(sql`update app.portfolio_versions set status='published',published_at=now(),reviewed_by=${a.adminId} where enterprise_id=${eid} and id=${String(v.id)}`);
            await tx.execute(sql`update app.portfolio_works set published_version_id=${String(v.id)},withdrawn=false where enterprise_id=${eid} and id=${wid}`);
          }
        } else if (action === 'return') {
          if (!manager || v.status !== 'submitted') fail('portfolio_forbidden', 403);
          await tx.execute(sql`update app.portfolio_versions set status='returned',review_note=${shortText(input.note, 500, true)},reviewed_by=${a.adminId} where enterprise_id=${eid} and id=${String(v.id)}`);
        } else if (action === 'withdraw') {
          if (!manager || !w.published_version_id || w.withdrawn) fail('portfolio_forbidden', 403);
          await tx.execute(sql`update app.portfolio_works set withdrawn=true where enterprise_id=${eid} and id=${wid}`);
        } else return fail('portfolio_not_found', 404);
        await tx.execute(sql`update app.portfolio_works set version=version+1,updated_at=now(),updated_by=${a.adminId} where enterprise_id=${eid} and id=${wid}`);
        await tx.execute(sql`insert into app.portfolio_audits(enterprise_id,work_id,version_id,actor_id,action,note) values(${eid},${wid},${String(action === 'withdraw' ? w.published_version_id : v.id)},${a.adminId},${action},${action === 'adoptCopy' ? 'copy-task:' + id(input.taskId) : shortText(input.note ?? '', 500)})`);
        return { id: wid, version: Number(w.version) + 1 };
      };
      if (read) return run();
      key(requestKey);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portfolio:${eid}:${a.adminId}:${requestKey}`},0))`);
      const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: a.adminId }, contextVersion: 1, capabilities: [] };
      // Permission is rechecked above; resource access is checked again even for a retried operation.
      if (input.workId) {
        if (!await one(tx, sql`select id from app.portfolio_works where enterprise_id=${eid} and id=${id(input.workId)} ${manager ? sql`` : sql`and author_id=${a.adminId} and kind='designer_work'`}`)) fail('portfolio_not_found', 404);
        if (action === 'adoptCopy') {
          const current = await copyWork(tx, a, String(input.workId));
          const task = await one(tx, sql`select * from app.assistant_model_tasks where enterprise_id=${eid} and created_by=${a.adminId} and id=${id(input.taskId)} and kind='portfolio_copy'`);
          if (!task || (task.request as Row).workId !== String(input.workId)) fail('portfolio_copy_stale', 409);
          assertCopyCurrent(task, current);
        }
      }
      return idempotent(tx, actor, 'portfolio:' + action, requestKey!, input, run);
    });
  }
  private async reserve(tx: PostgresTransaction, page: unknown, limit: number, providerKey: string) {
    const pageKey = shortText(page, 64, true);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(pageKey)) fail('invalid_community_query', 422);
    const allowed = await one(tx, sql`select app.portfolio_reserve_provider(${this.actor.adminId}::bigint,${this.actor.enterpriseId}::bigint,${pageKey},${limit},${providerKey}) as allowed`);
    if (!allowed?.allowed) fail('community_rate_limited', 429);
    const usage = (await one(tx, sql`select id from app.portfolio_provider_usage where enterprise_id=${this.actor.enterpriseId} and actor_id=${this.actor.adminId} and page_key=${pageKey} order by id desc limit 1`))!;
    return String(usage.id);
  }
  private async providerFailure(usageId: string, error: unknown) {
    const code = error instanceof AssistantError ? error.code : 'community_provider_unavailable';
    if (!['community_provider_denied', 'community_provider_quota', 'community_provider_unavailable'].includes(code)) return;
    await withTenantTransaction(this.actor.enterpriseId, async tx => {
      await tx.execute(sql`update app.portfolio_provider_usage set failure_code=${code},blocked_until=${code === 'community_provider_quota' ? sql`(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai'` : code === 'community_provider_denied' ? sql`now()+interval '10 minutes'` : sql`now()+interval '30 seconds'`}
        where enterprise_id=${this.actor.enterpriseId} and actor_id=${this.actor.adminId} and id=${usageId}`);
    });
  }
  async searchProvider(input: Row): Promise<Row> {
    const city = cityCode(input.cityCode), query = shortText(input.query, 50, true);
    if ([...query].length < 2) fail('invalid_community_query', 422);
    await withTenantTransaction(this.actor.enterpriseId, tx => portfolioAccess(tx, this.actor));
    const config = this.dependencies.provider?.config || await getCommunityRuntimeConfig();
    const usageId = await withTenantTransaction(this.actor.enterpriseId, async tx => { await portfolioAccess(tx, this.actor); return this.reserve(tx, input.pageKey, config.dailyLimit, config.providerKey || 'amap'); });
    let items: CommunityPoi[];
    try { items = await (this.dependencies.provider || createCommunityProvider(config)).search(city, query); }
    catch (error) { await this.providerFailure(usageId, error); throw error; }
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      await portfolioAccess(tx, this.actor);
      if (!this.dependencies.provider) {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended('platform-map-services',0))`);
        if (fingerprint(await getCommunityRuntimeConfig(tx)) !== fingerprint(config)) fail('community_candidate_changed', 409);
      }
      return { items: await Promise.all(items.map(async poi => ({ ...poi, providerKey: config.providerKey || 'amap', token: await candidateToken(this.actor.enterpriseId, this.actor.adminId, poi, config.providerKey || 'amap', config.configRevision) }))) };
    });
  }
}
