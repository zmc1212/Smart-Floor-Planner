import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext } from '../contracts';

export async function platformKnowledgeEnterpriseId(tx: PostgresTransaction) {
  const row = await one<{ enterprise_id: string }>(tx, sql`select enterprise_id::text
    from app.assistant_platform_knowledge_library where singleton`);
  return row?.enterprise_id;
}

export async function platformKnowledgeSupplement(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  if (!['customer_consultation', 'project_collaboration', 'construction_followup'].includes(String(conversation.purpose))
    || String(conversation.enterprise_id) !== actor.enterpriseId) return;
  const corpus = await platformKnowledgeEnterpriseId(tx);
  if (corpus && corpus !== actor.enterpriseId) return corpus;
}

/** Public reads stay on the same connection, including final citation writes.
 * The caller awaits each scoped read before issuing other queries on this transaction. */
export async function readPlatformKnowledge<T>(tx: PostgresTransaction, corpus: string, read: () => Promise<T>) {
  if (corpus !== await platformKnowledgeEnterpriseId(tx)) fail('context_changed');
  const previous = await one<{ tenant: string | null }>(tx, sql`select current_setting('app.current_enterprise_id',true) as tenant`);
  await tx.execute(sql`select set_config('app.current_enterprise_id',${corpus},true)`);
  try {
    return await read();
  } finally {
    await tx.execute(sql`select set_config('app.current_enterprise_id',${previous?.tenant ?? ''},true)`);
  }
}

export const platformKnowledgeScope = sql`d.scope='enterprise' and d.audience='customer_public' and d.status='active'
  and d.source_type<>'reference_case' and v.published_at is not null and d.published_version_id=v.id
  and (v.professional->'origin'->>'authority') is distinct from 'enterprise_rule'`;
