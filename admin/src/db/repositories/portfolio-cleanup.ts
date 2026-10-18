import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows } from './assistant-repository';
export const portfolioCleanupTables = ['portfolio_audits', 'portfolio_assets', 'portfolio_versions', 'portfolio_works', 'portfolio_profiles', 'portfolio_community_requests', 'portfolio_communities', 'portfolio_provider_usage'] as const;
export async function portfolioCounts(tx: PostgresTransaction, enterpriseId: bigint) {
  const result = [];
  for (const table of portfolioCleanupTables) result.push({ table, label: table, count: Number((await rows(tx, sql`select count(*) n from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`))[0].n) });
  return result;
}
export async function deletePortfolioData(tx: PostgresTransaction, enterpriseId: bigint) {
  const counts = await portfolioCounts(tx, enterpriseId);
  await tx.execute(sql`delete from app.portfolio_works where enterprise_id=${enterpriseId}`);
  for (const table of portfolioCleanupTables.slice(4)) await tx.execute(sql`delete from ${sql.identifier('app')}.${sql.identifier(table)} where enterprise_id=${enterpriseId}`);
  return counts;
}
