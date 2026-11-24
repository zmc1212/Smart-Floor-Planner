import { AiProviderError } from '../provider-types';
import { asObject } from './http';

function incomplete() {
  return new AiProviderError('Assistant final text stream was incomplete', 'INVALID_PROVIDER_RESPONSE', 'unknown', 502);
}

/** Reassemble the dedicated final turn for the existing response validator
 * and usage ledger. Only the internal answer writer receives text deltas. */
export async function collectFinalChatStream(response: Response, onText: (delta: string) => Promise<void>) {
  if (!response.body) throw incomplete();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', done = false, finish: unknown, usage: unknown;
  let model: unknown, id: unknown, reasoning = false;
  try {
    while (!done) {
      const part = await reader.read().catch(() => { throw incomplete(); });
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length > 128_000) throw incomplete();
      let boundary = /\r?\n\r?\n/u.exec(buffer);
      while (boundary) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/u).flatMap(line => line.startsWith('data:') ? [line.slice(5).trimStart()] : []).join('\n');
        if (data === '[DONE]') { done = true; break; }
        if (data) {
          let packet: Record<string, unknown>;
          try { packet = asObject(JSON.parse(data)); } catch { throw incomplete(); }
          if (packet.error || !Array.isArray(packet.choices) || packet.choices.length > 1) throw incomplete();
          model = packet.model ?? model;
          id = packet.id ?? id;
          usage = packet.usage ?? usage;
          const choice = asObject(packet.choices[0]), delta = asObject(choice.delta);
          if (choice.index !== undefined && choice.index !== 0 || delta.tool_calls || delta.function_call) throw incomplete();
          reasoning ||= typeof delta.reasoning_content === 'string' && !!delta.reasoning_content;
          if (typeof delta.content === 'string' && delta.content) {
            if (finish || content.length + delta.content.length > 16_000) throw incomplete();
            content += delta.content;
            await onText(delta.content);
          }
          finish = choice.finish_reason ?? finish;
        }
        boundary = /\r?\n\r?\n/u.exec(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!done || finish !== 'stop') throw incomplete();
  return { id, model, usage, choices: [{ finish_reason: finish, message: {
    role: 'assistant', content, ...(reasoning ? { reasoning_content: 'present' } : {}),
  } }] };
}
