import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, id, principalKey, type ActorContext } from '../contracts';

/** Called inside the original send transaction, after ordinary message validation and before dispatch. */
export async function bindSpeechToMessage(tx: PostgresTransaction, actor: ActorContext, cid: string, messageId: string, text: string, input: unknown) {
  if (input === undefined) return;
  const value = input as { id: string; version: number };
  if (!value || Array.isArray(value) || Object.keys(value).some(k => !['id', 'version'].includes(k)) || !Number.isSafeInteger(value.version)
    || value.version < 1 || !text.trim() || text.length > 4000) fail('speech_review_required', 422);
  id(value.id);
  const asset = await one(tx, sql`select a.id,a.version,a.message_id,r.status from app.assistant_speech_assets a join app.assistant_runs r on r.enterprise_id=a.enterprise_id and r.id=a.run_id
    where a.enterprise_id=${actor.enterpriseId} and a.conversation_id=${cid} and a.id=${value.id} and a.principal_key=${principalKey(actor)} and a.deleted_at is null for update of a`);
  if (!asset || asset.status !== 'succeeded' || asset.message_id || Number(asset.version) !== value.version) fail('speech_review_required', 422);
  await tx.execute(sql`update app.assistant_speech_assets set message_id=${messageId},corrected_text=${text},version=version+1,updated_at=now()
    where enterprise_id=${actor.enterpriseId} and id=${value.id}`);
}
