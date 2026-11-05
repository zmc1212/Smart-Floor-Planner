import { fail, fingerprint } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { parseMaterialQuery } from './materials';

export const ownerQuestionScopeProtocol = 'owner-question-scope-v1';
export const ownerArchiveReadProtocol = 'owner-archive-read-v1';
const choices = ['materials', 'site', 'knowledge_and_site'] as const;
type Scope = typeof choices[number];
const projectReadTools = new Set(['query_business', 'query_followups', 'restore_sources']);

/** An affirmative request for an existing artifact can open project reads.
 * A room, a drawing mention or a model's route label cannot open them. */
export function ownerArchiveReadRequested(question: string): boolean {
  const first = question.trim().split(/[，,。；;！？?!\n]/u, 1)[0];
  const request = /^(?:麻烦|请问|请|能不能|能否|可以|我想)?\s*(?:帮我|给我|让我)?\s*(?:再)?(?:找(?:下|一下|到)?|查阅|查询|查看|查(?:下|一下)?|看看|看一下|打开|发我|调出|核对)\s*(?<target>[^“”「」"：:]{2,64})$/u.exec(first);
  const target = request?.groups?.target;
  if (!target || /怎么|如何|什么|哪些|是不是|是否|进度|排期|要不要|完成|落实|签字|核对步骤|核对方法|企业|标准|手册|规范/u.test(target)
    || /(?:不|别)(?:要|用|必)?(?:再)?(?:查|看|找|打开|发)/u.test(question)) return false;
  return /(?:图纸|平面图|点位图|户型图|户型档案|资料|原记录|发布记录|原件|档案|正式方案|正式版本|预约记录|客户需求|需求原话)(?:和(?:客户)?需求)?(?:给我|好吗|可以吗|吗)?$/u.test(target);
}

export function ownerReadToolAllowed(name: string, archiveAllowed: boolean): boolean {
  return archiveAllowed || !projectReadTools.has(name);
}
export type OwnerQuestionIdentity = {
  enterpriseId: string;
  conversationId: string;
  runId: string;
  messageId: string;
  leadId: string;
  question: string;
};

export function ownerQuestionMaterialTool(tool: ModelTool, archiveAllowed = true): ModelTool {
  if (tool.name === 'search_knowledge' && !archiveAllowed)
    return { ...tool, description: '查询当前独立装修知识问项的获权企业做法、标准和适用条件，返回可追溯原文。现场确认与独立知识混合时，先按现场确认分流，再查知识问项。' };
  if (tool.name !== 'query_materials') return tool;
  return { ...tool,
    description: '本人项目问项先分范围。' + (archiveAllowed ? '索取获权正式档案或原记录用 materials。' : '本轮项目档案读取未开放。')
      + '进度、排期、实际点位、两张图不一致待现场决定等用 site；如果同时明确追问通用工艺、核对步骤或企业标准，用 knowledge_and_site。承接上一问只补充房间和实际差异时按当前新增问项判断，不把之前已经回答的清单再算作新问题。只有知识的问题用 search_knowledge，不查本人材料。',
    parameters: { ...tool.parameters,
      properties: { ...tool.parameters.properties as object, scope: { type: 'string', enum: choices.filter(scope => archiveAllowed || scope !== 'materials') } },
      required: [...tool.parameters.required as string[], 'scope'] },
  };
}

export function readOwnerMaterialInput(input: Record<string, unknown>, archiveAllowed = true) {
  const { scope, ...query } = input;
  if (!choices.includes(scope as Scope) || !archiveAllowed && scope === 'materials') fail('invalid_message', 422);
  return { scope: scope as Scope, query: parseMaterialQuery(query) };
}

export function ownerQuestionScope(identity: OwnerQuestionIdentity, scope: 'site' | 'knowledge_and_site') {
  return { protocol: ownerQuestionScopeProtocol, scope, binding: fingerprint({ identity, scope }) };
}

export function readOwnerQuestionScope(receipt: unknown, identity: OwnerQuestionIdentity) {
  const value = receipt as ReturnType<typeof ownerQuestionScope>;
  if (!value || (value.scope !== 'site' && value.scope !== 'knowledge_and_site')
    || fingerprint(value) !== fingerprint(ownerQuestionScope(identity, value.scope))) fail('context_changed');
  return value.scope;
}
