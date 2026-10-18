import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, id } from '../contracts';
export async function authorizeKnowledgeManager(tx:PostgresTransaction,enterpriseId:string,adminId:string) {
  id(enterpriseId);id(adminId);
  if (!await one(tx,sql`select id from app.enterprises where id=${enterpriseId} and status='active' for share`)) fail('assistant_resource_not_found',404);
  // Global administrators have no home enterprise. The narrow identity guard
  // locks their current database role and restores tenant RLS before returning.
  const manager=await one(tx,sql`select app.assistant_knowledge_admin_is_current(${adminId}::bigint,${enterpriseId}::bigint) as allowed`);
  if (!manager?.allowed) fail('assistant_capability_forbidden',403);
}
