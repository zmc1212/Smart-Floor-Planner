import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type ActorContext } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { projectMessage } from '../knowledge/sources';
import { chineseTerms } from '../knowledge/chinese-lexical';
import { readMemory } from './memory';
import { availableNeedMemory, unavailableNeedMessageIds } from './memory-sources';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import type { SynthesisSource } from './synthesis';

export const historyTool: ModelTool = { name: 'recall_history',
  description: '回读本咨询较早的客户原话。近期上下文没有明确对象、客户追问早先约束/未决问题时使用；query只用客户已明确的房间/对象/关键词。只返回原话，不是当前事实或新授权；当前需求以有效更正为准，企业/项目状态另查实时业务。',
  parameters: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 80 } }, required: ['query'], additionalProperties: false } };
export type HistoryRef = { messageId: string; hash: string; memoryVersion: number };
export type HistorySnapshot = { query: string; beforeSeq: string; sources: Array<HistoryRef & { text: string; seq: string }>;
  hasMore: boolean; oversized: boolean };

/** Historical customer speech has its own identity; it is never a knowledge or
 * live-project source. Only a server-built, revalidated snapshot supplies IDs. */
export function historySynthesisSources(snapshot: HistorySnapshot): SynthesisSource[] {
  return snapshot.sources.map(({ messageId, hash, memoryVersion, text, seq }) => ({ sourceId: 'H' + messageId, kind: 'history',
    title: '本咨询客户历史原话', text, history: { messageId, hash, memoryVersion, seq } }));
}

export function parseHistoryQuery(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'query')) fail('invalid_message', 422);
  const query = (input as Row).query;
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 80) fail('invalid_message', 422);
  return query.trim();
}

/** Small literal candidate set, never a cross-consultation or project search.
 * Only original text by this consultation's customer is eligible. Generated
 * answers, staff messages, images and quoted knowledge never enter this path. */
export async function recallHistory(tx: PostgresTransaction, actor: ActorContext, conversation: Row, beforeSeq: string, query: string): Promise<HistorySnapshot> {
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation') fail('assistant_capability_forbidden', 403);
  const terms = chineseTerms(query).filter(term => !term.startsWith('renovation:')).sort((a,b) => b.length-a.length).slice(0, 12);
  if (!terms.length) fail('invalid_message', 422);
  // strpos has literal semantics: customer %, _ and quotes cannot expand scope.
  const score = sql.join(terms.map(term => sql`case when strpos(lower(m.content::text),${term})>0 then ${term.length} else 0 end`), sql` + `);
  const available = await availableNeedMemory(tx, actor.enterpriseId, String(conversation.id), conversation.entry_snapshot);
  const currentIds = [...new Set(available.facts.map(f => f.sourceMessageId))];
  const recordedIds = [...new Set(readMemory(conversation.entry_snapshot).facts.map(f => f.sourceMessageId))];
  const scope = sql`m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(conversation.id)} and m.user_id=${actor.principal.userId}
      and m.author_kind='user' and m.seq<${beforeSeq} and (${score})>0
      and not exists(select 1 from app.assistant_media a where a.enterprise_id=m.enterprise_id and a.conversation_id=m.conversation_id
        and m.client_message_id='media:' || a.request_key)`;
  // Repeated question wording must not crowd out its effective correction's
  // original. Reserve at most two matching current sources, with the same
  // tenant/customer/cutoff checks and unchanged final four-original budget.
  const current = currentIds.length ? await rows(tx, sql`select m.id,m.seq,m.content,m.author_kind,m.answer_kind,m.created_at,m.purpose
    from app.assistant_messages m where ${scope} and m.id in
      (select value::bigint from jsonb_array_elements_text(${JSON.stringify(currentIds)}::jsonb))
    order by (${score}) desc,m.seq desc limit 2`) : [];
  // An initial-versus-current question needs independent original assertions,
  // not more copies of its own wording. Existing memory supplies source IDs
  // only; historical/superseded values never become current facts. Reuse the
  // exact scope and source revalidation below, then fill from lexical results.
  const recorded = recordedIds.length ? await rows(tx, sql`select m.id,m.seq,m.content,m.author_kind,m.answer_kind,m.created_at,m.purpose
    from app.assistant_messages m where ${scope} and m.id in
      (select value::bigint from jsonb_array_elements_text(${JSON.stringify(recordedIds)}::jsonb))
    order by m.seq asc limit 25`) : [];
  const candidates = await rows(tx, sql`select m.id,m.seq,m.content,m.author_kind,m.answer_kind,m.created_at,m.purpose from app.assistant_messages m
    where ${scope}
      order by (${score}) desc,m.seq desc limit 25`);
  const unavailable = await unavailableNeedMessageIds(tx, actor.enterpriseId, String(conversation.id), conversation.entry_snapshot, available);
  const sources: HistorySnapshot['sources'] = [];
  let bytes = 0, oversized = false, hasMore = candidates.length === 25 || recorded.length === 25;
  for (const row of new Map([...current,...recorded,...candidates].map(row => [String(row.id),row])).values()) {
    if (unavailable.has(String(row.id)) || !(await projectMessage(tx, actor, conversation, row)).available) continue;
    const text = safeText(row.content as Parameters<typeof safeText>[0]);
    if (!text.trim()) continue;
    const source = { messageId: String(row.id), hash: fingerprint(row.content), memoryVersion: readMemory(conversation.entry_snapshot).version, text, seq: String(row.seq) };
    const size = Buffer.byteLength(JSON.stringify(source));
    // Keep all conditions/negations or omit the whole original with a marker.
    if (size > 7000) { oversized = true; hasMore = true; continue; }
    if (sources.length >= 4 || bytes + size > 7000) { hasMore = true; continue; }
    sources.push(source); bytes += size;
  }
  sources.sort((a,b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : 1);
  return { query, beforeSeq, sources, hasMore, oversized };
}

/** Used before every model call, commit, replay and customer/staff projection.
 * A correction invalidates prior derived prose rather than reviving an old value. */
export async function historyRefsAvailable(tx: PostgresTransaction, enterpriseId: string, conversationId: string, refs: HistoryRef[]): Promise<boolean> {
  if (!refs.length) return true;
  const conversation = await one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${enterpriseId} and id=${conversationId}`);
  if (!conversation) return false;
  const version = readMemory(conversation.entry_snapshot).version;
  const available = await availableNeedMemory(tx, enterpriseId, conversationId, conversation.entry_snapshot);
  const blocked = await unavailableNeedMessageIds(tx, enterpriseId, conversationId, conversation.entry_snapshot, available);
  for (const ref of refs) {
    if (ref.memoryVersion !== version || blocked.has(ref.messageId)) return false;
    const row = await one(tx, sql`select m.content from app.assistant_messages m
      where m.enterprise_id=${enterpriseId} and m.conversation_id=${conversationId} and m.id=${ref.messageId} and m.author_kind='user'
      and not exists(select 1 from app.assistant_media a where a.enterprise_id=m.enterprise_id and a.conversation_id=m.conversation_id
        and m.client_message_id='media:' || a.request_key)`);
    if (!row || fingerprint(row.content) !== ref.hash) return false;
    const dependencies = await rows(tx, sql`select s.source_refs from app.assistant_runs r join app.assistant_run_steps s
      on s.enterprise_id=r.enterprise_id and s.run_id=r.id where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
      and r.trigger_message_id=${ref.messageId} and s.kind='agent_construction_context'`);
    for (const dependency of dependencies) for (const mid of (dependency.source_refs || []) as string[])
      if (!await constructionNoticeAvailable(tx, enterpriseId, conversationId, mid, true, true)) return false;
  }
  return true;
}
