import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { AssistantRepository, Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint } from '../contracts';
import { customerSources } from '../requirements/service';

/** A sourced proposal in the existing snapshot; never consent or a handoff. */
export async function stageHandoffProposal(repo: AssistantRepository, c: Row, settings: Row, action: 'request' | 'cancel') {
  const entry=c.entry_snapshot as Row;
  if(entry.requirementReviewMode!==true || entry.requirementWorkflow!=='langgraph' || c.status!=='open' || entry.retentionRedacted)fail('context_changed');
  const source=await customerSources(repo,repo.actor.enterpriseId,String(c.id));
  const binding={action,sourceHash:source.hash,sourceSeq:String(source.messages.at(-1)?.seq || '0'),epoch:Number(settings.knowledge_epoch)};
  const digest=fingerprint(binding),old=entry.handoffProposal as Row|undefined;
  const proposal=old?.status==='pending' && old.digest===digest?old:{...binding,id:randomUUID(),digest,status:'pending'};
  if(proposal!==old)await repo.tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{handoffProposal}',${JSON.stringify(proposal)}::jsonb),version=version+1,updated_at=now() where enterprise_id=${repo.actor.enterpriseId} and id=${String(c.id)}`);
  return {id:String(proposal.id),digest:String(proposal.digest),action,status:'pending' as const};
}
