import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { constructionNoticeAvailable } from '@/lib/construction/customer';
import { safeText } from '../contracts';
import { readMemory, type NeedMemory } from './memory';

/** Read projection only. Keep the stored correction chain intact for audit. */
export async function availableNeedMemory(tx: PostgresTransaction, enterpriseId: string, conversationId: string, entry: unknown): Promise<NeedMemory> {
  const memory = readMemory(entry), facts: NeedMemory['facts'] = [];
  for (const fact of memory.facts.filter(f => f.status === 'current')) {
    const origin = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${enterpriseId} and conversation_id=${conversationId}
      and id=${fact.sourceMessageId} and author_kind='user' for share`);
    if (!origin || !safeText(origin.content as Parameters<typeof safeText>[0]).includes(fact.quote)) continue;
    const contexts = await rows(tx, sql`select s.source_refs from app.assistant_runs r join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
      where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and r.trigger_message_id=${fact.sourceMessageId} and s.kind='agent_construction_context'`);
    let available = true;
    for (const context of contexts) for (const mid of (context.source_refs || []) as string[]) if (!await constructionNoticeAvailable(tx, enterpriseId, conversationId, mid, true, true)) available = false;
    if (available) facts.push(fact);
  }
  return { version: memory.version, facts };
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
