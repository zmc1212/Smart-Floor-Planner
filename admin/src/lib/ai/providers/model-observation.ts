import { createHash } from 'node:crypto';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function modelPrefixObservation(messages: ModelMessage[], tools: unknown) {
  const prefix: ModelMessage[] = [];
  for (const message of messages) { if (message.role !== 'system') break; prefix.push(message); }
  return { protocol: 'model-prefix-observation-v1', systemPrefixHash: digest(prefix),
    systemPrefixBytes: Buffer.byteLength(JSON.stringify(prefix)), toolSchemaHash: digest(tools) };
}
/** Missing usage is unknown. A zero reported by the provider is a cache miss,
 * rather than proof that this request was free. No tariff discount is guessed. */
export function cacheObservation(usage: ModelTurnOutput['usage']) {
  return { status: usage?.cachedInputTokens === undefined ? 'unavailable' as const
    : usage.cachedInputTokens > 0 ? 'hit' as const : 'miss' as const,
    cachedInputTokens: usage?.cachedInputTokens ?? null, cacheWriteInputTokens: usage?.cacheWriteInputTokens ?? null,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    actualCost: null, costMeasurement: 'unavailable' as const };
}
