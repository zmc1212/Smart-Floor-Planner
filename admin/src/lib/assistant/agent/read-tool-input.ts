import { AssistantError } from '../contracts';
import { businessToolDefinitions, parseBusinessQuery } from './business-tools';
import { historyTool, parseHistoryQuery } from './history';
import { materialTool, parseMaterialQuery } from './materials';
import type { ModelTool } from '../contracts/model';

export const readToolInputProtocol = 'read-input-v1';
const validators = new Map<string, { tool: ModelTool; parse: (input: unknown) => unknown }>([
  ['query_materials', { tool: materialTool, parse: parseMaterialQuery }],
  ['query_business', { tool: businessToolDefinitions.find(tool => tool.name === 'query_business')!, parse: parseBusinessQuery }],
  ['recall_history', { tool: historyTool, parse: parseHistoryQuery }],
]);

/** Reuse strict application parsers. No database/provider call or value repair. */
export function readToolInputIssue(name: string, args: string): { code: string; feedback: string } | null {
  const validator = validators.get(name);
  if (!validator) return null;
  try {
    let input: unknown;
    try { input = JSON.parse(args); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; return feedback(); }
    validator.parse(input);
    return null;
  } catch (error) {
    if (!(error instanceof AssistantError) || error.code !== 'invalid_message' || error.status !== 422) throw error;
    return feedback();
  }
  function feedback() {
    return { code: 'invalid_message', feedback: JSON.stringify({ protocol: readToolInputProtocol, status: 'invalid_arguments', tool: name,
      parameters: validator!.tool.parameters,
      instructions: '本次查询尚未执行，不是成功回执或无匹配结果。按工具合同修正参数后可在剩余轮次内再查询；leadId必须是原已知获权ID字符串，未知时用合同允许的空字符串，不猜ID；房间须为明确房间名，历史查询词限2到80字符。不自动转换数字ID，不声称已查到或已办理。无法确定时作最小澄清。再次参数错误将结束本轮，不增加四轮预算。' }) };
  }
}

export function isReadToolInputFailure(content: string): boolean {
  try { const value = JSON.parse(content); return value?.protocol === readToolInputProtocol && value.status === 'invalid_arguments'; }
  catch { return false; }
}
