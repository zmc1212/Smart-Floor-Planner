import type { PostgresTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { customerProjects } from '@/lib/construction/customer';
import { currentStage, readStageSettings } from '@/lib/construction/stages-store';
import type { ActorContext } from '../contracts';
import type { KnowledgeContext } from '../contracts/professional';

/** Conditions never take model-supplied facts. No home selection for an unbound chat. */
export async function knowledgeContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row): Promise<KnowledgeContext> {
  const entry=conversation.entry_snapshot as Row;
  if (actor.principal.kind!=='user' || entry.kind!=='lead') return {};
  const leadId=String(entry.id), projects=(await customerProjects(tx,actor.enterpriseId,actor.principal.userId,leadId)).filter(p=>p.status==='active');
  if (projects.length!==1) return {leadId};
  const p=projects[0],settings=await readStageSettings(tx,actor.enterpriseId),stage=currentStage(p,settings.stages);
  return {leadId,projectId:String(p.id),revision:Number(p.progress_revision),...(stage?{stage:stage.key}:{})};
}
