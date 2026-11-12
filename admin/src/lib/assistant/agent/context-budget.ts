import { fail } from '../contracts';
import { agentModelLimits, reportFinalOutputTokenLimit, type ModelMessage, type ModelTool, type ModelTurnInput } from '../contracts/model';
import { consultationProfile } from '../contracts/consultation';

/** Application estimate, deliberately independent of a provider's advertised window.
 * Includes JSON/tool overhead, output, images and room for the next tool result.
 * This is not a tokenizer or a semantic summary. */
export const contextBudgetPolicy = {
  version: 'complete-turns-utf8-third-v1', inputBudget: 16000,
  summaryTrigger: 14500, summaryTarget: 13000, bytesPerToken: 3,
  imageTokens: 1536, toolResultReserve: 768, recentTurns: 3,
} as const;

/** Fits the existing 48KB text + four image + output/result envelope. This is
 * a separately reserved application policy, not the model's advertised window. */
export const imageContextBudgetPolicy = {
  version: 'conversation-images-budget-v1', inputBudget: 25600,
  summaryTrigger: 24000, summaryTarget: 22000,
  // Four runtime calls (including final/repair), plus at most one history summary.
  maxDispatches: agentModelLimits.maxModelTurns + 1,
} as const;

export type RequestBudgetOptions = { profile?: ModelTurnInput['profile']; purpose?: 'answer' | 'vision' | 'summary' | 'grounding';
  reportFinalOutputTokens?: typeof reportFinalOutputTokenLimit;
  /** Report finals keep only the current question and its tool result; older
   * completed interactions are context, not evidence for this frozen report. */
  recentTurns?: number;
  /** Only new server-owned runs with the matching quota reservation can bind this. */
  imageContextBudget?: typeof imageContextBudgetPolicy.version };
export function agentRequestBudget(options: RequestBudgetOptions = {}) {
  if (options.reportFinalOutputTokens !== undefined) {
    if (options.reportFinalOutputTokens !== reportFinalOutputTokenLimit || options.profile || options.imageContextBudget
      || options.purpose !== 'answer') fail('agent_input_limit', 422);
    return { ...contextBudgetPolicy, maxOutputTokens: reportFinalOutputTokenLimit, policy: contextBudgetPolicy.version };
  }
  if (options.imageContextBudget !== undefined) {
    if (options.imageContextBudget !== imageContextBudgetPolicy.version || options.profile
      || options.purpose && options.purpose !== 'answer') fail('agent_input_limit', 422);
    return { ...imageContextBudgetPolicy, maxOutputTokens: agentModelLimits.maxOutputTokens, policy: imageContextBudgetPolicy.version };
  }
  if (!options.profile) return { inputBudget: contextBudgetPolicy.inputBudget, summaryTrigger: contextBudgetPolicy.summaryTrigger,
    summaryTarget: contextBudgetPolicy.summaryTarget, maxOutputTokens: agentModelLimits.maxOutputTokens, policy: contextBudgetPolicy.version };
  const profile = consultationProfile(options.profile);
  if (!profile || options.purpose && !['answer','vision','summary','grounding'].includes(options.purpose)) fail('agent_input_limit', 422);
  return { inputBudget: 32000, summaryTrigger: 30000, summaryTarget: 28000,
    maxOutputTokens: !options.purpose || options.purpose === 'answer' ? profile.maxOutputTokens : agentModelLimits.maxOutputTokens,
    policy: contextBudgetPolicy.version + ':' + profile.id };
}

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

export function estimateAgentRequest(messages: ModelMessage[], tools: ModelTool[], options: RequestBudgetOptions = {}) {
  let images = 0;
  const view = messages.map(message => message.role === 'system' || message.role === 'user'
    ? { ...message, content: message.content.map(part => {
      if (part.type !== 'image') return part;
      images++;
      return { ...part, data: '' };
    }) } : message);
  const textBytes = Buffer.byteLength(JSON.stringify({ messages: view, tools }));
  const estimatedTokens = Math.ceil(textBytes / contextBudgetPolicy.bytesPerToken)
    + images * contextBudgetPolicy.imageTokens + agentRequestBudget(options).maxOutputTokens + contextBudgetPolicy.toolResultReserve;
  return { textBytes, images, estimatedTokens };
}

/** Remove only earlier COMPLETE customer interactions. Current input, recent
 * turns, system rules, images and the entire current tool/repair sequence stay.
 * No tool result is shortened and no original/checkpoint is modified. */
export function fitAgentContext(messages: ModelMessage[], tools: ModelTool[], options: RequestBudgetOptions = {}) {
  // Validate the binding even if a current-text projection removed every image.
  agentRequestBudget(options);
  const hasImage = messages.some(message => (message.role === 'user' || message.role === 'system')
    && message.content.some(part => part.type === 'image'));
  const limits = agentRequestBudget({ ...options, imageContextBudget: hasImage ? options.imageContextBudget : undefined });
  const before = estimateAgentRequest(messages, tools, options);
  let fitted = messages;
  const omittedMessageIds: string[] = [];
  if (before.estimatedTokens > limits.summaryTrigger || before.textBytes > agentModelLimits.maxTextBytes) {
    const starts = messages.flatMap((message, i) => originalMessageId(message) ? [i] : []);
    const recentTurns = options.recentTurns ?? contextBudgetPolicy.recentTurns;
    const removable = starts.slice(0, -recentTurns);
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
      const estimate = estimateAgentRequest(fitted, tools, options);
      if (estimate.estimatedTokens <= limits.summaryTarget && estimate.textBytes <= agentModelLimits.maxTextBytes) break;
    }
  }
  const after = estimateAgentRequest(fitted, tools, options);
  if (after.estimatedTokens > limits.inputBudget || after.textBytes > agentModelLimits.maxTextBytes) fail('agent_input_limit', 422);
  assertToolPairs(fitted);
  return { messages: fitted, diagnostic: { policy: limits.policy, before, after, omittedMessageIds } };
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
