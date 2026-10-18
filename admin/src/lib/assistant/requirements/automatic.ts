import { sql } from 'drizzle-orm';
import { AssistantRepository, one, rows } from '@/db/repositories/assistant-repository';
import { chatFirstProgress, defaultGuidance } from './guidance';
import { fingerprint } from '../contracts';
import { readMemory } from '../agent/memory';

/** Draft versions retain correction provenance; confirmed historical versions
 * are never overwritten or treated as approval of newer customer statements. */
export async function saveAutomaticRequirements(repo: AssistantRepository, conversationId: string) {
  if (repo.actor.principal.kind !== 'user') return;
  const messages = await rows(repo.tx, sql`select id,seq,content from app.assistant_messages
    where enterprise_id=${repo.actor.enterpriseId} and conversation_id=${conversationId}
      and author_kind='user' order by seq desc limit 200`);
  const inputs = messages.reverse().map(m => ({ id: String(m.id), text:
    ((m.content as { blocks?: { text?: string }[] })?.blocks || []).map(b => b.text || '').join('\n') }));
  const fields = chatFirstProgress(defaultGuidance, inputs).fields;
  const conversation = await one(repo.tx, sql`select entry_snapshot from app.assistant_conversations
    where enterprise_id=${repo.actor.enterpriseId} and id=${conversationId}`);
  const currentFacts = readMemory(conversation?.entry_snapshot).facts.filter(f => f.status === 'current');
  for (const fact of currentFacts.filter(f => !f.room && ['housing','household','style','budget','timeline'].includes(f.field))) {
    const key = fact.field as 'housing' | 'household' | 'style' | 'budget' | 'timeline';
    if (BigInt(fields[key]?.sourceMessageId || '0') > BigInt(fact.sourceMessageId)) continue;
    fields[key] = { text: fact.value, sourceMessageId: fact.sourceMessageId, truncated: false };
  }
  const roomFacts = currentFacts.filter(f => f.room);
  if (roomFacts.length && BigInt(fields.room?.sourceMessageId || '0') <= BigInt(roomFacts.at(-1)!.sourceMessageId)) {
    const text = roomFacts.map(f => `${f.room}：${f.value}`).join('；');
    fields.room = { text: text.slice(0, 1000), sourceMessageId: roomFacts.at(-1)!.sourceMessageId, truncated: text.length > 1000 };
  }
  const latest = await one(repo.tx, sql`select draft_fields from app.assistant_requirement_summaries
    where enterprise_id=${repo.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
  if (latest && fingerprint(latest.draft_fields) === fingerprint(fields)) return;
  if (!Object.values(fields).some(f => f.text)) return;
  await repo.tx.execute(sql`insert into app.assistant_requirement_summaries
    (enterprise_id,conversation_id,customer_user_id,source_seq,draft_fields,confirmed_fields)
    values(${repo.actor.enterpriseId},${conversationId},${repo.actor.principal.userId},${String(messages.at(-1)?.seq || 0)},
      ${JSON.stringify(fields)}::jsonb,'{}'::jsonb)`);
}
