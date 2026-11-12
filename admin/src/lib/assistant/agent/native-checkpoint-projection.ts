import type { ModelMessage } from '../contracts/model';
import { modelBusinessReceipt, type DialogueToolReceipt } from './dialogue-tools';

/** Older checkpoints persisted the full `query_business` receipt (including the
 * snapshot `resultKey`) in their tool messages. The current tool port projects
 * that receipt to `{status,text}` before it reaches the model, so a resumed run
 * must apply the same model-input projection to already-saved messages. Only the
 * model-visible copy changes: the persisted receipt, tool dispatch and the
 * checkpoint's repair/unknown bookkeeping stay exactly as saved. Bindings are
 * tracked per pending batch: the protocol allows a later batch to reuse a call
 * id, so a historical id can never decide a later tool's identity. */
function legacyBusinessReceipt(content: string): DialogueToolReceipt | null {
  try {
    const value: unknown = JSON.parse(content);
    return value !== null && typeof value === 'object' && !Array.isArray(value) && 'resultKey' in value
      ? value as DialogueToolReceipt : null;
  } catch { return null; }
}

export function projectLegacyBusinessToolMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const pending = new Map<string, string>();
  const projected: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      // An assistant message declares its own batch; previous bindings are
      // complete (or their receipts never arrived) and a reused id now belongs
      // to the tool named here.
      pending.clear();
      for (const call of message.toolCalls ?? []) pending.set(call.id, call.name);
      projected.push(message);
      continue;
    }
    if (message.role !== 'tool') { projected.push(message); continue; }
    const name = pending.get(message.callId);
    pending.delete(message.callId);
    if (name !== 'query_business') { projected.push(message); continue; }
    const receipt = legacyBusinessReceipt(message.content);
    projected.push(receipt ? { ...message, content: JSON.stringify(modelBusinessReceipt(receipt)) } : message);
  }
  return projected;
}
