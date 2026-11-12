
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { privateMemoryScope } from '@/lib/assistant/memory/scope';
import { delegationsEnabled } from './delegation-config';
import { delegationExternalResult } from './delegation-state';
import { appendDelegationEvent } from './delegation-store';

/** Existing public research Evidence and successful answer are the source. */
export async function recordDelegationExternalResult(tx: PostgresTransaction, eid: string, runId: string) {
  if (!delegationsEnabled(eid)) return;
  const row = await one(tx, sql`select r.conversation_id::text,m.user_id::text from app.assistant_runs r join app.assistant_messages m
    on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.trigger_message_id
    where r.enterprise_id=${eid} and r.id=${runId} and r.status='succeeded' and m.user_id is not null
    and exists(select 1 from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id
      and s.capability_name in ('web.search.v1','web.read.v1') and s.status='succeeded'
      and jsonb_typeof(s.private_checkpoint->'pages')='array' and jsonb_array_length(s.private_checkpoint->'pages')>0)`);
  if (!row) return;
  const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${eid} and id=${String(row.conversation_id)}`);
  if (!c) return;
  const scope = await privateMemoryScope(tx, { enterpriseId: eid, principal: { kind: 'user', userId: String(row.user_id) },
    contextVersion: 0, capabilities: [] }, c);
  if (!scope?.projectId) return;
  await appendDelegationEvent(tx, eid, delegationExternalResult, runId, 1,
    { projectId: scope.projectId, conversationId: scope.conversationId, runId });
}
