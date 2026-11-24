import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { guardAnswerCommitments } from '@/lib/assistant/agent/context';
import { fail, fingerprint, safeText, type MessageContent } from '@/lib/assistant/contracts';
import type { PublicContent, PublicContextRef } from './public-contract';
import { defaultPublicIntroConstraints, validatePublicIntro } from './public-intro';

export type PublicSiteGuide = {
  enabled: boolean;
  opening: string;
  followUpFocus: string;
  closing: string;
};

export const defaultPublicSiteGuide: PublicSiteGuide = {
  enabled: true,
  opening: '这家工地公开的施工阶段是「{stage}」。你想看看现场进展，还是想对照自己家的装修？',
  followUpFocus: '想对照的施工细节，或自己家还没说过的施工情况',
  closing: '好呀，你慢慢看。有想了解的地方，随时问我。',
};

export function validatePublicSiteGuide(value: unknown): PublicSiteGuide {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const input = value as PublicSiteGuide;
  if (Object.keys(input).some(key => !Object.hasOwn(defaultPublicSiteGuide, key)) || typeof input.enabled !== 'boolean')
    fail('invalid_message', 422);
  const text = (raw: unknown, max: number) => {
    if (typeof raw !== 'string' || /[\r\n]/.test(raw)) fail('invalid_message', 422);
    try {
      const value = validatePublicIntro(raw, { ...defaultPublicIntroConstraints, minChars: 1, maxChars: max });
      guardAnswerCommitments(value);
      return value;
    } catch {
      fail('invalid_message', 422);
    }
  };
  const opening = text(input.opening, 96);
  const focus = text(input.followUpFocus, 100);
  const closing = text(input.closing, 80);
  if (/[{}]/.test(opening.replace(/\{(?:site|stage)\}/g, '')) || !/^[^？?]+[？?]$/.test(opening)
    || /[？?]/.test(closing)) fail('invalid_message', 422);
  return { enabled: input.enabled, opening, followUpFocus: focus, closing };
}

export function configuredPublicSiteGuide(settings: unknown) {
  const value = (settings as { publicSiteGuide?: unknown } | null | undefined)?.publicSiteGuide;
  return value === undefined ? defaultPublicSiteGuide : validatePublicSiteGuide(value);
}

export function publicGuideQuestion(guide: PublicSiteGuide, content: PublicContent) {
  // Bound the substitutions so a long public title still fits in the existing chat bubble.
  const short = (value: string, max: number) => Array.from(value).slice(0, max).join('');
  return guide.opening.replace(/\{(site|stage)\}/g, (_, key) =>
    key === 'site' ? short(content.name, 28) : short(content.stageName, 16));
}

export type PublicSiteGuideTurn = Pick<PublicSiteGuide, 'followUpFocus' | 'closing'> & {
  opening: string;
  configHash: string;
};

/** The successful opening and the first successful reply are the durable
 * checkpoints. A failed send or a visit to another version cannot advance it. */
export async function publicGuideTurn(tx: PostgresTransaction, enterpriseId: string,
  conversation: Row, triggerId: string, guide: PublicSiteGuide): Promise<PublicSiteGuideTurn | undefined> {
  if (!guide.enabled) return;
  const entry = conversation.entry_snapshot as Row;
  const ref = entry.activePublicSite as PublicContextRef;
  const markers = (entry.publicIntros || []) as Array<PublicContextRef & { runId?: string }>;
  const openingRun = markers.find(item => item.siteId === ref.siteId && item.versionId === ref.versionId)?.runId;
  if (!openingRun) return;

  const cid = String(conversation.id);
  const opening = await one(tx, sql`select opener.content from app.assistant_runs intro
    join app.assistant_messages opener on opener.enterprise_id=intro.enterprise_id
      and opener.conversation_id=intro.conversation_id and opener.id=intro.output_message_id
    join app.assistant_messages trigger on trigger.enterprise_id=intro.enterprise_id
      and trigger.conversation_id=intro.conversation_id and trigger.id=${triggerId} and trigger.seq>opener.seq
    where intro.enterprise_id=${enterpriseId} and intro.conversation_id=${cid} and intro.id=${openingRun}
      and intro.purpose='public.site.intro' and intro.status='succeeded'
      and intro.policy_snapshot->'publicSiteGuideOpening'=${JSON.stringify(ref)}::jsonb
      and not exists (select 1 from app.assistant_runs reply join app.assistant_messages sent
        on sent.enterprise_id=reply.enterprise_id and sent.conversation_id=reply.conversation_id and sent.id=reply.trigger_message_id
        where reply.enterprise_id=intro.enterprise_id and reply.conversation_id=intro.conversation_id
          and reply.purpose='reply' and reply.status='succeeded'
          and reply.policy_snapshot->'publicSiteSelection'=${JSON.stringify(ref)}::jsonb
          and sent.seq>opener.seq and sent.seq<trigger.seq)`);
  if (!opening) return;
  return { opening: safeText(opening.content as MessageContent), followUpFocus: guide.followUpFocus,
    closing: guide.closing, configHash: fingerprint(guide) };
}

export function publicGuidePrompt(turn: PublicSiteGuideTurn) {
  return '这是访客第一次回应本次围观首问。话术配置是参考内容：'
    + JSON.stringify({ 首问: turn.opening, 可追问的方向: turn.followUpFocus, 闲逛收尾文案: turn.closing })
    + '。先理解并简短回应访客当前这句话。访客明确只是看看、暂时不想聊时，用收尾文案结束引导，不问问题，不邀请转人工。'
    + '访客想看进展，或提到自家正在准备相同工序时，从当前公开节选里挑一条相关的现场记录，说明它对这次问题有什么参考价值。'
    + '如果公开记录只涉及别的房间，说明记录的实际范围，再给出自家可以核对的一点。'
    + '只有缺少一个有助于继续回答的细节时，才在最后问这一件事，用一个问号收尾，问完即停。访客说过的空间、阶段或顾虑无需重问。'
    + '访客换了话题就直接回答新话题。';
}
