import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { expected } from '@/lib/assistant/knowledge/service';
import { EMPTY_WORK, cityCode, designerProfile, object, shortText, workContent, type WorkContent } from './contracts';
import { candidateToken, readCandidate, type CommunityPoi, type CommunityProviderConfig } from './community-provider';
import { getCommunityRuntimeConfig } from '@/lib/map-services/config';
import { createCommunityProvider, type CommunityProvider } from '@/lib/map-services/providers';

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
async function author(tx: PostgresTransaction, eid: string, aid: unknown) {
  const found = await one(tx, sql`select id,display_name,professional_profile_locked from app.admin_users where enterprise_id=${eid} and id=${id(aid)} and role='designer' and status='active' for share`);
  if (!found) fail('portfolio_author_unavailable', 422);
  return found;
}
async function validateContent(tx: PostgresTransaction, eid: string, wid: string, content: WorkContent) {
  if (content.communityId) {
    const c = await one(tx, sql`select id from app.portfolio_communities where enterprise_id=${eid} and id=${content.communityId} and city_code=${content.cityCode}`);
    if (!c) fail('community_candidate_invalid', 422);
  }
  const assets = await rows(tx, sql`select id from app.portfolio_assets where enterprise_id=${eid} and work_id=${wid}`);
  if (content.images.some(i => !assets.some(a => String(a.id) === i.assetId))) fail('portfolio_asset_unavailable', 422);
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
      const read = ['list', 'detail', 'asset', 'authors', 'profile', 'communities', 'communityRequests'].includes(action);
      const run = async (): Promise<Row> => {
        if (action === 'authors') return { items: await rows(tx, sql`select id,display_name,professional_title,professional_profile_locked from app.admin_users
          where enterprise_id=${eid} and role='designer' and status='active' ${manager ? sql`` : sql`and id=${a.adminId}`} order by id`) };
        if (action === 'profile' || action === 'saveProfile') {
          if (!manager && input.authorId !== undefined && input.authorId !== a.adminId) fail('portfolio_forbidden', 403);
          const aid = manager ? id(input.authorId) : a.adminId; await author(tx, eid, aid);
          // Lock the logical profile even before its first row exists, so two
          // first saves cannot both accept expectedVersion=0 and overwrite.
          if (action === 'saveProfile') await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portfolio-profile:${eid}:${aid}`},0))`);
          const profile = await one(tx, sql`select content,version from app.portfolio_profiles where enterprise_id=${eid} and author_id=${aid} for update`);
          if (action === 'profile') return profile || { content: { bio: '', cities: [], styles: [], featuredWorkIds: [] }, version: 0 };
          if (input.expectedVersion !== Number(profile?.version || 0)) fail('version_conflict');
          const content = designerProfile(input.content);
          for (const wid of content.featuredWorkIds) if (!await one(tx, sql`select id from app.portfolio_works where enterprise_id=${eid} and id=${wid} and author_id=${aid} and kind='designer_work'`)) fail('portfolio_forbidden', 403);
          return (await one(tx, sql`insert into app.portfolio_profiles(enterprise_id,author_id,content) values(${eid},${aid},${JSON.stringify(content)}::jsonb)
            on conflict(enterprise_id,author_id) do update set content=excluded.content,version=app.portfolio_profiles.version+1,updated_at=now() returning content,version`))!;
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
          if (content.images.length) fail('invalid_portfolio', 422);
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
        if (action === 'save') {
          if (!['draft', 'returned'].includes(String(v.status))) fail('portfolio_draft_required');
          content = workContent(input.content); await validateContent(tx, eid, wid, content);
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
        await tx.execute(sql`insert into app.portfolio_audits(enterprise_id,work_id,version_id,actor_id,action,note) values(${eid},${wid},${String(action === 'withdraw' ? w.published_version_id : v.id)},${a.adminId},${action},${shortText(input.note ?? '', 500)})`);
        return { id: wid, version: Number(w.version) + 1 };
      };
      if (read) return run();
      key(requestKey);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portfolio:${eid}:${a.adminId}:${requestKey}`},0))`);
      const actor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: a.adminId }, contextVersion: 1, capabilities: [] };
      // Permission is rechecked above; resource access is checked again even for a retried operation.
      if (input.workId) {
        if (!await one(tx, sql`select id from app.portfolio_works where enterprise_id=${eid} and id=${id(input.workId)} ${manager ? sql`` : sql`and author_id=${a.adminId} and kind='designer_work'`}`)) fail('portfolio_not_found', 404);
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
