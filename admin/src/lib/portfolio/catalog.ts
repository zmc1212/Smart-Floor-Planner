import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, idempotent } from '@/lib/assistant/core/conversation';
import { readMemory } from '@/lib/assistant/agent/memory';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { createPortfolioEntry } from './entry';
import { CITY_OPTIONS } from './regions';
import { STYLE_OPTIONS } from './options';
import { cityCode, designerProfile, shortText, workContent, type WorkContent } from './contracts';

type PublicWork = {
  id: string; versionId: string; authorId: string; authorName: string; title: string; description: string;
  primaryStyle: string; secondaryStyles: string[]; authorRole: string; cityCode: string; cityName: string; district: string;
  community: { id: string; name: string } | null; area: number | null; rooms: string; coverAssetId: string;
  images: Array<{ assetId: string; kind: 'render' | 'photo'; aiGenerated: boolean; showroom: boolean; caption: string }>;
};
type Candidate = { work: PublicWork; content: WorkContent; profile: ReturnType<typeof designerProfile> };
type Preference = { operationId: string; workId: string; versionId: string; authorId: string; sentiment: string; sourceMessageId: string; supersedes: string | null; createdAt: string };
/** All public projections recheck the live publication, author and rights.
 * No published DTO contains permission evidence, private owner details or internal source files.
 * The caller must already own this consultation; views never create leads or change attribution.
 */
export class PortfolioCatalog {
  constructor(readonly actor: ActorContext, readonly conversationId: string) {}
  private async authorized<T>(run: (tx: PostgresTransaction, conversation: Row) => Promise<T>, write = false) {
    requireCapability(this.actor, 'assistant.chat.self');
    if (this.actor.principal.kind !== 'user') fail('portfolio_forbidden', 403);
    id(this.conversationId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor), settings = await repo.settings(write);
      if (!settings?.enabled) fail('assistant_disabled', 403);
      const conversation = await repo.conversation(this.conversationId);
      return run(tx, conversation);
    });
  }
  private async candidates(tx: PostgresTransaction, input: { workId?: string; authorId?: string; city?: string; style?: string; recommend?: boolean } = {}) {
    const candidates = await rows(tx, sql`select w.id,w.author_id,w.published_version_id,v.content,a.display_name,p.content as profile,
      c.id as community_id,c.name as community_name from app.portfolio_works w
      join app.portfolio_versions v on v.enterprise_id=w.enterprise_id and v.work_id=w.id and v.id=w.published_version_id and v.status='published'
      join app.admin_users a on a.enterprise_id=w.enterprise_id and a.id=w.author_id and a.role='designer' and a.status='active' and a.must_change_password=false
      left join app.portfolio_profiles p on p.enterprise_id=w.enterprise_id and p.author_id=w.author_id
      left join app.portfolio_communities c on c.enterprise_id=w.enterprise_id and c.id::text=v.content->>'communityId'
      where w.enterprise_id=${this.actor.enterpriseId} and w.kind='designer_work' and not w.withdrawn and v.content->>'showOnProfile'='true'
      ${input.recommend ? sql`and v.content->>'recommendable'='true'` : sql``}
      ${input.workId ? sql`and w.id=${id(input.workId)}` : sql``} ${input.authorId ? sql`and w.author_id=${id(input.authorId)}` : sql``}
      ${input.city ? sql`and v.content->>'cityCode'=${input.city}` : sql``}
      ${input.style ? sql`and (v.content->>'primaryStyle'=${input.style} or (v.content->'secondaryStyles') ? ${input.style})` : sql``}
      order by w.id desc limit 500 for share of w,v,a`);
    const result: Candidate[] = [];
    for (const row of candidates) {
      let content: WorkContent;
      try { content = workContent(row.content, true); } catch { continue; }
      const profile = designerProfile(row.profile || { bio: '', cities: [], styles: [], featuredWorkIds: [] });
      result.push({ content, profile, work: { id: String(row.id), versionId: String(row.published_version_id), authorId: String(row.author_id), authorName: String(row.display_name || '设计师'),
        title: content.title, description: content.description, primaryStyle: content.primaryStyle, secondaryStyles: content.secondaryStyles, authorRole: content.authorRole,
        cityCode: content.cityCode, cityName: content.cityName, district: content.district, area: content.area, rooms: content.rooms,
        community: row.community_id ? { id: String(row.community_id), name: String(row.community_name) } : null,
        images: content.images, coverAssetId: content.coverAssetId! } });
    }
    return result;
  }
  async recommend(input: Row = {}): Promise<{ items: Array<{ authorId: string; authorName: string; work: PublicWork; reason: string; match: string }>; notice: string; needContext?: boolean }> {
    if (!Object.keys(input).length) {
      const context = await this.authorized(async (_tx, c) => {
        const facts = readMemory(c.entry_snapshot).facts.filter(f => f.status === 'current');
        const housing = facts.filter(f => f.field === 'housing').map(f => f.value).join(' ');
        const styles = facts.filter(f => f.field === 'style').map(f => f.value).join(' ');
        // Questions, negation and multiple directions must not silently become a match.
        const uncertain = /[？?]|不确定|没想好|不喜欢|不要|不考虑|不是|不在|不做|不想/;
        const cities = uncertain.test(housing) ? [] : CITY_OPTIONS.filter(c => housing.includes(c.label.replace(/市$/, '')));
        const matched = uncertain.test(styles) ? [] : STYLE_OPTIONS.filter(s => s !== '其他' && styles.includes(s));
        return cities.length === 1 && matched.length === 1 ? { cityCode: cities[0].value, style: matched[0] } : null;
      });
      if (!context) return { items: [], needContext: true, notice: '可以先在对话里说说房子所在城市和喜欢的风格，再看看合适的设计师。' };
      return this.recommend(context);
    }
    const city = cityCode(input.cityCode), style = shortText(input.style, 30, true), community = input.communityId == null ? null : id(input.communityId);
    return this.authorized(async tx => {
      if (community && !await one(tx, sql`select id from app.portfolio_communities where enterprise_id=${this.actor.enterpriseId} and id=${community} and city_code=${city}`)) fail('community_candidate_invalid', 422);
      const candidates = (await this.candidates(tx, { city, style, recommend: true })).filter(c => c.profile.cities.some(p => p.code === city && (!p.districts.length || p.districts.includes(c.work.district))));
      candidates.sort((a, b) => Number(b.work.community?.id === community && community !== null) - Number(a.work.community?.id === community && community !== null));
      const seen = new Set<string>(), items = [];
      for (const candidate of candidates) {
        if (seen.has(candidate.work.authorId)) continue; seen.add(candidate.work.authorId);
        const sameCommunity = community !== null && candidate.work.community?.id === community;
        items.push({ authorId: candidate.work.authorId, authorName: candidate.work.authorName, work: candidate.work,
          reason: sameCommunity ? `在同一已核验小区有${style}作品` : `服务${candidate.work.cityName}，有${style}公开作品`, match: sameCommunity ? 'community_style' : 'city_style' });
        if (items.length === 3) break;
      }
      return { items, notice: '作品仅供风格与服务方向参考；同小区不代表同户型，不承诺可预约日期。' };
    });
  }
  designer(authorId: string) {
    id(authorId);
    return this.authorized(async tx => {
      const candidates = await this.candidates(tx, { authorId });
      if (!candidates.length) fail('portfolio_not_found', 404);
      const profile = candidates[0].profile;
      candidates.sort((a, b) => {
        const rank = (wid: string) => { const n = profile.featuredWorkIds.indexOf(wid); return n < 0 ? 10000 : n; };
        return rank(a.work.id) - rank(b.work.id);
      });
      return { id: authorId, name: candidates[0].work.authorName, bio: profile.bio, cities: profile.cities, styles: profile.styles, works: candidates.map(c => c.work) };
    });
  }
  work(workId: string, versionId?: string) {
    id(workId); if (versionId) id(versionId);
    return this.authorized(async (tx, c) => {
      const candidate = (await this.candidates(tx, { workId }))[0];
      if (!candidate || (versionId && candidate.work.versionId !== versionId)) fail('portfolio_not_found', 404);
      const preferences = ((c.entry_snapshot as Row).portfolioPreferences || []) as Preference[];
      const current = preferences.filter(p => p.workId === workId && !preferences.some(n => n.supersedes === p.operationId)).at(-1);
      return { ...candidate.work, preference: current?.versionId === candidate.work.versionId ? current.sentiment : null, preferenceVersion: preferences.length };
    });
  }
  preference(workId: string, input: Row, requestKey: string) {
    id(workId); id(input.versionId); key(requestKey);
    if (Object.keys(input).some(k => !['versionId', 'sentiment', 'expectedVersion'].includes(k))
      || !['like', 'dislike'].includes(String(input.sentiment)) || !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) fail('invalid_portfolio', 422);
    return this.authorized(async (tx, c) => {
      const candidate = (await this.candidates(tx, { workId }))[0];
      if (!candidate || candidate.work.versionId !== input.versionId) fail('portfolio_not_found', 404);
      if (c.status !== 'open') fail('conversation_read_only');
      // The consultation lock serializes corrections and idempotent retries.
      return idempotent(tx, this.actor, 'portfolio:preference:' + this.conversationId, requestKey, { workId, ...input }, async () => {
        const preferences = ((c.entry_snapshot as Row).portfolioPreferences || []) as Preference[];
        if (preferences.length !== input.expectedVersion) fail('version_conflict');
        if (preferences.length >= 300) fail('need_memory_limit', 422);
        if (await one(tx, sql`select id from app.assistant_runs where enterprise_id=${this.actor.enterpriseId} and conversation_id=${this.conversationId} and status in ('queued','running')`)) fail('conversation_busy');
        const prior = preferences.filter(p => p.workId === workId && !preferences.some(n => n.supersedes === p.operationId)).at(-1);
        const text = `我${input.sentiment === 'like' ? '喜欢' : '觉得不太适合'}「${candidate.work.title}」这个参考方向。`;
        const message = await appendMessage(tx, this.actor, this.conversationId, { author: 'user', clientMessageId: requestKey,
          purpose: 'portfolio.preference', content: { version: 1, blocks: [{ type: 'text', text }] } });
        const preference: Preference = { operationId: requestKey, workId, versionId: candidate.work.versionId, authorId: candidate.work.authorId,
          sentiment: String(input.sentiment), sourceMessageId: String(message.id), supersedes: prior?.operationId || null, createdAt: new Date().toISOString() };
        await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{portfolioPreferences}',${JSON.stringify([...preferences, preference])}::jsonb),context_revision=context_revision+1
          where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
        return { sentiment: preference.sentiment, preferenceVersion: preferences.length + 1, conversationId: this.conversationId };
      });
    }, true);
  }
  share(workId: string, versionId: string) {
    id(workId); id(versionId);
    return this.authorized(async tx => {
      const candidate = (await this.candidates(tx, { workId }))[0];
      if (!candidate || candidate.work.versionId !== versionId) fail('portfolio_not_found', 404);
      return createPortfolioEntry({ enterpriseId: this.actor.enterpriseId, workId, versionId, authorId: candidate.work.authorId });
    });
  }
  async contact(workId: string, input: Row, requestKey: string) {
    if (Object.keys(input).some(k => k !== 'versionId')) fail('invalid_portfolio', 422);
    const work = await this.work(id(workId), id(input.versionId));
    return new HandoffService(this.actor).customerWrite(this.conversationId, key(requestKey), { action: 'request', recipientId: work.authorId }, async (repo, c) => {
      const candidate = (await this.candidates(repo.tx, { workId }))[0];
      if (!candidate || candidate.work.versionId !== input.versionId) fail('portfolio_not_found', 404);
      const owner = await one(repo.tx, sql`select assigned_to from app.leads where enterprise_id=${this.actor.enterpriseId}
        and customer_user_id=${this.actor.principal.kind === 'user' ? this.actor.principal.userId : ''} and assigned_to is not null
        and archived_at is null and status not in ('closed','converted') and assigned_to<>${work.authorId} limit 1 for share`);
      const h = (c.entry_snapshot as Row).handoff as Row | undefined;
      if (owner || (h?.ownerId && h.ownerId !== work.authorId)) fail('portfolio_owner_conflict', 409);
    }, { workId, versionId: work.versionId, authorId: work.authorId });
  }
  image(workId: string, versionId: string, assetId: string) {
    id(workId); id(versionId); id(assetId);
    return this.authorized(async tx => {
      const candidate = (await this.candidates(tx, { workId }))[0];
      if (!candidate || candidate.work.versionId !== versionId || !candidate.work.images.some(i => i.assetId === assetId)) fail('portfolio_not_found', 404);
      const asset = await one(tx, sql`select image_base64 from app.portfolio_assets where enterprise_id=${this.actor.enterpriseId} and work_id=${workId} and id=${assetId}`);
      if (!asset) fail('portfolio_not_found', 404);
      return Buffer.from(String(asset.image_base64), 'base64');
    });
  }
}
export async function portfolioCatalogHttp(request: Request, actor: ActorContext, conversationId: string, path: string[]) {
  const params = new URL(request.url).searchParams, service = new PortfolioCatalog(actor, conversationId);
  const allowed = path.join('/') === 'recommendations' ? ['cityCode', 'style', 'communityId'] : path[0] === 'works' && path.length === 4 ? ['versionId', 'format'] : path[0] === 'works' ? ['versionId'] : [];
  if ([...params.keys()].some(k => !allowed.includes(k))) fail('invalid_portfolio', 422);
  if (request.method === 'POST' && path.length === 3 && path[0] === 'works') {
    if (params.size) fail('invalid_portfolio', 422);
    const text = await request.text(); if (text.length > 2000) fail('invalid_portfolio', 422);
    let input: Row; try { input = JSON.parse(text); } catch { return fail('invalid_portfolio', 422); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_portfolio', 422);
    const workId = id(path[1]); let data: unknown;
    if (path[2] === 'preference') data = await service.preference(workId, input, key(request.headers.get('Idempotency-Key')));
    else if (path[2] === 'contact') data = await service.contact(workId, input, key(request.headers.get('Idempotency-Key')));
    else if (path[2] === 'share' && Object.keys(input).every(k => k === 'versionId')) data = await service.share(workId, id(input.versionId));
    else return fail('portfolio_not_found', 404);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'GET') fail('portfolio_not_found', 404);
  let data: unknown;
  if (path.join('/') === 'recommendations') data = await service.recommend(Object.fromEntries(params));
  else if (path.length === 2 && path[0] === 'designers') data = await service.designer(id(path[1]));
  else if (path.length === 2 && path[0] === 'works') data = await service.work(id(path[1]), params.has('versionId') ? id(params.get('versionId')) : undefined);
  else if (path.length === 4 && path[0] === 'works' && path[2] === 'assets') {
    if (params.has('format') && params.get('format') !== 'base64') fail('invalid_portfolio', 422);
    const bytes = await service.image(id(path[1]), id(params.get('versionId')), id(path[3]));
    if (params.get('format') === 'base64') return NextResponse.json({ success: true, data: { mimeType: 'image/jpeg', imageBase64: bytes.toString('base64') } }, { headers: { 'Cache-Control': 'private, no-store' } });
    return new NextResponse(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  else fail('portfolio_not_found', 404);
  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
