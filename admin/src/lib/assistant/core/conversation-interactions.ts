import { sql } from 'drizzle-orm';
import { one, rows, type AssistantRepository, type Row } from '@/db/repositories/assistant-repository';
import { fail, isPublicAssistantScope, type ActorContext, type MessageContent } from '../contracts';
import type { PostgresTransaction } from '@/db/transaction';
import { projectMessage } from '../knowledge/sources';
import { readAloudAvailable } from '../speech/read-aloud';

type Projection = Awaited<ReturnType<typeof projectMessage>>;
type Feedback = { rating: 'helpful' | 'issue'; reason: string | null; note: string };

const reasons = new Set(['incorrect', 'off_topic', 'unclear', 'other']);
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

export function feedbackInput(body: Row): Feedback | null {
  const { rating, reason, note } = body;
  if ((rating === 'clear' || rating === 'helpful') && reason === undefined && note === undefined) {
    return rating === 'clear' ? null : { rating, reason: null, note: '' };
  }
  if (rating !== 'issue' || typeof reason !== 'string' || !reasons.has(reason)
    || (note !== undefined && (typeof note !== 'string' || Array.from(note).length > 400 || note.includes('\0'))))
    fail('invalid_message', 422);
  return { rating, reason, note: typeof note === 'string' ? note.trim() : '' };
}

export function replyText(content: unknown) {
  const blocks = (content as MessageContent | null)?.blocks;
  return Array.isArray(blocks) ? blocks.flatMap(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() ? [block.text] : []).join('\n\n') : '';
}

const replyPurpose = (purpose: unknown) => purpose === 'reply' || purpose === 'reply.regenerate';

export function readableReply(conversation: Row, message: Row, projected: Projection) {
  return conversation.purpose === 'customer_consultation' && !(conversation.entry_snapshot as Row)?.retentionRedacted
    && message.author_kind === 'assistant' && replyPurpose(message.purpose) && projected.available && !!replyText(projected.content)
    && !projected.planDecision && !projected.publicConsent && !projected.constructionClosure && !projected.siteWatch;
}

export function replyControls(message: Row, projected: Projection, feedback: Feedback | null) {
  return { feedback, readAloud: readAloudAvailable(replyText(projected.content)),
    ...(message.purpose === 'reply.regenerate' && message.reply_to_message_id ? { versionOf: String(message.reply_to_message_id) } : {}) };
}

function authoredQuestion(actor: ActorContext, conversation: Row, message: Row) {
  return actor.principal.kind === 'user' && conversation.purpose === 'customer_consultation'
    && !(conversation.entry_snapshot as Row)?.retentionRedacted && message.purpose === 'reply'
    && message.author_kind === 'user' && String(message.user_id) === actor.principal.userId;
}

function plainQuestion(projected: Projection) {
  const blocks = (projected.content as MessageContent | null)?.blocks;
  return projected.available && !projected.mediaId && !projected.speechMessage && blocks?.length === 1
    ? replyText(projected.content) : '';
}

export function editableQuestion(repo: AssistantRepository, conversation: Row, message: Row, projected: Projection) {
  return conversation.status === 'open' && conversation.mode === 'ai'
    && authoredQuestion(repo.actor, conversation, message) && !!plainQuestion(projected);
}

/** Address an original only within the already authorized consultation. */
export async function ownedQuestion(tx: PostgresTransaction, actor: ActorContext, conversation: Row, messageId: string) {
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation') return null;
  const message = await one(tx, sql`select * from app.assistant_messages where enterprise_id=${actor.enterpriseId}
    and conversation_id=${String(conversation.id)} and id=${messageId} and user_id=${actor.principal.userId}`);
  if (!message || !authoredQuestion(actor, conversation, message)) return null;
  if ((message.content as Row)?.deleted === true) return { message, text: '', deleted: true };
  const text = plainQuestion(await projectMessage(tx, actor, conversation, message));
  return text ? { message, text, deleted: false } : null;
}

export async function questionQuote(tx: PostgresTransaction, actor: ActorContext, conversation: Row, trigger: Row) {
  if (trigger.author_kind !== 'user' || !trigger.reply_to_message_id) return null;
  const id = String(trigger.reply_to_message_id);
  const original = await ownedQuestion(tx, actor, conversation, id);
  if (!original?.text) fail('message_quote_unavailable', 409);
  const chars = Array.from(original.text);
  const text = chars.slice(0, 1000).join('') + (chars.length > 1000 ? '…' : '');
  return { id, text, source: original.message };
}

export async function ownedReply(repo: AssistantRepository, conversation: Row, messageId: string) {
  if (repo.actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation')
    fail('assistant_resource_not_found', 404);
  const message = await one(repo.tx, sql`select * from app.assistant_messages where enterprise_id=${repo.actor.enterpriseId}
    and conversation_id=${String(conversation.id)} and id=${messageId} and author_kind='assistant' and purpose in ('reply','reply.regenerate')`);
  if (!message) fail('assistant_resource_not_found', 404);
  const projected = await projectMessage(repo.tx, repo.actor, conversation, message);
  if (!readableReply(conversation, message, projected)) fail('assistant_resource_not_found', 404);
  return { message, projected, userId: repo.actor.principal.userId };
}

/** Pass only a proved plain model answer into the no-tools regeneration path. */
export async function regenerationSource(repo: AssistantRepository, conversation: Row, messageId?: string) {
  const actor = repo.actor;
  const entry = conversation.entry_snapshot as Row;
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation' || conversation.status !== 'open' || conversation.mode !== 'ai'
    || entry.activePublicSite || entry.retentionRedacted || entry.requirementReviewMode || entry.kind === 'reference_content') return null;
  const cid = String(conversation.id);
  const message = await one(repo.tx, sql`select m.*,r.trigger_message_id,r.purpose as run_purpose from app.assistant_messages m
    join app.assistant_runs r on r.enterprise_id=m.enterprise_id and r.conversation_id=m.conversation_id
      and r.id=m.run_id and r.output_message_id=m.id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${cid}
      and m.seq=(select max(seq) from app.assistant_messages where enterprise_id=m.enterprise_id and conversation_id=m.conversation_id)
      ${messageId ? sql`and m.id=${messageId}` : sql``}
      and m.author_kind='assistant' and m.purpose in ('reply','reply.regenerate') and m.answer_kind is null
      and r.status='succeeded' and r.trigger_kind='user_message' and r.purpose in ('reply','reply.regenerate')
      and (r.policy_snapshot->>'reportContextVersion') is null and (r.policy_snapshot->>'publicSiteGuideTurn') is null
      and (r.purpose='reply.regenerate' or (
        exists (select 1 from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id and s.kind='agent_model'
          and s.status='succeeded' and jsonb_typeof(s.private_checkpoint->'toolCalls')='array')
        and not exists (select 1 from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id and
          (s.kind in ('agent_tool','agent_need_receipt','agent_material_share','agent_delegation_reply','agent_need_issue_context') or exists (
            select 1 from jsonb_array_elements(case when jsonb_typeof(s.private_checkpoint->'toolCalls')='array'
              then s.private_checkpoint->'toolCalls' else '[]'::jsonb end) call
            where call->>'name' is distinct from 'final_response')))
      ))`);
  if (!message || !agentModelBound(await one(repo.tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))) return null;
  const current = await projectMessage(repo.tx, actor, conversation, message);
  if (!readableReply(conversation, message, current) || current.citations.length || current.siteRecords.length || current.constructionContacts?.length
    || current.publicSourceBound || current.designerRecommendation || current.designerDiscovery) return null;
  const questionId = String(message.trigger_message_id);
  const original = await one(repo.tx, sql`select * from app.assistant_messages
    where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and id=${questionId}
      and author_kind='user' and purpose='reply' and user_id=${actor.principal.userId}`);
  if (!original || original.reply_to_message_id) return null;
  const questionView = await projectMessage(repo.tx, actor, conversation, original);
  if (!editableQuestion(repo, conversation, original, questionView)) return null;
  const question = replyText(questionView.content), answer = replyText(current.content);
  if (Buffer.byteLength(question + answer, 'utf8') > 18000) return null;
  return { messageId: String(message.id), rootId: String(message.reply_to_message_id || message.id), runId: String(message.run_id), questionId, question, answer };
}

function agentModelBound(settings: Row | undefined) {
  const config = settings?.agent_config as Row | undefined;
  return !!config?.providerKey && !!config.model;
}

export async function loadReplyFeedback(repo: AssistantRepository, conversation: Row, messages: Row[]) {
  if (repo.actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation') return new Map<string, Feedback>();
  const ids = messages.filter(m => m.author_kind === 'assistant' && replyPurpose(m.purpose)).map(m => String(m.id));
  if (!ids.length) return new Map<string, Feedback>();
  const entries = await rows(repo.tx, sql`select message_id,rating,reason,note from app.assistant_answer_feedback
    where enterprise_id=${repo.actor.enterpriseId} and conversation_id=${String(conversation.id)}
      and user_id=${repo.actor.principal.userId}
      and message_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  return new Map(entries.map(entry => [
    String(entry.message_id), { rating: entry.rating as Feedback['rating'], reason: entry.reason as string | null, note: String(entry.note) },
  ]));
}

export async function saveReplyFeedback(repo: AssistantRepository, conversationId: string, messageId: string, userId: string, feedback: Feedback | null) {
  if (feedback) await repo.tx.execute(sql`insert into app.assistant_answer_feedback (enterprise_id,conversation_id,message_id,user_id,rating,reason,note)
    values (${repo.actor.enterpriseId},${conversationId},${messageId},${userId},${feedback.rating},${feedback.reason},${feedback.note})
    on conflict (enterprise_id,conversation_id,user_id,message_id)
    do update set rating=excluded.rating,reason=excluded.reason,note=excluded.note,updated_at=now()`);
  else await repo.tx.execute(sql`delete from app.assistant_answer_feedback where enterprise_id=${repo.actor.enterpriseId}
    and conversation_id=${conversationId} and message_id=${messageId} and user_id=${userId}`);
  return { conversationId, messageId, rating: feedback?.rating ?? null };
}

function includesText(column: ReturnType<typeof sql>, term: string) {
  return sql`strpos(lower(regexp_replace(${column}, '[[:space:]]+', ' ', 'g')), lower(${term})) > 0`;
}

function matchesMessage(userId: string, term: string) {
  return sql`m.purpose in ('reply','reply.regenerate') and (m.author_kind='assistant' or (m.author_kind='user' and m.user_id=${userId}))
    and exists (select 1 from jsonb_array_elements(
      case when jsonb_typeof(m.content->'blocks')='array' then m.content->'blocks' else '[]'::jsonb end
    ) block where block->>'type'='text' and ${includesText(sql`block->>'text'`, term)})`;
}

function textMatch(text: string, term: string) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return undefined;
  const before = Array.from(text.slice(0, at)), after = Array.from(text.slice(at + term.length));
  return {
    before: (before.length > 22 ? '…' : '') + before.slice(-22).join(''),
    match: text.slice(at, at + term.length),
    after: after.slice(0, 36).join('') + (after.length > 36 ? '…' : ''),
  };
}

export async function searchConsultations(repo: AssistantRepository, query: string, cursor = '9223372036854775807', limit = 16) {
  const actor = repo.actor;
  if (actor.principal.kind !== 'user' || actor.capabilities.includes('assistant.followup.self')) fail('assistant_capability_forbidden', 403);
  const userId = actor.principal.userId;
  const term = normalize(query);
  if (!term || Array.from(term).length > 64 || term.includes('\0')) fail('invalid_message', 422);
  const messageMatch = matchesMessage(userId, term);
  const pageSize = Math.min(limit, 20);
  const candidates = await rows(repo.tx, sql`select c.id from app.assistant_conversations c
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
    where c.enterprise_id=${actor.enterpriseId} and p.user_id=${userId} and p.status='active'
      and c.purpose='customer_consultation' and c.id<${cursor}
      and (c.entry_snapshot->>'retentionRedacted') is distinct from 'true'
      ${isPublicAssistantScope(actor) ? sql`and c.entry_snapshot->>'scope'='public'` : sql`and c.entry_snapshot->>'scope' is distinct from 'public'`}
      and (${includesText(sql`c.title`, term)} or exists (select 1 from app.assistant_messages m
        where m.enterprise_id=c.enterprise_id and m.conversation_id=c.id and ${messageMatch}))
    order by c.id desc limit ${pageSize}`);
  const items = [];
  for (const candidate of candidates) {
    const id = String(candidate.id);
    const c = await repo.conversation(id, 'share');
    if ((c.entry_snapshot as Row)?.retentionRedacted) continue;
    const first = await one(repo.tx, sql`select m.* from app.assistant_messages m where m.enterprise_id=${actor.enterpriseId}
      and m.conversation_id=${id} and m.author_kind='user' and m.user_id=${userId}
      and (m.content->>'deleted') is distinct from 'true' order by m.seq limit 1`);
    const firstView = first ? await projectMessage(repo.tx, actor, c, first) : null;
    const titleBody = firstView?.available ? normalize(replyText(firstView.content)) : '';
    const titleChars = Array.from(titleBody);
    const title = titleChars.length ? titleChars.slice(0, 80).join('') + (titleChars.length > 80 ? '…' : '') : String(c.title || '装修咨询');
    const result = { id, title, createdAt: c.created_at };
    const matching = await rows(repo.tx, sql`select m.* from app.assistant_messages m
      where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${id} and ${messageMatch} order by m.seq desc`);
    let hit;
    for (const message of matching) {
      const view = await projectMessage(repo.tx, actor, c, message);
      if (!view.available) continue;
      const snippet = textMatch(normalize(replyText(view.content)), term);
      if (snippet) { hit = { ...result, messageId: view.id, snippet }; break; }
    }
    if (hit) items.push(hit);
    else {
      const snippet = textMatch(title, term);
      if (snippet) items.push({ ...result, messageId: null, snippet });
    }
  }
  return { items, nextCursor: candidates.length === pageSize ? String(candidates.at(-1)!.id) : null };
}
