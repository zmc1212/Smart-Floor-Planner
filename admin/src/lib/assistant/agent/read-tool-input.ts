import { AssistantError, fail, id } from '../contracts';
import { businessToolDefinitions, parseBusinessQuery, parseDesignerQuery } from './business-tools';
import { historyTool, parseHistoryQuery } from './history';
import { materialTool, parseMaterialQuery } from './materials';
import { ownerQuestionMaterialTool, readOwnerMaterialInput } from './owner-question-scope';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { originalMessageId } from './context-budget';
import { explicitNeedWriteStatement } from './memory';
import { webSearchTool, parseWebQuery } from './web';
import { readWebTool, parsePublicRead } from './public-research';
import { isKnowledgeTool } from '../knowledge/rag-tools';
import { namedReviewedStandard } from '../web-search/standards';

export const sourceReadProtocol = 'original-source-read-v1';
export const sourceAnswerProtocol = 'question-source-scope-v2';
export const drawingChecklistReadProtocol = 'drawing-checklist-read-v1';

/** Scope a procedural drawing review before sign-off to the knowledge read.
 * A question about whether a particular drawing is approved or ready to sign
 * still needs its own actual project record. */
export function drawingChecklistRequested(question: string): boolean {
  return /图纸|新版图|平面图|点位图|设计图/.test(question)
    && /签字前|签字之前|签署前|签图前|审图前|确认(?:图纸|方案)前|确认前/.test(question)
    && /(?:看|核对|检查|复核|审)(?:哪(?:些|几)|什么)|(?:怎么|如何)(?:看|核对|检查|复核|审图)|有(?:哪些|什么).{0,8}(?:要点|注意|要核对)|(?:核对|检查)清单/.test(question)
    && !/(?:不|别)(?:用|要|必)?查(?:资料|知识库|原文)/.test(question)
    && !originalAnswerOnly(question) && !explicitNeedWriteStatement(question) && !explicitHumanHandoffRequested(question);
}
/** Select an existing read contract, never a document, query or answer. Only
 * the actual current request is inspected; quoted history/tool data cannot
 * establish an executed read. Authorization remains with the existing port. */
export function knowledgeOriginalRequested(question: string): boolean {
  if (namedReviewedStandard(question) || /国标|国家标准|国家规范|公开规范/u.test(question)) return false;
  if (/不(?:用|要|必)?(?:查|检索|读取|查阅)[^。；\n]{0,16}(?:原文|文件|文档|资料)/.test(question)) return false;
  if (/(?:聊天|我(?:的|说|之前|早先)|客户)[^。；\n]{0,20}(?:原文|原话)/.test(question)
    && !/文件|文档|手册|第[一二三四五六七八九十百零〇两\d]{1,8}(?:页|章|节)|\.(?:pdf|docx|xlsx)/i.test(question)) return false;
  const asks = /[？?]|如何|怎么|怎样|区分|解释|请查|查询|查阅|比较|对照|写了什么|说了什么|^(?:请)?说明/.test(question);
  const locator = /第[一二三四五六七八九十百零〇两\d]{1,8}(?:页|章|节|段落?|条款?|行)/.test(question);
  const source = /原文|原件|文件|文档|手册|说明|条款|《[^》\n]{1,160}》/;
  const file = /\.(?:pdf|docx|xlsx|txt|md)(?:\b|[”」》])/i.test(question);
  return asks && Boolean(file || locator && source.test(question) || /原文|原件|《[^》\n]{1,160}》/.test(question));
}

/** A source-content question does not request new project procedures or advice.
 * Explicit joint application/advice keeps the existing synthesis contract. This
 * is a bounded intent scope, not source selection or semantic entailment. */
export function originalAnswerOnly(question: string): boolean {
  return knowledgeOriginalRequested(question) && !explicitNeedWriteStatement(question) && !explicitHumanHandoffRequested(question)
    && !/(?:结合|针对)(?:我|本|当前|现有|这个)|(?:另外|此外|顺便|也请|同时|再给)[^。；\n]{0,40}(?:建议|取舍|现场|我家|项目)|(?:一般|通用)(?:的|选择)?建议/.test(question);
}

/** Explicit standalone advice does not ask to apply the customer's stored
 * project/history. This is a bounded source scope, not an entailment detector:
 * mixed requests and explicit factual premises retain the full contract. */
export function independentAdviceRequested(question: string): boolean {
  if (explicitNeedWriteStatement(question) || explicitHumanHandoffRequested(question) || knowledgeOriginalRequested(question)) return false;
  if (!/(?:一般|通用)(?:的|选择)?建议/.test(question) || !/(?:独立问题|独立提问|单独问|不结合(?:我|本)|不针对(?:我|本))/.test(question)) return false;
  const remaining = question.replace(/不(?:结合|针对)(?:我家|我的项目|本人项目|本项目|我|本人)/g, '');
  // Do not discard a supplied premise, current fact, requested recall or
  // hypothetical comparison merely because the turn also says "independent".
  return !/结合|针对|根据|基于|考虑到|如果|假如|假设|我家|我的|本人|本项目|现场|当前需求|之前|原话|原记录|请记|更正|改为/.test(
    remaining.replace(/不(?:新增|修改|变更)(?:(?:或|和)(?:新增|修改|变更))?(?:我(?:的)?)?需求/g, ''));
}

/** Share the existing current-turn handoff gate with answer-scope projection.
 * Do not create a competing permission or reinterpret quoted/negative requests. */
export function explicitHumanHandoffRequested(text: string): boolean {
  return /找.{0,3}设计师|转人工|让设计师|设计师接着聊/.test(text) && !/不要|不想|不用|别|如果|假如|能否|是不是|“|「|"/.test(text);
}

// A public receipt cannot satisfy a request for the enterprise's own practice.
export const companyPracticeRequested = (question: string) =>
  /(?:本企业|(?:你们|我们)(?:这家)?公司|公司自己)(?:的|内部)?[^。；\n]{0,18}(?:工艺|标准|规范|防水|施工|资料|规定)/u.test(question);

export function knowledgeReadPending(question: string, messages: ModelMessage[], triggerId: string, required = false): boolean {
  if (!required && !knowledgeOriginalRequested(question) && !companyPracticeRequested(question)) return false;
  const start = messages.findIndex(message => originalMessageId(message) === triggerId);
  if (start < 0) return true;
  return !messages.some((message, index) => {
    if (index <= start || message.role !== 'tool' || isReadToolInputFailure(message.content)) return false;
    let requestIndex = index - 1;
    while (requestIndex > start && messages[requestIndex].role === 'tool') requestIndex--;
    const request = messages[requestIndex];
    if (request?.role !== 'assistant' || !request.toolCalls?.some(call => call.id === message.callId && (call.name === 'search_knowledge' || isKnowledgeTool(call.name)))) return false;
    try {
      const packet = JSON.parse(message.content);
      return ['ready', 'not_ready', 'empty', 'unavailable'].includes(packet?.knowledgeStatus) && Array.isArray(packet.evidence) && Array.isArray(packet.synthesisSources);
    } catch { return false; }
  });
}

export const readToolInputProtocol = 'read-input-v2';
const validators = new Map<string, { tool: ModelTool; parse: (input: unknown) => unknown }>([
  ['search_web', { tool: webSearchTool, parse: parseWebQuery }],
  ['read_web', { tool: readWebTool, parse: parsePublicRead }],
  ['query_materials', { tool: materialTool, parse: parseMaterialQuery }],
  ['query_business', { tool: businessToolDefinitions.find(tool => tool.name === 'query_business')!, parse: parseBusinessQuery }],
  ['recommend_designers', { tool: businessToolDefinitions.find(tool => tool.name === 'recommend_designers')!, parse: parseDesignerQuery }],
  ['recall_history', { tool: historyTool, parse: parseHistoryQuery }],
]);

export const readToolContextProtocol = 'conversation-read-v1';
export type ReadToolContext = { protocol: typeof readToolContextProtocol; leadId: string | null };
const homeReadTools = new Set(['query_materials', 'query_business']);

/** Identity comes only from the authorized conversation. An existing run with
 * no context marker keeps its original model contract, including cached calls. */
export function readToolContext(entry: Record<string, unknown>, previous?: Record<string, unknown>): ReadToolContext | undefined {
  if (previous && !Object.hasOwn(previous, 'readContext')) return undefined;
  let leadId: string | null = null;
  if (entry.kind === 'lead') {
    if (typeof entry.id !== 'string') fail('context_changed');
    try { leadId = id(entry.id); } catch { fail('context_changed'); }
  }
  const current: ReadToolContext = { protocol: readToolContextProtocol, leadId };
  if (previous) {
    const saved = previous.readContext as ReadToolContext | undefined;
    if (!saved || Object.keys(saved).some(key => !['protocol', 'leadId'].includes(key))
      || saved.protocol !== current.protocol || saved.leadId !== current.leadId) fail('context_changed');
  }
  return current;
}

export function readToolsForContext(tools: ModelTool[], context?: ReadToolContext): ModelTool[] {
  if (!context?.leadId) return tools;
  return tools.map(tool => {
    if (!homeReadTools.has(tool.name)) return tool;
    const properties = { ...tool.parameters.properties as Record<string, unknown> };
    delete properties.leadId;
    return { ...tool, description: '房屋身份由服务器从当前咨询注入，只提供以下参数，不传leadId或其他身份。' + tool.description,
      parameters: { ...tool.parameters, properties, required: (tool.parameters.required as string[]).filter(key => key !== 'leadId') } };
  });
}

/** Never strip or coerce a model-selected identity. Reject it before injecting
 * the server identity, then let the unchanged application parser validate. */
export function bindReadToolInput(name: string, input: unknown, context?: ReadToolContext): unknown {
  if (!context?.leadId || !homeReadTools.has(name)) return input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'leadId')) fail('invalid_message', 422);
  return { ...input, leadId: context.leadId };
}

type InputIssue = { path: string; code: 'type' | 'required' | 'enum' | 'minLength' | 'maxLength' | 'additionalProperties' | 'json' | 'application_contract'; expected?: unknown; received?: string };
/** Diagnostic projection only. The existing parser decides validity; paths,
 * constraints and type labels come from trusted schemas, never input values. */
function inputIssues(parameters: ModelTool['parameters'], input: unknown): InputIssue[] {
  const type = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [{ path: '$', code: 'type', expected: 'object', received: type(input) }];
  const properties = parameters.properties as Record<string, Record<string, unknown>>;
  const required = parameters.required as string[];
  const value = input as Record<string, unknown>, issues: InputIssue[] = [];
  for (const [path, schema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, path)) {
      if (required.includes(path)) issues.push({ path, code: 'required', expected: schema.type, received: 'missing' });
      continue;
    }
    if (type(value[path]) !== schema.type) { issues.push({ path, code: 'type', expected: schema.type, received: type(value[path]) }); continue; }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value[path])) issues.push({ path, code: 'enum', expected: schema.enum });
    if (typeof value[path] === 'string') {
      if (typeof schema.minLength === 'number' && value[path].length < schema.minLength) issues.push({ path, code: 'minLength', expected: schema.minLength });
      if (typeof schema.maxLength === 'number' && value[path].length > schema.maxLength) issues.push({ path, code: 'maxLength', expected: schema.maxLength });
    }
  }
  if (parameters.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) issues.push({ path: '$', code: 'additionalProperties', expected: false });
  return issues.length ? issues : [{ path: '$', code: 'application_contract' }];
}

/** Reuse strict application parsers. No database/provider call or value repair. */
export function readToolInputIssue(name: string, args: string, context?: ReadToolContext, ownerScope = false, archiveAllowed = true,
  projectStatusRead = false): { code: string; feedback: string } | null {
  const validator = validators.get(name);
  if (!validator) return null;
  const scopedMaterials = ownerScope && name === 'query_materials';
  const boundTool = readToolsForContext([validator.tool], context)[0];
  const tool = scopedMaterials || name === 'query_business' && projectStatusRead
    ? ownerQuestionMaterialTool(boundTool, archiveAllowed, projectStatusRead) : boundTool;
  let input: unknown;
  try {
    try { input = JSON.parse(args); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; return feedback([{ path: '$', code: 'json', expected: 'object' }]); }
    const bound = bindReadToolInput(name, input, context);
    if (scopedMaterials) readOwnerMaterialInput(bound as Record<string, unknown>, archiveAllowed);
    else if (name === 'query_business' && projectStatusRead) parseBusinessQuery(bound, true);
    else validator.parse(bound);
    return null;
  } catch (error) {
    if (!(error instanceof AssistantError) || !['invalid_message', 'invalid_web_query', 'private_web_query'].includes(error.code) || error.status !== 422) throw error;
    return feedback(inputIssues(tool.parameters, input));
  }
  function feedback(issues: InputIssue[]) {
    return { code: 'invalid_message', feedback: JSON.stringify({ protocol: readToolInputProtocol, status: 'invalid_arguments', tool: name,
      issues, parameters: tool.parameters,
      instructions: '本次查询尚未执行，不是成功回执或无匹配结果。issues逐项指出实际错误：path为字段，expected为要求，received为实际类型；先修正这些字段，再在剩余轮次内查询。'
        + (context?.leadId && homeReadTools.has(name) ? '房屋身份由服务器绑定，不传leadId或其他身份字段，只提交parameters列出的字段。'
          : name === 'recommend_designers' ? '只提交query，复述客户本轮或已记录中明确的城市/风格/户型；没有明确方向传空字符串。'
          : 'leadId的string必须用JSON双引号包围已知获权ID，不能再次输出number；未知时用合同允许的空字符串，不猜ID。')
        + '房间须为明确房间名，历史查询词限2到80字符。服务器没有自动转换或执行原参数，不声称已查到或已办理。无法确定时作最小澄清。再次参数错误将结束本轮，不增加四轮预算。' }) };
  }
}

export function isReadToolInputFailure(content: string): boolean {
  try { const value = JSON.parse(content); return ['read-input-v1', readToolInputProtocol].includes(value?.protocol) && value.status === 'invalid_arguments'; }
  catch { return false; }
}
