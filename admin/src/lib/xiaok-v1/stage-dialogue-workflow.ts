import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { fail, type ActorContext } from '@/lib/assistant/contracts';
import type { Row } from '@/db/repositories/assistant-repository';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';
import type { EnterpriseStageAgent } from './stage-workflow-settings';
import type { ModelTool } from '@/lib/assistant/contracts/model';
import type { Lease } from '@/lib/assistant/infrastructure/job-queue';
import { answerStageQuestion } from './stage-answer';
import { resolveStageProject } from './stage-chat-service';
import { stageIdForConstructionKey, stageDefinition } from './stages';
import { readStageAgent } from './stage-workflow-settings';
import { invokeBoundStageWorkflow } from './stage-workflow-invocation';
import { authorizedWechatStage, isWechatConsultation } from '@/lib/assistant/wechat/subject';
import { mainRelease } from './main-publication';

type Context = { conversationId: string; leadId?: string | null; question: string; eligible: boolean; preview?: EnterpriseStageAgent };
type Scope = { projectId: string; stageKey: string; agentVersion: number };

async function activeScope(tx: PostgresTransaction, actor: ActorContext, context: Context) {
  if (isWechatConsultation(actor)) {
    const stage = await authorizedWechatStage(tx, actor);
    if (stage === 'main') return null;
    const agent = await readStageAgent(tx, actor.enterpriseId, stage);
    if (!agent?.enabled) fail('context_changed');
    return { agent, stageKey: stageDefinition(stage)!.constructionKeys[0],
      projectId: 'channel:' + actor.entry!.channelId, agentVersion: agent.version };
  }
  if (!context.eligible) return null;
  const enterprise = actor.enterpriseId;
  if (actor.principal.kind === 'admin' && context.preview) {
    await authorizeKnowledgeManager(tx,enterprise,actor.principal.adminId);
    const agent=context.preview, stageKey=stageDefinition(agent.stageId)?.constructionKeys[0];
    return stageKey ? {agent, stageKey, projectId:'preview:'+context.conversationId,agentVersion:agent.version} : null;
  }
  if (actor.principal.kind !== 'user') return null;
  const user = actor.principal.userId;
  const resolved = await resolveStageProject(tx, enterprise, context.conversationId, user);
  if (resolved.status !== 'resolved' || (context.leadId && String(resolved.project.lead_id) !== context.leadId)) return null;
  const projectId = String(resolved.project.id);
  const linked = await one<{ stage: string }>(tx, sql`select p.current_stage_key as stage from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where p.enterprise_id=${enterprise}
    and p.id=${projectId} and p.customer_access and p.status<>'archived' and l.archived_at is null and l.customer_user_id=${user}
    for share of p,l`);
  const stageId = stageIdForConstructionKey(linked?.stage);
  const live = stageId && await readStageAgent(tx, enterprise, stageId);
  const publication = live?.enabled && await mainRelease(tx,enterprise);
  const agent = publication && publication.enabled ? publication.stages.find(s => s.stageId === stageId) : live;
  return linked && agent?.enabled && (agent.workflows.length || agent.experience) ? { agent, projectId, stageKey: linked.stage, agentVersion: agent.version } : null;
}

export async function currentConversationStageScope(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  const entry = conversation.entry_snapshot as Row;
  if (entry.activePublicSite || !['customer_consultation','knowledge_preview'].includes(String(conversation.purpose))) return null;
  return activeScope(tx,actor,{conversationId:String(conversation.id),question:'',eligible:true,
    preview:conversation.purpose==='knowledge_preview' ? entry.stagePreview as EnterpriseStageAgent | undefined : undefined});
}

export async function currentConversationExperience(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  return (await currentConversationStageScope(tx,actor,conversation))?.agent.experience ?? null;
}

export function stageSuggestionAvailable(recorded: unknown, current: Scope | null) {
  if (!recorded) return true;
  if (typeof recorded !== 'object') return false;
  const scope = recorded as Partial<Scope>;
  return !!current && scope.projectId === current.projectId && scope.stageKey === current.stageKey && scope.agentVersion === current.agentVersion;
}

const sameScope = (a: Scope, b: Scope | null) =>
  b && a.projectId === b.projectId && a.stageKey === b.stageKey && a.agentVersion === b.agentVersion;

export async function prepareStageWorkflowTool(tx: PostgresTransaction, lease: Lease, context: Context) {
  // Bind before the first model dispatch. Resuming a previous graph may not add a new tool.
  const checkpoint = await one<{ scope: Scope }>(tx, sql`select private_checkpoint as scope from app.assistant_run_steps
    where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=3100 and kind='stage_workflow_scope'`);
  const active = await activeScope(tx, lease.actor, context);
  if (checkpoint && !sameScope(checkpoint.scope, active)) fail('context_changed');
  if (!active) return null;
  const { agent, projectId, stageKey, agentVersion } = active;
  if (!checkpoint) {
    if (await one(tx, sql`select 1 from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId}
      and kind='agent_model' limit 1`)) return null;
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
      values(${lease.enterpriseId},${lease.runId},3100,'stage_workflow_scope','succeeded',${JSON.stringify({ projectId, stageKey, agentVersion })}::jsonb)`);
  }
  const ids = agent.workflows.map(ref => ref.definitionId);
  const definition: ModelTool = { name: 'run_stage_workflow',
    description: `${agent.name}。${agent.description}\n按本人项目当前装修阶段调用通用知识或核对清单工作流。企业标准和实际进度另取获权来源。\n`
      + agent.workflows.map(ref => `${ref.definitionId}：${ref.name}。${ref.description}`).join('\n'),
    parameters: { type: 'object', properties: { workflowId: { type: 'string', enum: ids } }, required: ['workflowId'], additionalProperties: false } };
  const revalidate = async (transaction: PostgresTransaction) => {
    if (!sameScope(active, await activeScope(transaction, lease.actor, context))) fail('context_changed');
  };
  const parse = (args: string): string | null => {
    try {
      const body = JSON.parse(args);
      return body && Object.keys(body).length === 1 && ids.includes(body.workflowId) ? body.workflowId : null;
    } catch { return null; }
  };
  return { definition, agent, hasWorkflows:ids.length>0, revalidate, parse,
    async invoke(transaction: PostgresTransaction, args: string, step: number) {
      const workflowId = parse(args);
      if (!workflowId) fail('invalid_message', 422);
      await revalidate(transaction);
      const saved = await one<{ result: { workflowId: string; text: string } }>(transaction, sql`select private_checkpoint as result
        from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=${step}`);
      if (saved) {
        if (saved.result.workflowId !== workflowId) fail('context_changed');
        return saved.result.text;
      }
      const base = answerStageQuestion({ constructionStageKey: stageKey, question: context.question, audience: 'owner' });
      if (base.intent !== 'stage_knowledge') return JSON.stringify({ status: 'not_applicable' });
      const answer = await invokeBoundStageWorkflow(agent, workflowId, base, 'owner', lease.runId + ':' + step);
      const text = JSON.stringify({ status: 'available', stage: answer.stageName, basis: 'general_knowledge', text: answer.answer });
      await transaction.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,status,input_summary,private_checkpoint)
        values(${lease.enterpriseId},${lease.runId},${step},'agent_tool','run_stage_workflow','succeeded',
          ${JSON.stringify({ agentId: base.agentId, ...answer.workflow })}::jsonb,${JSON.stringify({ workflowId, text })}::jsonb)`);
      return text;
    },
  };
}
