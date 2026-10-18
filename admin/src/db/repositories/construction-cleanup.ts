import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from './assistant-repository';

const tables = ['construction_public_sites', 'construction_public_audits', 'construction_public_media', 'construction_public_sources', 'construction_public_versions', 'construction_site_attachments', 'construction_site_record_versions', 'construction_site_records', 'construction_site_media', 'construction_watches', 'construction_chats', 'construction_stage_assignments', 'construction_links', 'construction_audits', 'construction_visits', 'construction_plans', 'construction_rooms', 'construction_members', 'construction_projects', 'construction_stage_settings'] as const;
export async function constructionCounts(tx: PostgresTransaction, enterpriseId: bigint) {
  const result = [];
  for (const table of tables) result.push({ table, label: '施工服务：' + table, count: Number((await one(tx, sql`select count(*) n from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`))!.n) });
  return result;
}
export async function deleteConstructionData(tx: PostgresTransaction, enterpriseId: bigint) {
  const counts = await constructionCounts(tx, enterpriseId);
  // The general assistant cleanup owns jobs/usage/messages/conversations. Drop domain FKs first.
  for (const table of tables) await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`);
  return counts;
}
