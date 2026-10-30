import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { sql } from 'drizzle-orm';
import { customerProjects } from '@/lib/construction/customer';
import { currentStage, readStageSettings } from '@/lib/construction/stages-store';
import { fingerprint, type ActorContext } from '../contracts';
import type { KnowledgeContext } from '../contracts/professional';

export const projectKnowledgeContextStep = 11000;
export async function projectKnowledgeContextAvailable(tx:PostgresTransaction,actor:ActorContext,conversation:Row,runId:string) {
  const saved=await one(tx,sql`select source_refs from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
    and run_id=${runId} and step_seq=${projectKnowledgeContextStep} and kind='agent_project_knowledge_context' and status='succeeded'`);
  return !!saved && fingerprint(saved.source_refs)===fingerprint(await knowledgeContext(tx,actor,conversation));
}

/** Conditions never take model-supplied facts. No home selection for an unbound chat. */
export async function knowledgeContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row): Promise<KnowledgeContext> {
  const entry=conversation.entry_snapshot as Row;
  if(actor.principal.kind==='admin' && conversation.purpose==='project_collaboration' && actor.capabilities.includes('assistant.project.shared')) {
    await new AssistantRepository(tx,actor).conversation(String(conversation.id));
    const project=await one(tx,sql`select p.* from app.construction_chats c join app.construction_projects p
      on p.enterprise_id=c.enterprise_id and p.id=c.project_id where c.enterprise_id=${actor.enterpriseId} and c.conversation_id=${String(conversation.id)} for share of p`);
    if(!project)return {};
    const settings=await readStageSettings(tx,actor.enterpriseId),stage=currentStage(project,settings.stages);
    return {leadId:String(project.lead_id),projectId:String(project.id),revision:Number(project.progress_revision),...(stage?{stage:stage.key}:{})};
  }
  if (actor.principal.kind!=='user' || entry.kind!=='lead') return {};
  const leadId=String(entry.id), projects=(await customerProjects(tx,actor.enterpriseId,actor.principal.userId,leadId)).filter(p=>p.status==='active');
  if (projects.length!==1) return {leadId};
  const p=projects[0],settings=await readStageSettings(tx,actor.enterpriseId),stage=currentStage(p,settings.stages);
  return {leadId,projectId:String(p.id),revision:Number(p.progress_revision),...(stage?{stage:stage.key}:{})};
}
