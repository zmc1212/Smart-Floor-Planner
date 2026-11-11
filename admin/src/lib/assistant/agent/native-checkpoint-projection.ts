import type { ModelMessage } from '../contracts/model';
import { modelBusinessReceipt, type DialogueToolReceipt } from './dialogue-tools';

/** Older checkpoints persisted the full `query_business` receipt (including the
 * snapshot `resultKey`) in their tool messages. The current tool port projects
 * that receipt to `{status,text}` before it reaches the model, so a resumed run
 * must apply the same model-input projection to already-saved messages. Only the
 * model-visible copy changes: the persisted receipt, tool dispatch and the
 * checkpoint's repair/unknown bookkeeping stay exactly as saved. */
function legacyBusinessReceipt(content: string): DialogueToolReceipt | null {
  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === 'object' && !Array.isArray(value) && 'resultKey' in value
      ? value as DialogueToolReceipt : null;
  } catch { return null; }
}

export function projectLegacyBusinessToolMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const businessCalls = new Set<string>();
  const projected: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) if (call.name === 'query_business') businessCalls.add(call.id);
      projected.push(message);
      continue;
    }
    if (message.role !== 'tool' || !businessCalls.has(message.callId)) { projected.push(message); continue; }
    const receipt = legacyBusinessReceipt(message.content);
    projected.push(receipt ? { ...message, content: JSON.stringify(modelBusinessReceipt(receipt)) } : message);
  }
  return projected;
}
