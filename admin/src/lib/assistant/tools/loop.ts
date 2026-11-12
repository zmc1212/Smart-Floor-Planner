import { agentModelLimits, type AgentModelGateway, type ModelMessage, type ModelTurnOutput } from '../contracts/model';
import { assertToolPairs } from '../agent/tool-protocol';
import type { ActorContext } from '../contracts';
import {
  toolEngineLimits, toolLoopFinalInstruction, toolLoopProtocol,
  type ToolExecutionRecord,
} from './contract';
import { ToolExecutor, type ToolExecutionScope } from './executor';
import type { ToolRegistry } from './registry';

export type ToolLoopFailureCode =
  | 'tool_loop_limit' | 'tool_call_limit' | 'tool_protocol_invalid'
  | 'tool_loop_timeout' | 'tool_loop_interrupted' | 'tool_loop_failed'
  | 'tool_model_response_invalid';

export type ToolLoopTurn = {
  turn: number;
  toolsOffered: string[];
  textChars: number;
  toolCalls: string[];
  finishReason: string | null;
  providerRequestId: string | null;
  attemptId: string;
  usage: ModelTurnOutput['usage'];
};

export type ToolLoopContext = {
  actor: ActorContext;
  projectId: string | null;
  conversationId?: string;
  runId?: string;
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type ToolLoopOptions = {
  gateway: AgentModelGateway;
  registry: ToolRegistry;
  messages: ModelMessage[];
  context: ToolLoopContext;
  /** Total model calls, including the reserved final-answer call. */
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  executor?: ToolExecutor;
};

export type ToolLoopOutcome = {
  protocol: typeof toolLoopProtocol;
  status: 'completed' | 'failed';
  text: string;
  messages: ModelMessage[];
  turns: ToolLoopTurn[];
  /** Real per-call evidence; the caller persists it in its run checkpoint or
   * audit store. This module never writes a database. */
  records: ToolExecutionRecord[];
  code?: ToolLoopFailureCode;
  message?: string;
};

function failure(
  base: Omit<ToolLoopOutcome, 'status' | 'code' | 'message'>,
  code: ToolLoopFailureCode,
  message: string,
): ToolLoopOutcome {
  return { ...base, status: 'failed', code, message };
}

/** Route one failed call's content when the batch can no longer execute. */
function interruptedContent(callId: string, tool: string) {
  return JSON.stringify({
    ok: false, tool, callId, status: 'interrupted',
    error: { code: 'tool_interrupted', message: '本轮已中断，该工具未执行' }, dispatched: false,
    instruction: '该工具未执行，结果不可当作成功。',
  });
}

/**
 * Provider-neutral tool loop:
 * user request -> model -> registered tool -> authorization -> execution ->
 * function_call_output -> model -> final answer.
 *
 * `AgentModelGateway` is the only model dependency, so the loop never contains
 * provider wire fields or execution logic inside a provider adapter. The wire
 * transcript stays in the project's existing `ModelMessage` context mechanism:
 * the Responses adapter rebuilds `function_call` / `function_call_output` items
 * on every turn and never relies on provider-side retention.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopOutcome> {
  const maxTurns = options.maxTurns ?? agentModelLimits.maxModelTurns;
  const maxToolCalls = options.maxToolCallsPerTurn ?? agentModelLimits.maxToolCalls;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > toolEngineLimits.maxTurns) {
    throw Error('tool_loop_turn_limit');
  }
  if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > toolEngineLimits.maxToolCallsPerTurn) {
    throw Error('tool_loop_call_limit');
  }
  const maxTokens = options.maxTokens ?? agentModelLimits.maxOutputTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > agentModelLimits.maxOutputTokens) {
    throw Error('tool_loop_token_limit');
  }
  assertToolPairs(options.messages);

  const now = () => Date.now();
  const deadline = options.context.deadlineAt;
  const check = (): 'interrupted' | 'timeout' | null => {
    if (options.context.signal?.aborted) return 'interrupted';
    if (deadline !== undefined && now() >= deadline) return 'timeout';
    return null;
  };
  const executor = options.executor ?? new ToolExecutor(options.registry);
  const messages: ModelMessage[] = [...options.messages];
  const turns: ToolLoopTurn[] = [];
  const base = () => ({ protocol: toolLoopProtocol as typeof toolLoopProtocol, text: '', messages,
    turns, records: [...executor.records()] });

  for (let turn = 0; turn < maxTurns; turn++) {
    const state = check();
    if (state === 'interrupted') return failure(base(), 'tool_loop_interrupted', '本轮已被调用方中断');
    if (state === 'timeout') return failure(base(), 'tool_loop_timeout', '本轮已超过总时限');

    const finalTurn = turn === maxTurns - 1;
    const tools = finalTurn ? [] : options.registry.toModelTools();
    const modelMessages: ModelMessage[] = finalTurn && options.registry.size
      ? [...messages, { role: 'system', content: [{ type: 'text', text: toolLoopFinalInstruction }] }]
      : messages;

    let output: ModelTurnOutput & { attemptId: string };
    try {
      output = await options.gateway.generate({
        messages: modelMessages, tools, maxTokens,
        ...(options.enableThinking === undefined ? {} : { enableThinking: options.enableThinking }),
      });
    } catch (error) {
      return failure(base(), 'tool_loop_failed',
        `model_turn_failed:${(error instanceof Error ? error.message : 'unknown').replace(/\s+/g, ' ').slice(0, 300)}`);
    }

    turns.push({
      turn, toolsOffered: tools.map(tool => tool.name), textChars: output.text.length,
      toolCalls: output.toolCalls.map(call => call.name), finishReason: output.finishReason,
      providerRequestId: output.providerRequestId, attemptId: output.attemptId, usage: output.usage,
    });

    if (!output.toolCalls.length) {
      if (!output.text.trim()) return failure(base(), 'tool_model_response_invalid', '模型未返回工具调用或最终回答');
      const stateAfter = check();
      if (stateAfter === 'interrupted') return failure(base(), 'tool_loop_interrupted', '本轮已被调用方中断');
      if (stateAfter === 'timeout') return failure(base(), 'tool_loop_timeout', '本轮已超过总时限');
      // The final assistant turn is part of the returned transcript so the
      // caller can checkpoint exactly what the model answered.
      messages.push({ role: 'assistant', content: output.text });
      return { ...base(), status: 'completed', text: output.text };
    }

    if (finalTurn) return failure(base(), 'tool_loop_limit', `模型在收尾轮仍请求工具（${output.toolCalls.length} 个），未执行`);
    if (output.toolCalls.length > maxToolCalls) {
      return failure(base(), 'tool_call_limit', `单轮工具调用超过上限 ${maxToolCalls}`);
    }
    const ids = new Set(output.toolCalls.map(call => call.id));
    if (ids.size !== output.toolCalls.length) return failure(base(), 'tool_protocol_invalid', '模型返回了重复的 call_id');

    messages.push({ role: 'assistant', content: output.text, toolCalls: output.toolCalls });
    const scope: ToolExecutionScope = {
      actor: options.context.actor, projectId: options.context.projectId,
      ...(options.context.conversationId ? { conversationId: options.context.conversationId } : {}),
      ...(options.context.runId ? { runId: options.context.runId } : {}),
      turn, ...(options.context.signal ? { signal: options.context.signal } : {}),
      ...(deadline !== undefined ? { deadlineAt: deadline } : {}),
    };

    for (const [index, call] of output.toolCalls.entries()) {
      const result = await executor.execute(call, scope);
      messages.push({ role: 'tool', callId: call.id, content: result.content });
      if (result.status !== 'interrupted') continue;
      // Keep every call paired after an interruption; remaining calls are
      // explicitly not dispatched and never appear as success.
      for (const remaining of output.toolCalls.slice(index + 1)) {
        messages.push({ role: 'tool', callId: remaining.id, content: interruptedContent(remaining.id, remaining.name) });
      }
      return failure(base(), 'tool_loop_interrupted', '工具执行时本轮被调用方中断');
    }

    const stateAfter = check();
    if (stateAfter === 'interrupted') return failure(base(), 'tool_loop_interrupted', '本轮已被调用方中断');
    if (stateAfter === 'timeout') return failure(base(), 'tool_loop_timeout', '本轮已超过总时限');
  }

  return failure(base(), 'tool_loop_limit', '工具调用轮次超过上限');
}
