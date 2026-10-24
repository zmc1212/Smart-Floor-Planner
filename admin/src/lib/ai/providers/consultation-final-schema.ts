import type { ModelTurnInput } from '@/lib/assistant/contracts/model';
import { consultationLongProfile } from '@/lib/assistant/contracts/consultation';

export const consultationFinalSchemaProtocol = 'qwen37-final-json-schema-v1';

/** Wire-only provider subset. Qwen rejects uniqueItems in strict JSON Schema;
 * the existing local repair/catalog validators still enforce uniqueness. The
 * authoritative tool schema and its citation/baseHash constraints stay intact. */
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key,item]) => key !== 'uniqueItems' || typeof item !== 'boolean')
    .map(([key,item]) => [key,providerSchema(item)]));
}

/** Only the already server-bound Qwen long profile and final-only dispatch.
 * Business tools retain function calling. This selects one output channel,
 * without another request, parser coercion, retry or provider fallback. */
export function consultationFinalSchema(input: ModelTurnInput) {
  if (input.profile !== consultationLongProfile.id || input.model !== consultationLongProfile.model
    || input.enableThinking !== false || input.requireTool !== true || input.tools.length !== 1
    || input.tools[0].name !== 'final_response') return null;
  return { type: 'json_schema', json_schema: {
    name: input.tools[0].name, strict: true, schema: providerSchema(input.tools[0].parameters),
  } };
}
