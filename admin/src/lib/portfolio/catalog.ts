import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, idempotent } from '@/lib/assistant/core/conversation';
import { readMemory } from '@/lib/assistant/agent/memory';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { createPortfolioEntry } from './entry';
import { CITY_OPTIONS } from './regions';
import { LAYOUT_OPTIONS, STYLE_OPTIONS } from './options';
import { cityCode, shortText } from './contracts';
import { matchDesigners } from './designer-match';
import { portfolioCandidates, type PublicWork } from './public-query';

type RecommendationItem = {
  authorId: string; authorName: string; professionalTitle: string | null; experienceLabel: string;
  layoutSpecialties: string[]; portraitAvailable: boolean; work: PublicWork; reason: string; match: string;
};
type Preference = { operationId: string; workId: string; versionId: string; authorId: string; sentiment: string; sourceMessageId: string; supersedes: string | null; createdAt: string };
const recommendationNotice = '作品仅供风格/户型与服务方向参考；同小区不代表同户型，不承诺可预约日期。';
/** All public projections recheck the live publication, author and rights.
 * No published DTO contains permission evidence, private owner details or internal source files.
 * The caller must already own this consultation; views never create leads or change attribution.
 */
export class PortfolioCatalog {
  constructor(readonly actor: ActorContext, readonly conversationId: string,
    private readonly handoffHooks?: ConstructorParameters<typeof HandoffWorkflow>[1]) {}
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
  async recommend(input: Row = {}): Promise<{ items: RecommendationItem[]; notice: string; needContext?: boolean }> {
    if (!Object.keys(input).length) {
      const context = await this.authorized(async (_tx, c) => {
        const facts = readMemory(c.entry_snapshot).facts.filter(f => f.status === 'current');
        const housing = facts.filter(f => f.field === 'housing').map(f => f.value).join(' ');
        const styles = facts.filter(f => f.field === 'style').map(f => f.value).join(' ');
        // Questions, negation and multiple directions must not silently become a match.
        const uncertain = /[？?]|不确定|没想好|不喜欢|不要|不考虑|不是|不在|不做|不想/;
        const cities = uncertain.test(housing) ? [] : CITY_OPTIONS.filter(c => housing.includes(c.label.replace(/市$/, '')));
        const matched = uncertain.test(styles) ? [] : STYLE_OPTIONS.filter(s => s !== '其他' && styles.includes(s));
        const layouts = uncertain.test(housing) ? [] : LAYOUT_OPTIONS.filter(l => l !== '其他' && housing.includes(l));
        return cities.length === 1 && (matched.length === 1 || layouts.length === 1)
          ? { cityCode: cities[0].value, style: matched[0] || '', layout: layouts[0] || '' } : null;
      });
      if (!context) return { items: [], needContext: true, notice: '可以先在对话里说说房子所在城市，以及喜欢的风格或户型，再看看合适的设计师。' };
      return this.recommend(context);
    }
    const city = cityCode(input.cityCode);
    const style = input.style == null || input.style === '' ? '' : shortText(input.style, 30, true);
    const layout = input.layout == null || input.layout === '' ? '' : shortText(input.layout, 30, true);
    if ((!style && !layout) || (style && !STYLE_OPTIONS.includes(style)) || (layout && !LAYOUT_OPTIONS.includes(layout))) fail('invalid_portfolio', 422);
    const community = input.communityId == null ? null : id(input.communityId);
    return this.authorized(async tx => {
      if (community && !await one(tx, sql`select id from app.portfolio_communities where enterprise_id=${this.actor.enterpriseId} and id=${community} and city_code=${city}`)) fail('community_candidate_invalid', 422);
      const candidates = (await portfolioCandidates(tx, this.actor.enterpriseId, { city, style: style || undefined, layout: layout || undefined, recommend: true }))
        .filter(c => c.profile.cities.some(p => p.code === city && (!p.districts.length || p.districts.includes(c.work.district))));
      const items: RecommendationItem[] = matchDesigners(candidates, { community, style, layout }).map(({ candidate, reason, match }) => ({
        authorId: candidate.work.authorId, authorName: candidate.work.authorName, professionalTitle: candidate.professional?.title ?? null,
        experienceLabel: candidate.professional?.experienceLabel ?? '', layoutSpecialties: candidate.profile.layoutSpecialties,
        portraitAvailable: candidate.portraitAvailable, work: candidate.work, reason, match,
      }));
      return { items, notice: recommendationNotice };
    });
  }
  designer(authorId: string) {
    id(authorId);
    return this.authorized(async tx => {
      const candidates = await portfolioCandidates(tx, this.actor.enterpriseId, { authorId });
      if (!candidates.length) fail('portfolio_not_found', 404);
      const profile = candidates[0].profile;
      candidates.sort((a, b) => {
        const rank = (wid: string) => { const n = profile.featuredWorkIds.indexOf(wid); return n < 0 ? 10000 : n; };
        return rank(a.work.id) - rank(b.work.id);
      });
      return { id: authorId, name: candidates[0].work.authorName, bio: profile.bio, cities: profile.cities, styles: profile.styles,
        layoutSpecialties: profile.layoutSpecialties, professionalTitle: candidates[0].professional?.title ?? null,
        experienceLabel: candidates[0].professional?.experienceLabel ?? '', portraitAvailable: candidates[0].portraitAvailable,
        works: candidates.map(c => c.work) };
    });
  }
  portrait(authorId: string) {
    id(authorId);
    return this.authorized(async tx => {
      if (!(await portfolioCandidates(tx, this.actor.enterpriseId, { authorId })).length) fail('portfolio_not_found', 404);
      const portrait = await one(tx, sql`select image_base64 from app.portfolio_portraits where enterprise_id=${this.actor.enterpriseId} and author_id=${authorId}`);
      if (!portrait) fail('portfolio_not_found', 404);
      return Buffer.from(String(portrait.image_base64), 'base64');
    });
  }
  work(workId: string, versionId?: string) {
    id(workId); if (versionId) id(versionId);
    return this.authorized(async (tx, c) => {
      const candidate = (await portfolioCandidates(tx, this.actor.enterpriseId, { workId }))[0];
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
      const candidate = (await portfolioCandidates(tx, this.actor.enterpriseId, { workId }))[0];
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
      const candidate = (await portfolioCandidates(tx, this.actor.enterpriseId, { workId }))[0];
      if (!candidate || candidate.work.versionId !== versionId) fail('portfolio_not_found', 404);
      return createPortfolioEntry({ enterpriseId: this.actor.enterpriseId, workId, versionId, authorId: candidate.work.authorId });
    });
  }
  async contact(workId: string, input: Row, requestKey: string) {
    if (Object.keys(input).some(k => k !== 'versionId')) fail('invalid_portfolio', 422);
    const work = await this.work(id(workId), id(input.versionId));
    return new HandoffWorkflow(this.actor, this.handoffHooks).customerWrite(this.conversationId, key(requestKey), { action: 'request', recipientId: work.authorId }, {
      portfolio: { workId, versionId: work.versionId, authorId: work.authorId }, guard: async (repo, c) => {
        const candidate = (await portfolioCandidates(repo.tx, this.actor.enterpriseId, { workId }))[0];
        if (!candidate || candidate.work.versionId !== input.versionId) fail('portfolio_not_found', 404);
        const owner = await one(repo.tx, sql`select assigned_to from app.leads where enterprise_id=${this.actor.enterpriseId}
          and customer_user_id=${this.actor.principal.kind === 'user' ? this.actor.principal.userId : ''} and assigned_to is not null
          and archived_at is null and status not in ('closed','converted') and assigned_to<>${work.authorId} limit 1 for share`);
        const h = (c.entry_snapshot as Row).handoff as Row | undefined;
        if (owner || (h?.ownerId && h.ownerId !== work.authorId)
          || (h?.state === 'waiting' && h.recipientId && h.recipientId !== work.authorId)) fail('portfolio_owner_conflict', 409);
      },
    });
  }
  image(workId: string, versionId: string, assetId: string) {
    id(workId); id(versionId); id(assetId);
    return this.authorized(async tx => {
      const candidate = (await portfolioCandidates(tx, this.actor.enterpriseId, { workId }))[0];
      if (!candidate || candidate.work.versionId !== versionId || !candidate.work.images.some(i => i.assetId === assetId)) fail('portfolio_not_found', 404);
      const asset = await one(tx, sql`select image_base64 from app.portfolio_assets where enterprise_id=${this.actor.enterpriseId} and work_id=${workId} and id=${assetId}`);
      if (!asset) fail('portfolio_not_found', 404);
      return Buffer.from(String(asset.image_base64), 'base64');
    });
  }
}
export async function portfolioCatalogHttp(request: Request, actor: ActorContext, conversationId: string, path: string[]) {
  const params = new URL(request.url).searchParams, service = new PortfolioCatalog(actor, conversationId);
  const allowed = path.join('/') === 'recommendations' ? ['cityCode', 'style', 'layout', 'communityId']
    : path[0] === 'designers' && path.length === 3 && path[2] === 'portrait' ? ['format']
    : path[0] === 'works' && path.length === 4 ? ['versionId', 'format'] : path[0] === 'works' ? ['versionId'] : [];
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
  else if (path.length === 3 && path[0] === 'designers' && path[2] === 'portrait') {
    if (params.has('format') && params.get('format') !== 'base64') fail('invalid_portfolio', 422);
    const bytes = await service.portrait(id(path[1]));
    if (params.get('format') === 'base64') return NextResponse.json({ success: true, data: { mimeType: 'image/jpeg', imageBase64: bytes.toString('base64') } }, { headers: { 'Cache-Control': 'private, no-store' } });
    return new NextResponse(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
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
