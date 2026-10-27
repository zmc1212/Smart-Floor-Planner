import { tool } from '@langchain/core/tools';
import { ToolInputParsingException } from '@langchain/core/tools';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { fail } from '../contracts';

/** Validate the wire transcript, including restored checkpoints, before dispatch.
 * A result must match exactly one pending call. No result is synthesized here. */
export function assertToolPairs(messages: ModelMessage[]) {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.callId)) fail('invalid_tool_pair', 422);
      continue;
    }
    if (pending.size) fail('invalid_tool_pair', 422);
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls || []) {
      if (pending.has(call.id)) fail('invalid_tool_pair', 422);
      pending.add(call.id);
    }
  }
  if (pending.size) fail('invalid_tool_pair', 422);
}

/** Reuse LangChain's JSON Schema validator with a side-effect-free callback.
 * Only syntax/type rejection is recoverable. Authorization, stale sources and
 * errors from an executed business service never enter this catch boundary. */
export async function toolSchemaIssue(definition: ModelTool, args: string) {
  let value: unknown;
  try { value = JSON.parse(args); } catch { return argumentIssue(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return argumentIssue();
  const validator = tool(async () => 'valid', {
    name: definition.name, description: definition.description, schema: definition.parameters,
  });
  try { await validator.invoke(value, { callbacks: [] }); }
  catch (error) {
    if (error instanceof ToolInputParsingException) return argumentIssue();
    throw error;
  }
  return null;
}
function argumentIssue() {
  return { code: 'invalid_tool_arguments', feedback: JSON.stringify({ status: 'invalid_arguments',
    dispatched: false, instruction: '参数未通过本轮工具schema，未执行任何操作。按当前工具定义修正类型和必填字段，不改写来源或权限；仅有一次参数纠错机会。' }) };
}
