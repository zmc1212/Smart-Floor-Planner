import { specialistDomain } from '@/lib/assistant/specialists/consultation';
import { electricalAgentId, waterproofAgentId } from '@/lib/assistant/specialists/registry';
import { isQuestion } from '@/lib/assistant/requirements/guidance';
import { stageAgentRegistry, type StageAgentIntent, type StageAgentRegistration } from './stage-agent-registry';

const reminderIntent = /提醒|通知|催一下|催办|别忘|到期|到期前|什么时候提醒/u;
// Status and dates must be asked for explicitly. Timing words in a request
// for preparation or general checks do not ask for a project's actual plan.
const progressIntent = /进度|进展|到(?:了)?哪(?:一步|个阶段|儿|了)|进行到哪|施工到哪|做到哪|(?:现在|目前).{0,6}(?:什么|哪个|哪一)阶段|(?:做完|完成)(?:了)?(?:吗|没有?)|红黄绿/u;
const scheduleIntent = /(?:提前|落后)(?:了)?(?:多少|几天|多久|吗)|(?:什么时候|哪(?:一)?天|还要多久).{0,8}(?:开工|完工|结束|开始)|(?:工期|排期|施工计划).{0,8}(?:多久|几天|哪天|什么时候|了吗|了没)|(?:有没有|查一下|看一下).{0,6}(?:排期|施工计划)/u;
const todoIntent = /待办|需要我(?:来)?(?:处理|确认|补交|做)|还没做|待处理|待确认|待补|资料缺/u;
const weeklyIntent = /周报|(?:本周|这周|一周).{0,8}(?:报告|总结)|跨项目/u;
// Short continuations without a subject can refer to either craft advice or
// actual outstanding work. Do not invent the latter from a knowledge pack.
const ambiguousNextStep = /^(?:那[么，,]?\s*)?(?:下一步|接下来|现在)(?:呢|怎么办|(?:应|应当|要|该)?(?:做什么|怎么做|干什么))?[？?。！!]*$/u;
const deepSpecialist = /规范|标准|验收|图纸|隐蔽|打压|闭水|渗水|渗漏|管径|线径|回路|整改|复核|CAD|OCR/u;
/** Ordinary stage knowledge wording only. Project status/progress/todo/photo
 * questions stay on their existing fact route and never borrow pack copy. */
const knowledgeQuestion = /阶段|注意|准备|材料|工艺|施工|工序|流程|步骤|顺序|检查|核对|验收|保护|事项|建议|下一步|要点|重点|常见|问题|影响|区别|为什么|怎么办|怎么做|如何|有哪些|需要注意|小心|先做|该做|能做/u;

/** Ordinary stage questions stay in the lightweight stage agent. Only an
 * explicit professional topic is handed to the existing specialist agents. */
export function isDeepSpecialistQuestion(question: string) {
  const domain = specialistDomain(question);
  if (!domain) return false;
  if (domain === 'waterproof') return true;
  return deepSpecialist.test(question);
}

export function classifyStageIntent(question: string): StageAgentIntent | 'clarification' {
  if (weeklyIntent.test(question)) return 'weekly_report';
  if (todoIntent.test(question)) return 'todo';
  if (progressIntent.test(question) || scheduleIntent.test(question)) return 'progress';
  if (reminderIntent.test(question)) return 'reminder';
  if (ambiguousNextStep.test(question.trim())) return 'clarification';
  return 'stage_knowledge';
}

/** Only an ordinary stage knowledge turn may use the deterministic pack. Deep
 * specialist topics and project status/progress/reminder/todo turns keep the
 * existing specialist/model/fact route. */
export function isStageKnowledgeQuestion(question: string) {
  return isQuestion(question) && knowledgeQuestion.test(question) && classifyStageIntent(question) === 'stage_knowledge'
    && !isDeepSpecialistQuestion(question);
}

export type StageRoute =
  | { kind: 'stage_agent'; agent: StageAgentRegistration; intent: StageAgentIntent | 'clarification' }
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
