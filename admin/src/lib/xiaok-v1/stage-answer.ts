import { stageKnowledgeRegistry, type StageKnowledgeFaq, type StageKnowledgePack } from './stage-knowledge';
import { routeStageQuestion, type StageRoute } from './stage-router';
import { stageForConstructionKey } from './stages';

export const stageAnswerProtocol = 'xiaok-stage-answer-v1';
export type StageAudience = 'owner' | 'worker' | 'designer' | 'boss';
export type EnterpriseKnowledgeItem = { sourceId: string; title: string; quote: string };

export type StageAnswer = {
  protocol: typeof stageAnswerProtocol;
  agentId: string | null;
  stageId: string | null;
  stageName: string | null;
  intent: string;
  answer: string;
  matchedFaqId: string | null;
  basis: 'stage_knowledge' | 'enterprise_knowledge' | 'no_stage' | 'clarification';
  enterpriseKnowledgeStatus: 'not_configured' | 'available' | 'unavailable';
  citations: Array<{ sourceId: string; title: string; quote: string }>;
  boundaries: string[];
  handoff: { agentId: string; domain: 'waterproof' | 'electrical' } | null;
};

const punctuation = /[\s,，。！？!?；;：:、（）()【】[\]"'“”‘’《》<>·…—\-_/\\]/gu;
const stopBigrams = new Set(['什么', '怎么', '哪些', '如何', '需要', '应该', '可以', '是否', '这个', '那个', '我们', '你们', '装修', '阶段']);

function normalize(text: string) {
  return text.replace(punctuation, '').toLowerCase();
}
function tokens(text: string) {
  const value = normalize(text), result = new Set<string>();
  for (const word of value.match(/[a-z0-9]{2,}/gu) || []) result.add(word);
  const han = value.replace(/[a-z0-9]/gu, '');
  for (let index = 0; index < han.length - 1; index++) {
    const bigram = han.slice(index, index + 2);
    if (!stopBigrams.has(bigram)) result.add(bigram);
  }
  return result;
}

function scoreFaq(question: string, faq: StageKnowledgeFaq) {
  const asked = tokens(question), target = tokens(faq.question + faq.answer);
  let score = 0;
  for (const token of asked) if (target.has(token)) score++;
  if (normalize(question).includes(normalize(faq.question).slice(0, 4))) score += 3;
  return score;
}

export function selectStageFaq(pack: StageKnowledgePack, question: string, audience: StageAudience = 'owner') {
  const candidates = pack.faqs.filter(faq => faq.audience === 'all' || faq.audience === audience);
  let best: { faq: StageKnowledgeFaq; score: number } | null = null;
  for (const faq of candidates.length ? candidates : pack.faqs) {
    const score = scoreFaq(question, faq);
    if (!best || score > best.score) best = { faq, score };
  }
  // Two shared bigrams are enough to answer; otherwise the pack intro is safer
  // than pretending a loosely related FAQ matched the question.
  return best && best.score >= 2 ? best.faq : null;
}

const numericParameter = /\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米|米|小时|分钟|天|兆帕|mpa|平方|㎡|升|公斤|kg|安|伏|瓦|a|v|w)\b/iu;
const completedClaim = /(?:已经|已)(?:完成施工|施工完成|验收合格|通过验收|工程合格)|(?:本工程|现场|工程)\s*(?:验收合格|通过验收)/u;
const unverifiedEnterpriseClaim = /(?:公司|企业)(?:规定|要求|标准)(?:必须|应当|要求)/u;

/** Server-side guard for authored answers. Real parameters must be added only
 * from a verified enterprise/public citation, never from pack copy or model prose. */
export function stageAnswerViolations(answer: string, enterpriseVerified = false) {
  const violations: string[] = [];
  if (numericParameter.test(answer)) violations.push('unverified_numeric_parameter');
  if (completedClaim.test(answer)) violations.push('unverified_completion_claim');
  if (!enterpriseVerified && unverifiedEnterpriseClaim.test(answer)) violations.push('unverified_enterprise_claim');
  return violations;
}

function composeAnswer(pack: StageKnowledgePack, faq: StageKnowledgeFaq | null, audience: StageAudience, enterprise: EnterpriseKnowledgeItem[]) {
  const lines: string[] = [pack.intro];
  if (faq) lines.push('', faq.question, faq.answer);
  else {
    const concerns = audience === 'worker' ? pack.workerConcerns : pack.ownerConcerns;
    lines.push('', '可以先从这些事项看起：', ...concerns.slice(0, 3).map(item => '· ' + item));
    lines.push('', '你可以继续补充房间、部位或具体工序，我再按当前阶段说明。');
  }
  if (enterprise.length) {
    lines.push('', '本企业已核实的相关资料：');
    for (const item of enterprise.slice(0, 3)) lines.push('· ' + item.title + '：' + item.quote);
  }
  lines.push('', '下一阶段：' + pack.nextStage);
  lines.push('', '边界：' + pack.boundaries.join(' '));
  return lines.join('\n');
}

function noStageAnswer(): StageAnswer {
  return { protocol: stageAnswerProtocol, agentId: null, stageId: null, stageName: null, intent: 'stage_knowledge',
    answer: '当前项目还没有可识别的装修阶段。阶段未知时不能猜测施工进度、提醒或标准，请先在项目中确认当前阶段。',
    matchedFaqId: null, basis: 'no_stage', enterpriseKnowledgeStatus: 'not_configured', citations: [], boundaries: [], handoff: null };
}

/** A knowledge turn without one unambiguous project is clarified, never guessed
 * into a stage or answered from another project's pack. */
export function unresolvedProjectAnswer(kind: 'none' | 'ambiguous', projectNames: string[] = []): StageAnswer {
  if (kind === 'ambiguous') {
    const names = projectNames.filter(Boolean).slice(0, 5);
    return { protocol: stageAnswerProtocol, agentId: null, stageId: null, stageName: null, intent: 'stage_knowledge',
      answer: '当前账号关联了多个在施项目，我还不能确定你要问哪一个。'
        + (names.length ? '可选项目：' + names.join('、') + '。' : '')
        + '请先告诉我想了解哪个项目，或从小程序进入对应项目的对话再问。不同的阶段不能混用，我不会替你猜。',
      matchedFaqId: null, basis: 'no_stage', enterpriseKnowledgeStatus: 'not_configured', citations: [], boundaries: [], handoff: null };
  }
  return { protocol: stageAnswerProtocol, agentId: null, stageId: null, stageName: null, intent: 'stage_knowledge',
    answer: '当前对话还没有关联到唯一可核实的在施项目，因此无法确认装修阶段。'
      + '阶段未知时不能猜测施工进度、注意事项或验收标准，请先从对应项目的入口发起对话，或告诉我是哪一个项目。',
    matchedFaqId: null, basis: 'no_stage', enterpriseKnowledgeStatus: 'not_configured', citations: [], boundaries: [], handoff: null };
}

export function answerStageQuestion(input: {
  constructionStageKey: string | null | undefined;
  question: string;
  audience?: StageAudience;
  enterpriseKnowledge?: EnterpriseKnowledgeItem[];
  enterpriseKnowledgeStatus?: 'not_configured' | 'available' | 'unavailable';
  route?: StageRoute;
}): StageAnswer {
  const route = input.route ?? routeStageQuestion({ constructionStageKey: input.constructionStageKey, message: input.question });
  const stage = stageForConstructionKey(input.constructionStageKey);
  if (!stage || route.kind === 'no_stage') return noStageAnswer();
  const agent = route.kind === 'specialist' ? route.stageAgent : route.agent;
  const pack = stageKnowledgeRegistry.get(stage.stageId);
  if (!pack) return noStageAnswer();
  if (route.kind === 'specialist') {
    return {
      protocol: stageAnswerProtocol, agentId: route.agentId, stageId: stage.stageId, stageName: stage.name,
      intent: 'specialist_handoff',
      answer: '这个问题需要更深入的专业判断，已转交' + (route.domain === 'waterproof' ? '防水' : '水电')
        + '专业 Agent 继续核对来源和当前项目资料。普通阶段知识没有替代专业结论。',
      matchedFaqId: null, basis: 'stage_knowledge', enterpriseKnowledgeStatus: 'not_configured',
      citations: [], boundaries: pack.boundaries, handoff: { agentId: route.agentId, domain: route.domain },
    };
  }
  if (route.intent !== 'stage_knowledge') {
    const answer = route.intent === 'clarification'
      ? '你是想了解这个阶段一般要准备什么，还是想查你家下一步的实际安排？'
      : '这个问题要看项目的实际记录。请到对应项目查看进度、待办、提醒或周报。';
    return { protocol: stageAnswerProtocol, agentId: agent.agentId, stageId: stage.stageId, stageName: stage.name,
      intent: route.intent, answer, matchedFaqId: null, basis: 'clarification', enterpriseKnowledgeStatus: 'not_configured',
      citations: [], boundaries: [], handoff: null };
  }
  const audience = input.audience ?? 'owner';
  const enterprise = (input.enterpriseKnowledge ?? []).filter(item => item.title.trim() && item.quote.trim());
  const enterpriseStatus = input.enterpriseKnowledgeStatus ?? (enterprise.length ? 'available' : 'not_configured');
  const faq = selectStageFaq(pack, input.question, audience);
  let answer = composeAnswer(pack, faq, audience, enterprise);
  if (enterpriseStatus !== 'available') {
    answer = '本次未核实企业施工标准，以下为通用装修常识，不代表公司规定。\n\n' + answer;
  }
  const violations = stageAnswerViolations(answer, enterpriseStatus === 'available');
  if (violations.length) {
    answer = '本次未核实企业施工标准，以下为通用装修常识，不代表公司规定。\n\n' + pack.intro
      + '\n\n这个问题涉及需要核实的具体参数或工程结论，当前资料不足以给出确定回答。请以企业书面工艺标准、正式图纸和现场交底为准。'
      + '\n\n边界：' + pack.boundaries.join(' ');
  }
  return {
    protocol: stageAnswerProtocol, agentId: agent.agentId, stageId: stage.stageId, stageName: stage.name,
    intent: route.intent, answer, matchedFaqId: faq?.id ?? null, basis: enterprise.length ? 'enterprise_knowledge' : 'stage_knowledge',
    enterpriseKnowledgeStatus: enterpriseStatus,
    citations: enterprise.map(item => ({ ...item })), boundaries: pack.boundaries, handoff: null,
  };
}
