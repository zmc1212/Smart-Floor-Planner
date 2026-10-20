import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { AssistantError } from '../contracts';
import { KnowledgeOperations } from './operations';

/** Called by the original authorized worker; only enqueues original preview jobs. */
export async function advanceKnowledgeBatches() {
  const candidates=await withPlatformTransaction(async tx=>{
    if(!(await one(tx,sql`select to_regclass('app.assistant_knowledge_batches') is not null as ready`))!.ready)return [];
    return rows(tx,sql`select b.id::text,b.enterprise_id::text,b.created_by::text
    from app.assistant_knowledge_batches b where b.state='active' and exists(
      select 1 from app.assistant_knowledge_batch_items i join app.assistant_knowledge_evaluations e
      on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id left join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id
      where i.enterprise_id=b.enterprise_id and i.batch_id=b.id
      and (i.state='pending' and e.run_id is null or r.status in ('queued','running'))) order by b.updated_at,b.id limit 1`);
  });
  for(const b of candidates)try{
    await new KnowledgeOperations({enterpriseId:String(b.enterprise_id),adminId:String(b.created_by)}).batches().advance(String(b.id));
  }catch(error){
    if(!(error instanceof AssistantError))throw error;
    // Revoked identities cannot dispatch again. Infrastructure records only a
    // terminal scheduling fence, never an alternate grant or model invocation.
    await withPlatformTransaction(tx=>tx.execute(sql`update app.assistant_knowledge_batches set state='blocked',last_error=${error.code},version=version+1,updated_at=now()
      where enterprise_id=${b.enterprise_id} and id=${b.id} and created_by=${b.created_by} and state='active'`));
  }
  return candidates.length;
}
