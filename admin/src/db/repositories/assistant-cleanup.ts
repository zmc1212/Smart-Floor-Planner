import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows } from './assistant-repository';

export const assistantCleanupTables = [
  'assistant_run_steps', 'assistant_usage_records', 'assistant_jobs', 'assistant_quota_reservations',
  'assistant_context_bindings', 'assistant_participants', 'assistant_idempotency_records',
  'domain_event_deliveries', 'assistant_messages', 'assistant_runs', 'domain_event_outbox',
  'assistant_conversations', 'assistant_enterprise_settings',
  'assistant_knowledge_attempts','assistant_knowledge_chunks','assistant_knowledge_assets','assistant_knowledge_versions','assistant_knowledge_documents','assistant_knowledge_index_profiles',
  'assistant_message_citations', 'assistant_cost_reviews', 'assistant_requirement_summaries', 'assistant_media', 'assistant_speech_assets',
  'assistant_knowledge_batch_items','assistant_knowledge_batches','assistant_knowledge_evaluations','assistant_knowledge_cases',
  'assistant_model_task_items','assistant_model_tasks','assistant_managed_knowledge_imports','assistant_managed_knowledge_libraries',
] as const;
export async function assistantCounts(tx: PostgresTransaction, enterpriseId: bigint) {
  const result = [];
  const batches=(await rows(tx,sql`select to_regclass('app.assistant_knowledge_batches') is not null as ready`))[0].ready;
  const modelTasks=(await rows(tx,sql`select to_regclass('app.assistant_model_tasks') is not null as ready`))[0].ready;
  const managed=(await rows(tx,sql`select to_regclass('app.assistant_managed_knowledge_imports') is not null as ready`))[0].ready;
  for (const table of assistantCleanupTables) {
    if (!managed && table.startsWith('assistant_managed_knowledge_')) continue;
    if(!batches&&['assistant_knowledge_batch_items','assistant_knowledge_batches'].includes(table))continue;
    if(!modelTasks&&['assistant_model_task_items','assistant_model_tasks'].includes(table))continue;
    result.push({
    table, label: table, count: Number((await rows(tx, sql`select count(*) as n from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`))[0].n),
  });
  }
  return result;
}
export async function deleteAssistantData(tx: PostgresTransaction, enterpriseId: bigint) {
  const counts = await assistantCounts(tx, enterpriseId);
  if (counts.some(c=>c.table==='assistant_managed_knowledge_libraries' && c.count>0)) {
    const managed = await rows(tx,sql`select i.job_id from app.assistant_managed_knowledge_imports i
      join app.assistant_managed_knowledge_libraries l on l.enterprise_id=i.enterprise_id
      where i.enterprise_id=${enterpriseId} and i.removed_at is null
      and (i.file_id is not null or l.provision_job_id=i.job_id or exists (
        select 1 from app.assistant_knowledge_attempts a where a.enterprise_id=i.enterprise_id and a.job_id=i.job_id
          and a.operation='managed_upload' and a.status in ('started','unknown')
      )) limit 1`);
    if (managed.length) throw new Error('assistant_managed_knowledge_cleanup_pending');
    await tx.execute(sql`delete from app.assistant_managed_knowledge_imports where enterprise_id=${enterpriseId}`);
    await tx.execute(sql`delete from app.assistant_managed_knowledge_libraries where enterprise_id=${enterpriseId}`);
  }
  if(counts.some(c=>c.table==='assistant_model_tasks')) {
    // Capture only this enterprise's task-owned attempts before removing links.
    await tx.execute(sql`with deleted_items as (
      delete from app.assistant_model_task_items where enterprise_id=${enterpriseId} returning attempt_id
    ) delete from app.ai_provider_attempts where enterprise_id=${enterpriseId} and id in (select attempt_id from deleted_items)`);
    await tx.execute(sql`delete from app.assistant_model_tasks where enterprise_id=${enterpriseId}`);
  }
  if(counts.some(c=>c.table==='assistant_knowledge_batches')) {
    await tx.execute(sql`delete from app.assistant_knowledge_batch_items where enterprise_id=${enterpriseId}`);
    await tx.execute(sql`delete from app.assistant_knowledge_batches where enterprise_id=${enterpriseId}`);
  }
  await tx.execute(sql`delete from app.assistant_knowledge_evaluations where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_knowledge_cases where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_media where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_speech_assets where enterprise_id=${enterpriseId}`);
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
  await tx.execute(sql`with deleted_versions as (delete from app.assistant_knowledge_versions where enterprise_id=${enterpriseId}),
    deleted_assets as (delete from app.assistant_knowledge_assets where enterprise_id=${enterpriseId})
    delete from app.assistant_knowledge_documents where enterprise_id=${enterpriseId}`);
  await tx.execute(sql`delete from app.assistant_knowledge_index_profiles where enterprise_id=${enterpriseId}`);
  return counts;
}
