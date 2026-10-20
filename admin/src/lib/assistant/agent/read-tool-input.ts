import { AssistantError, fail, id } from '../contracts';
import { businessToolDefinitions, parseBusinessQuery } from './business-tools';
import { historyTool, parseHistoryQuery } from './history';
import { materialTool, parseMaterialQuery } from './materials';
import type { ModelTool } from '../contracts/model';

export const readToolInputProtocol = 'read-input-v2';
const validators = new Map<string, { tool: ModelTool; parse: (input: unknown) => unknown }>([
  ['query_materials', { tool: materialTool, parse: parseMaterialQuery }],
  ['query_business', { tool: businessToolDefinitions.find(tool => tool.name === 'query_business')!, parse: parseBusinessQuery }],
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
export function readToolInputIssue(name: string, args: string, context?: ReadToolContext): { code: string; feedback: string } | null {
  const validator = validators.get(name);
  if (!validator) return null;
  const tool = readToolsForContext([validator.tool], context)[0];
  let input: unknown;
  try {
    try { input = JSON.parse(args); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; return feedback([{ path: '$', code: 'json', expected: 'object' }]); }
    validator.parse(bindReadToolInput(name, input, context));
    return null;
  } catch (error) {
    if (!(error instanceof AssistantError) || error.code !== 'invalid_message' || error.status !== 422) throw error;
    return feedback(inputIssues(tool.parameters, input));
  }
  function feedback(issues: InputIssue[]) {
    return { code: 'invalid_message', feedback: JSON.stringify({ protocol: readToolInputProtocol, status: 'invalid_arguments', tool: name,
      issues, parameters: tool.parameters,
      instructions: '本次查询尚未执行，不是成功回执或无匹配结果。issues逐项指出实际错误：path为字段，expected为要求，received为实际类型；先修正这些字段，再在剩余轮次内查询。'
        + (context?.leadId && homeReadTools.has(name) ? '房屋身份由服务器绑定，不传leadId或其他身份字段，只提交parameters列出的字段。'
          : 'leadId的string必须用JSON双引号包围已知获权ID，不能再次输出number；未知时用合同允许的空字符串，不猜ID。')
        + '房间须为明确房间名，历史查询词限2到80字符。服务器没有自动转换或执行原参数，不声称已查到或已办理。无法确定时作最小澄清。再次参数错误将结束本轮，不增加四轮预算。' }) };
  }
}

export function isReadToolInputFailure(content: string): boolean {
  try { const value = JSON.parse(content); return ['read-input-v1', readToolInputProtocol].includes(value?.protocol) && value.status === 'invalid_arguments'; }
  catch { return false; }
}
