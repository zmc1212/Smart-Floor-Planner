import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows } from './assistant-repository';

export const assistantCleanupTables = [
  'assistant_run_steps', 'assistant_usage_records', 'assistant_jobs', 'assistant_quota_reservations',
  'assistant_context_bindings', 'assistant_participants', 'assistant_idempotency_records',
  'domain_event_deliveries', 'assistant_messages', 'assistant_runs', 'domain_event_outbox',
  'assistant_conversations', 'assistant_enterprise_settings',
  'assistant_knowledge_attempts','assistant_knowledge_chunks','assistant_knowledge_versions','assistant_knowledge_documents','assistant_knowledge_index_profiles',
  'assistant_message_citations', 'assistant_cost_reviews', 'assistant_requirement_summaries', 'assistant_media',
] as const;
export async function assistantCounts(tx: PostgresTransaction, enterpriseId: bigint) {
  const result = [];
  for (const table of assistantCleanupTables) result.push({
    table, label: table, count: Number((await rows(tx, sql`select count(*) as n from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`))[0].n),
  });
  return result;
}
export async function deleteAssistantData(tx: PostgresTransaction, enterpriseId: bigint) {
  const counts = await assistantCounts(tx, enterpriseId);
  await tx.execute(sql`delete from app.assistant_media where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_requirement_summaries where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_cost_reviews where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_message_citations where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_knowledge_attempts where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.ai_provider_attempts where enterprise_id=${enterpriseId} and knowledge_job_id is not null`);
  for (const table of assistantCleanupTables.slice(0, 8)) {
    await tx.execute(sql`delete from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`);
  }
  await tx.execute(sql`delete from app.ai_provider_attempts where enterprise_id=${enterpriseId} and assistant_run_id is not null`);
  // Delete both ends of the message/run cycle in one statement (FK checks at statement end).
  await tx.execute(sql`with deleted_messages as (delete from app.assistant_messages where enterprise_id=${enterpriseId})
    delete from app.assistant_runs where enterprise_id=${enterpriseId}`);
  for (const table of ['domain_event_outbox', 'assistant_conversations', 'assistant_enterprise_settings']) {
    await tx.execute(sql`delete from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`);
  }
  await tx.execute(sql`delete from app.assistant_knowledge_chunks where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`with deleted_versions as (delete from app.assistant_knowledge_versions where enterprise_id=${enterpriseId})
    delete from app.assistant_knowledge_documents where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_knowledge_index_profiles where enterprise_id=${enterpriseId}`);
  return counts;
}
