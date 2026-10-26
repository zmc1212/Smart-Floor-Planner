import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { allRequirementKeys } from '../requirements/contract';
import { requirementItems, requirementSources } from '../requirements/items';
import { RequirementWorkflow } from '../requirements/workflow';
import { HandoffWorkflow } from '../handoff/workflow';
import { customerSources } from '../requirements/service';
import { requirementPlan } from '../requirements/plan';

/** LangChain validates typed tool inputs. Consent is never a model parameter. */
export async function businessReviewTools(actor: ActorContext, conversationId: string) {
  const requirements=new RequirementWorkflow(actor), handoff=new HandoffWorkflow(actor);
  const evidence=await requirements.requirements.customerEvidence(conversationId), current=await requirements.read(conversationId);
  const epoch=await withTenantTransaction(actor.enterpriseId,async tx=>{
    const repo=new AssistantRepository(tx,actor),settings=await repo.settings();await repo.conversation(conversationId);
    return Number(settings!.knowledge_epoch);
  });
  const sources=requirementSources(evidence.messages), items=requirementItems(evidence.messages,current.latest?.draftFields);
  const sourceIds=sources.length ? z.enum(sources.map(s=>s.id) as [string,...string[]]) : z.never();
  const targetIds=items.length ? z.enum(items.map(i=>i.id) as [string,...string[]]) : z.never();
  const change=z.discriminatedUnion('operation',[
    z.object({operation:z.literal('add'),field:z.enum(allRequirementKeys),sourceId:sourceIds}).strict(),
    z.object({operation:z.literal('replace'),targetId:targetIds,sourceId:sourceIds}).strict(),
    z.object({operation:z.literal('remove'),targetId:targetIds,sourceId:sourceIds}).strict(),
  ]);
  return {
    context:{planVersion:'retention-partition-1',customerClauses:sources,savedItems:items,savedSummaryId:current.latest?.id || null},
    proposeRequirements:tool(async(plan)=>requirements.propose(conversationId,randomUUID(),{
      sourceSeq:evidence.sourceSeq,baseSummaryId:current.latest?.id || null,
      changes:requirementPlan(items,sources,evidence.messages.at(-1)?.id || '',plan),
    },async(repo)=>{
      const actual=await customerSources(repo,actor.enterpriseId,conversationId),settings=await repo.settings();
      if(fingerprint(actual.inputs)!==fingerprint(evidence.messages) || Number(settings!.knowledge_epoch)!==epoch)fail('context_changed');
      const latest=await one(repo.tx,sql`select id,version from app.assistant_requirement_summaries where enterprise_id=${actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
      if((latest?String(latest.id):null)!==(current.latest?.id || null)
        || (latest?Number(latest.version):null)!==(current.latest?.version ?? null))fail('requirement_target_changed');
    }),{name:'propose_requirement_changes',description:'Propose a complete keep/write partition of the saved items. Customer approval is separate.',schema:z.object({
      retainedIds:z.array(targetIds).max(40).describe('Existing item IDs kept unchanged, including every unrequested item. Each existing ID must be retained or changed once, never both.'),
      changes:z.array(change).max(20),
    }).strict()}),
    requestDesigner:tool(async()=>handoff.propose(conversationId,'request'),{
      name:'propose_designer_reception',description:'Propose designer reception. Customer approval is required.',schema:z.object({}).strict(),
    }),
    cancelDesigner:tool(async()=>handoff.propose(conversationId,'cancel'),{
      name:'propose_reception_cancellation',description:'Propose cancelling reception. Customer approval is required.',schema:z.object({}).strict(),
    }),
  };
}
