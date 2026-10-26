import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { id, type ActorContext } from '@/lib/assistant/contracts';
import { readMemory } from '@/lib/assistant/agent/memory';
import { CITY_OPTIONS } from './regions';
import { LAYOUT_OPTIONS, STYLE_OPTIONS } from './options';
import { matchDesigners } from './designer-match';
import { portfolioCandidates, type Candidate } from './public-query';

export const designerNotice = '作品仅供风格/户型与服务方向参考；同小区不代表同户型，不承诺可预约日期。';
const uncertain = /[？?]|不确定|没想好|不喜欢|不要|不考虑|不是|不在|不做|不想/;
const negation = /不确定|没想好|不喜欢|不要|不考虑|不是|不在|不做|不想/;

export type DesignerQuery = { cityCode: string; style: string; layout: string };
export type DesignerCard = {
  authorId: string; authorName: string; professionalTitle: string | null; experienceLabel: string;
  layoutSpecialties: string[]; portraitAvailable: boolean;
  work: {
    id: string; versionId: string; title: string; coverAssetId: string; primaryStyle: string; secondaryStyles: string[];
    layoutTypes: string[]; cityName: string; district: string; communityName: string; tourCount: number;
  };
  reason: string; match: string;
};
export type DesignerRecommendation = { items: DesignerCard[]; notice: string };

/** Matches only taxonomy values that already appear in the conversation.
 * A model-supplied query may restate them but can never introduce a city,
 * style or layout the customer did not say. */
export function resolveDesignerQuery(input: { memoryHousing?: string; memoryStyle?: string; triggerText?: string; input?: Row }): DesignerQuery | null {
  let housing = input.memoryHousing || '', style = input.memoryStyle || '';
  if (uncertain.test(housing)) housing = '';
  if (uncertain.test(style)) style = '';
  const trigger = input.triggerText || '';
  if (negation.test(trigger)) return null;
  const corpus = [housing, style, trigger].filter(Boolean).join(' ');
  const modelQuery = typeof input.input?.query === 'string' ? input.input.query : '';
  const known = [...CITY_OPTIONS.map(option => option.label.replace(/市$/, '')), ...STYLE_OPTIONS.filter(option => option !== '其他'), ...LAYOUT_OPTIONS.filter(option => option !== '其他')];
  if (modelQuery && known.some(value => modelQuery.includes(value) && !corpus.includes(value))) return null;
  const cityMatches = CITY_OPTIONS.filter(option => corpus.includes(option.label.replace(/市$/, '')));
  const styleMatches = STYLE_OPTIONS.filter(option => option !== '其他' && corpus.includes(option));
  const layoutMatches = LAYOUT_OPTIONS.filter(option => option !== '其他' && corpus.includes(option));
  if (cityMatches.length !== 1 || styleMatches.length > 1 || layoutMatches.length > 1) return null;
  if (!styleMatches.length && !layoutMatches.length) return null;
  return { cityCode: cityMatches[0].value, style: styleMatches[0] || '', layout: layoutMatches[0] || '' };
}

function servesCity(candidate: Candidate, cityCode: string) {
  return candidate.profile.cities.some(place => place.code === cityCode && (!place.districts.length || place.districts.includes(candidate.work.district)));
}

function card(candidate: Candidate, reason: string, match: string): DesignerCard {
  return {
    authorId: candidate.work.authorId, authorName: candidate.work.authorName, professionalTitle: candidate.professional?.title ?? null,
    experienceLabel: candidate.professional?.experienceLabel ?? '', layoutSpecialties: candidate.profile.layoutSpecialties,
    portraitAvailable: candidate.portraitAvailable,
    work: {
      id: candidate.work.id, versionId: candidate.work.versionId, title: candidate.work.title, coverAssetId: candidate.work.coverAssetId,
      primaryStyle: candidate.work.primaryStyle, secondaryStyles: candidate.work.secondaryStyles, layoutTypes: candidate.work.layoutTypes,
      cityName: candidate.work.cityName, district: candidate.work.district, communityName: candidate.work.community?.name || '',
      tourCount: candidate.content.tours.length,
    },
    reason, match,
  };
}

export async function recommendDesigners(tx: PostgresTransaction, actor: ActorContext, conversation: Row, input: Row = {}): Promise<{ items: DesignerCard[]; notice: string; needContext?: boolean; cityCode?: string; style?: string; layout?: string }> {
  const facts = readMemory(conversation.entry_snapshot).facts.filter(fact => fact.status === 'current');
  const query = resolveDesignerQuery({
    memoryHousing: facts.filter(fact => fact.field === 'housing').map(fact => fact.value).join(' '),
    memoryStyle: facts.filter(fact => fact.field === 'style').map(fact => fact.value).join(' '),
    triggerText: typeof input.triggerText === 'string' ? input.triggerText : '',
    input,
  });
  if (!query) return { items: [], notice: designerNotice, needContext: true };
  const candidates = (await portfolioCandidates(tx, actor.enterpriseId, { city: query.cityCode, style: query.style || undefined, layout: query.layout || undefined, recommend: true }))
    .filter(candidate => servesCity(candidate, query.cityCode));
  const items = matchDesigners(candidates, query).map(({ candidate, reason, match }) => card(candidate, reason, match));
  return { items, notice: designerNotice, cityCode: query.cityCode, style: query.style, layout: query.layout };
}

export type DesignerSnapshot = {
  cityCode?: string; style?: string; layout?: string; communityId?: string | null;
  items?: Array<{ workId?: string; versionId?: string }>;
};

/** Rechecks every published work and author against current permissions. A
 * removed, replaced, withdrawn or expired item is dropped without turning the
 * whole assistant message into an unavailable source. */
export async function revalidateDesignerSnapshot(tx: PostgresTransaction, actor: ActorContext, snapshot: DesignerSnapshot): Promise<DesignerCard[]> {
  if (!Array.isArray(snapshot.items)) return [];
  const seen = new Set<string>(), items: DesignerCard[] = [];
  for (const saved of snapshot.items.slice(0, 3)) {
    try {
      const workId = id(saved.workId), versionId = id(saved.versionId);
      const candidate = (await portfolioCandidates(tx, actor.enterpriseId, { workId, recommend: true }))
        .find(item => item.work.versionId === versionId);
      if (!candidate || (snapshot.cityCode && !servesCity(candidate, snapshot.cityCode)) || seen.has(candidate.work.authorId)) continue;
      const matched = matchDesigners([candidate], { community: snapshot.communityId ?? null, style: snapshot.style, layout: snapshot.layout })[0];
      if (!matched) continue;
      seen.add(candidate.work.authorId);
      items.push(card(candidate, matched.reason, matched.match));
    } catch { continue; }
  }
  return items;
}

/** Projects a persisted agent recommendation against live publication. Removed,
 * replaced, withdrawn or expired works are silently dropped; the message itself
 * stays available. Only top-level DTO fields are added for old clients. */
export async function designerMessageProjection(tx: PostgresTransaction, actor: ActorContext, conversationId: string, messageId: string): Promise<DesignerRecommendation | null> {
  const run = await one(tx, sql`select id from app.assistant_runs where enterprise_id=${actor.enterpriseId}
    and conversation_id=${conversationId} and output_message_id=${messageId}`);
  if (!run) return null;
  const step = await one(tx, sql`select private_checkpoint from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
    and run_id=${String(run.id)} and kind='agent_designer_result' and step_seq=2000`);
  const snapshot = step?.private_checkpoint as DesignerSnapshot | undefined;
  if (!snapshot) return null;
  const items = await revalidateDesignerSnapshot(tx, actor, snapshot);
  return items.length ? { items, notice: designerNotice } : null;
}
