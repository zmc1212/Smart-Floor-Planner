import { fail } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool } from '../contracts/model';

/** Application estimate, deliberately independent of a provider's advertised window.
 * Includes JSON/tool overhead, output, images and room for the next tool result.
 * This is not a tokenizer or a semantic summary. */
export const contextBudgetPolicy = {
  version: 'complete-turns-utf8-third-v1', inputBudget: 16000,
  summaryTrigger: 14500, summaryTarget: 13000, bytesPerToken: 3,
  imageTokens: 1536, toolResultReserve: 768, recentTurns: 3,
} as const;

export function originalMessageId(message: ModelMessage): string | null {
  if (message.role !== 'user') return null;
  for (const part of message.content) {
    if (part.type !== 'text') continue;
    try {
      const packet = JSON.parse(part.text);
      if (typeof packet.sourceMessageId === 'string' && typeof packet.text === 'string') return packet.sourceMessageId;
    } catch { /* Images and context notices are not original customer turns. */ }
  }
  return null;
}

export function estimateAgentRequest(messages: ModelMessage[], tools: ModelTool[]) {
  let images = 0;
  const view = messages.map(message => message.role === 'system' || message.role === 'user'
    ? { ...message, content: message.content.map(part => {
      if (part.type !== 'image') return part;
      images++;
      return { ...part, data: '' };
    }) } : message);
  const textBytes = Buffer.byteLength(JSON.stringify({ messages: view, tools }));
  const estimatedTokens = Math.ceil(textBytes / contextBudgetPolicy.bytesPerToken)
    + images * contextBudgetPolicy.imageTokens + agentModelLimits.maxOutputTokens + contextBudgetPolicy.toolResultReserve;
  return { textBytes, images, estimatedTokens };
}

/** Remove only earlier COMPLETE customer interactions. Current input, recent
 * turns, system rules, images and the entire current tool/repair sequence stay.
 * No tool result is shortened and no original/checkpoint is modified. */
export function fitAgentContext(messages: ModelMessage[], tools: ModelTool[]) {
  const before = estimateAgentRequest(messages, tools);
  let fitted = messages;
  const omittedMessageIds: string[] = [];
  if (before.estimatedTokens > contextBudgetPolicy.summaryTrigger || before.textBytes > agentModelLimits.maxTextBytes) {
    const starts = messages.flatMap((message, i) => originalMessageId(message) ? [i] : []);
    const removable = starts.slice(0, -contextBudgetPolicy.recentTurns);
    const removed = new Set<number>();
    for (const start of removable) {
      const end = starts[starts.indexOf(start) + 1];
      for (let i = start; i < end; i++) {
        const message = messages[i];
        // Host images and trusted repair instructions are never discardable.
        if (message.role === 'system' || (message.role === 'user' && message.content.some(p => p.type === 'image'))) continue;
        removed.add(i);
      }
      omittedMessageIds.push(originalMessageId(messages[start])!);
      fitted = messages.filter((_, i) => !removed.has(i));
      const estimate = estimateAgentRequest(fitted, tools);
      if (estimate.estimatedTokens <= contextBudgetPolicy.summaryTarget && estimate.textBytes <= agentModelLimits.maxTextBytes) break;
    }
  }
  const after = estimateAgentRequest(fitted, tools);
  if (after.estimatedTokens > contextBudgetPolicy.inputBudget || after.textBytes > agentModelLimits.maxTextBytes) fail('agent_input_limit', 422);
  assertToolPairs(fitted);
  return { messages: fitted, diagnostic: { policy: contextBudgetPolicy.version, before, after, omittedMessageIds } };
}

/** Provider-neutral protocol validation before dispatch, including replay. */
export function assertToolPairs(messages: ModelMessage[]) {
  let pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.callId)) fail('invalid_agent_checkpoint', 409);
      continue;
    }
    if (pending.size) fail('invalid_agent_checkpoint', 409);
    if (message.role === 'assistant' && message.toolCalls?.length) {
      pending = new Set(message.toolCalls.map(call => call.id));
      if (pending.size !== message.toolCalls.length) fail('invalid_agent_checkpoint', 409);
    }
  }
  if (pending.size) fail('invalid_agent_checkpoint', 409);
}
