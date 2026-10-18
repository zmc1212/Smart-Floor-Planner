import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { safeText } from '../contracts';
import { readMemory, needInterpretations, type NeedMemory } from './memory';
import { needSourceContextSupported } from './need-source-context';

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
    if (available && needSourceContextSupported(fact, safeText(origin.content as Parameters<typeof safeText>[0]))) facts.push(fact);
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
