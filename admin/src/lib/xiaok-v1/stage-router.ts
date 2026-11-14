import { specialistDomain } from '@/lib/assistant/specialists/consultation';
import { electricalAgentId, waterproofAgentId } from '@/lib/assistant/specialists/registry';
import { stageAgentRegistry, type StageAgentIntent, type StageAgentRegistration } from './stage-agent-registry';

const reminderIntent = /提醒|通知|催一下|催办|别忘|到期|到期前|什么时候提醒/u;
const progressIntent = /进度|进展|到哪|做到哪|现在.{0,8}(?:阶段|完成)|工期|计划|排期|红黄绿|落后|提前/u;
const todoIntent = /待办|要做|需要我|还没做|清单|待处理|待确认|待补|资料缺/u;
const weeklyIntent = /周报|本周|这周|一周.{0,8}(?:报告|总结)|跨项目/u;
const deepSpecialist = /规范|标准|验收|图纸|隐蔽|打压|闭水|渗水|渗漏|管径|线径|回路|整改|复核|CAD|OCR/u;

/** Ordinary stage questions stay in the lightweight stage agent. Only an
 * explicit professional topic is handed to the existing specialist agents. */
export function isDeepSpecialistQuestion(question: string) {
  const domain = specialistDomain(question);
  if (!domain) return false;
  if (domain === 'waterproof') return true;
  return deepSpecialist.test(question);
}

export function classifyStageIntent(question: string): StageAgentIntent {
  if (weeklyIntent.test(question)) return 'weekly_report';
  if (todoIntent.test(question)) return 'todo';
  if (progressIntent.test(question)) return 'progress';
  if (reminderIntent.test(question)) return 'reminder';
  return 'stage_knowledge';
}

export type StageRoute =
  | { kind: 'stage_agent'; agent: StageAgentRegistration; intent: StageAgentIntent }
  | { kind: 'specialist'; stageAgent: StageAgentRegistration; agentId: string; domain: 'waterproof' | 'electrical'; intent: 'specialist_handoff' }
  | { kind: 'no_stage'; reason: 'construction_stage_unavailable' };

export function routeStageQuestion(input: {
  constructionStageKey: string | null | undefined;
  message: string;
  requestedIntent?: StageAgentIntent;
}): StageRoute {
  const agent = stageAgentRegistry.forConstructionKey(input.constructionStageKey);
  if (!agent) return { kind: 'no_stage', reason: 'construction_stage_unavailable' };
  const requested = input.requestedIntent;
  if (agent.toolPermissions.includes('specialist_handoff') && isDeepSpecialistQuestion(input.message)) {
    const domain = specialistDomain(input.message);
    if (domain) return { kind: 'specialist', stageAgent: agent, intent: 'specialist_handoff',
      agentId: domain === 'electrical' ? electricalAgentId : waterproofAgentId, domain };
  }
  const intent = requested && requested !== 'specialist_handoff' && agent.supportedIntents.includes(requested)
    ? requested : classifyStageIntent(input.message);
  return { kind: 'stage_agent', agent, intent };
}
