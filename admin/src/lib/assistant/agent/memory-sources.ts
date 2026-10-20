import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { fingerprint, safeText } from '../contracts';
import { readMemory, needInterpretations, type NeedMemory } from './memory';

export const needContextStep = 1009;
export type NeedSourceRef = { messageId: string; hash: string };
/** Full original hashes, without treating a historical memory revision as a
 * write lock: this run may legitimately correct its own initial needs. */
export async function needSourceRefs(tx: PostgresTransaction, enterpriseId: string, conversationId: string, memory: NeedMemory): Promise<NeedSourceRef[]> {
  const ids = [...new Set(memory.facts.map(f => f.sourceMessageId))];
  if (!ids.length) return [];
  const originals = await rows(tx, sql`select id,content from app.assistant_messages where enterprise_id=${enterpriseId}
    and conversation_id=${conversationId} and author_kind='user' and id in (${sql.join(ids.map(id => sql`${id}`), sql`,` )}) for share`);
  return originals.map(row => ({ messageId: String(row.id), hash: fingerprint(row.content) }));
}
export async function needSourcesAvailable(tx: PostgresTransaction, enterpriseId: string, conversationId: string, refs: NeedSourceRef[]) {
  for (const ref of refs) {
    const original = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterpriseId}
      and conversation_id=${conversationId} and id=${ref.messageId} and author_kind='user' for share`);
    if (!original || fingerprint(original.content) !== ref.hash) return false;
  }
  return true;
}
export async function needRunSourcesAvailable(tx: PostgresTransaction, enterpriseId: string, conversationId: string, runId: string) {
  const packets = await rows(tx, sql`select s.source_refs from app.assistant_run_steps s join app.assistant_runs r
    on r.enterprise_id=s.enterprise_id and r.id=s.run_id where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId}
      and r.id=${runId} and s.kind in ('agent_need_context','agent_need_write') and s.status='succeeded'`);
  return needSourcesAvailable(tx, enterpriseId, conversationId, packets.flatMap(p => p.source_refs as NeedSourceRef[]));
}

/** Read projection only. Keep the stored correction chain intact for audit. */
export async function availableNeedMemory(tx: PostgresTransaction, enterpriseId: string, conversationId: string, entry: unknown): Promise<NeedMemory> {
  const memory = readMemory(entry), facts: NeedMemory['facts'] = [];
  const originals = new Map<string, Row | undefined>(), sourceContexts = new Map<string, Row[]>(), notices = new Map<string, boolean>();
  for (const fact of memory.facts.filter(f => f.status === 'current')) {
    if (!originals.has(fact.sourceMessageId)) originals.set(fact.sourceMessageId, await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
      and id=${fact.sourceMessageId} and author_kind='user' for share`));
    const origin = originals.get(fact.sourceMessageId);
    if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) continue;
    if (!sourceContexts.has(fact.sourceMessageId)) sourceContexts.set(fact.sourceMessageId, await rows(tx, sql`select s.source_refs from app.assistant_runs r join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
      where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and r.trigger_message_id=${fact.sourceMessageId} and s.kind='agent_construction_context'`));
    const contexts = sourceContexts.get(fact.sourceMessageId)!;
    let available = true;
    for (const context of contexts) for (const mid of (context.source_refs || []) as string[]) {
      if (!notices.has(mid)) notices.set(mid, await constructionNoticeAvailable(tx, enterpriseId, conversationId, mid, true, true));
      if (!notices.get(mid)) available = false;
    }
    if (available) facts.push(fact);
  }
  const interpretations = needInterpretations(memory, facts);
  return { version: memory.version, facts, ...(interpretations.length ? { interpretations } : {}) };
}

export async function needMemoryNoticeRefs(tx: PostgresTransaction, enterpriseId: string, conversationId: string, memory: NeedMemory) {
  const refs = new Set<string>();
  for (const sourceId of new Set(memory.facts.map(f => f.sourceMessageId))) {
    const contexts = await rows(tx, sql`select s.source_refs from app.assistant_runs r join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
      where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and r.trigger_message_id=${sourceId} and s.kind='agent_construction_context'`);
    for (const context of contexts) for (const mid of (context.source_refs || []) as string[]) refs.add(mid);
  }
  return [...refs];
}

/** An unavailable current correction blocks every older assertion for its
 * room/field, including compacted history. Return IDs only, never archive text. */
export async function unavailableNeedMessageIds(tx: PostgresTransaction, enterpriseId: string, conversationId: string,
  entry: unknown, available: NeedMemory): Promise<Set<string>> {
  const stored = readMemory(entry), visible = new Set(available.facts.map(f => f.id));
  const fields = stored.facts.filter(f => f.status === 'current' && !visible.has(f.id)).map(({ room, field }) => ({ room, field }));
  if (!fields.length) return new Set();
  const blocked = new Set(stored.facts.filter(f => fields.some(key => key.room === f.room && key.field === f.field)).map(f => f.sourceMessageId));
  const archived = await rows(tx, sql`select distinct fact->>'sourceMessageId' as message_id
    from app.assistant_run_steps s join app.assistant_runs r on r.enterprise_id=s.enterprise_id and r.id=s.run_id
    cross join lateral jsonb_array_elements(s.private_checkpoint->'archivedFacts') fact
    where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and s.kind='agent_need_write'
      and exists(select 1 from jsonb_to_recordset(${JSON.stringify(fields)}::jsonb) as missing(room text,field text)
        where missing.room=fact->>'room' and missing.field=fact->>'field')`);
  for (const row of archived) if (row.message_id) blocked.add(String(row.message_id));
  return blocked;
}
