import { advance, createRunState } from '@/lib/native-workflow/advance';
import { compileDefinition } from '@/lib/native-workflow/compile';
import type { PublishedWorkflowVersion } from '@/lib/native-workflow/store/types';
import { fail } from '@/lib/assistant/contracts';
import type { PostgresTransaction } from '@/db/transaction';
import { stageKnowledgeRegistry } from './stage-knowledge';
import { publishedStageWorkflow, readStageAgent, type EnterpriseStageAgent, type StageWorkflowRef } from './stage-workflow-settings';
import type { StageAnswer, StageAudience } from './stage-answer';

export type StageWorkflowReceipt = StageWorkflowRef & { agentVersion: number; nodes: string[] };

export function executeStageWorkflow(version: Pick<PublishedWorkflowVersion, 'definition' | 'digest'>, base: StageAnswer, audience: StageAudience, eventId: string) {
  const pack = base.stageId && stageKnowledgeRegistry.get(base.stageId);
  if (!pack || base.intent !== 'stage_knowledge' || version.definition.inputSchema.eventType !== 'stage_consultation') {
    fail('stage_workflow_unavailable', 409);
  }
  const plan = compileDefinition(version.definition);
  if (plan.digest !== version.digest) fail('stage_workflow_unavailable', 409);
  const at = new Date().toISOString();
  let result = advance(plan, createRunState(plan, { runId: eventId, mode: 'live' }), {
    type: 'start', at, event: { eventType: 'stage_consultation', occurredAt: at, eventId },
  });
  while (result.state.status === 'waiting') {
    const op = result.pending[0];
    if (op?.capabilityRef !== 'read.stage_guide') fail('stage_workflow_unavailable', 409);
    const checks = audience === 'worker' ? pack.workerConcerns : pack.ownerConcerns;
    result = advance(plan, result.state, { type: 'observation', at, nodeId: op.nodeId, status: 'succeeded', outputs: {
      answer: base.answer, checklist: [base.stageName + '阶段可以逐项核对：', ...checks.map(item => '· ' + item)].join('\n'),
      nextStage: pack.nextStage, matched: base.matchedFaqId !== null,
    } });
  }
  const last = result.state.visitedNodeIds.at(-1);
  const text = last && result.state.outputs[last]?.text;
  if (!last || result.state.status !== 'completed' || result.state.outcome !== 'returned' || typeof text !== 'string') {
    fail('stage_workflow_unavailable', 409);
  }
  const keepsSources = plan.nodes[last].inputs.text.outputPath === 'answer';
  return { text, keepsSources, nodes: result.state.visitedNodeIds };
}

export async function invokeBoundStageWorkflow(agent: EnterpriseStageAgent, definitionId: string, base: StageAnswer,
  audience: StageAudience, eventId: string): Promise<StageAnswer> {
  const ref = agent.workflows.find(item => item.definitionId === definitionId);
  if (!agent.enabled || base.stageId !== agent.stageId || !ref) fail('assistant_capability_forbidden', 403);
  const run = executeStageWorkflow(await publishedStageWorkflow(ref), base, audience, eventId);
  return { ...base, answer: run.text, agentName: agent.name, workflow: { ...ref, agentVersion: agent.version, nodes: run.nodes },
    ...(run.keepsSources ? {} : { basis: 'stage_knowledge', citations: [], enterpriseKnowledgeStatus: 'not_configured' }) };
}

export async function applyStageWorkflow(tx: PostgresTransaction, enterpriseId: string, answer: StageAnswer,
  audience: StageAudience, eventId: string, requested?: string) {
  if (!answer.stageId || answer.intent !== 'stage_knowledge') {
    if (requested) fail('assistant_capability_forbidden', 403);
    return answer;
  }
  const agent = await readStageAgent(tx, enterpriseId, answer.stageId);
  if (!agent?.enabled || !agent.defaultWorkflowId) {
    if (requested) fail('assistant_capability_forbidden', 403);
    return answer;
  }
  return invokeBoundStageWorkflow(agent, requested ?? agent.defaultWorkflowId, answer, audience, eventId);
}
