import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, key, principalKey, type ActorContext } from '../contracts';

/** Call within the existing authorized enterprise/settings transaction. Never interpret expiry as permission to repeat effects. */
export function operationReceipt(tx: PostgresTransaction, actor: ActorContext, operation: string, requestKey: string) {
  key(requestKey);
  return one(tx, sql`select * from app.assistant_idempotency_records where enterprise_id=${actor.enterpriseId}
    and principal_key=${principalKey(actor)} and operation=${operation} and key=${requestKey}`);
}

export async function idempotent(tx: PostgresTransaction, actor: ActorContext, operation: string, requestKey: string, body: unknown, action: () => Promise<Row>): Promise<Row> {
  const hash = fingerprint(body), old = await operationReceipt(tx, actor, operation, requestKey);
  if (old) { if (old.request_hash !== hash) fail('idempotency_conflict'); return old.result as Row; }
  const result = await action();
  await tx.execute(sql`insert into app.assistant_idempotency_records(enterprise_id,principal_key,operation,key,request_hash,result,expires_at)
    values(${actor.enterpriseId},${principalKey(actor)},${operation},${requestKey},${hash},${JSON.stringify(result)}::jsonb,now()+interval '90 days')`);
  return result;
}
