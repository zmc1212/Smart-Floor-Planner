import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import type { ConfirmedRequirements } from './contract';
import type { GuidanceCheckpoint } from './guidance';

/** Replay confirmation at its original user-message boundary, never as customer speech. */
export async function requirementCheckpoint(tx: PostgresTransaction, enterpriseId: string, conversationId: string): Promise<GuidanceCheckpoint | undefined> {
  const row = await one(tx, sql`select s.confirmed_fields,
    (select count(*) from app.assistant_messages m where m.enterprise_id=s.enterprise_id
      and m.conversation_id=s.conversation_id and m.author_kind='user' and m.seq<=s.source_seq) as after
    from app.assistant_requirement_summaries s where s.enterprise_id=${enterpriseId}
      and s.conversation_id=${conversationId} and s.status='confirmed' order by s.id desc limit 1`);
  return row ? { after: Number(row.after), fields: row.confirmed_fields as ConfirmedRequirements } : undefined;
}
