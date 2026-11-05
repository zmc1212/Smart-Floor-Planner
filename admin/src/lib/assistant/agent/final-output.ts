import type { ModelTurnOutput } from '../contracts/model';

export const ownerCitationCarrierProtocol = 'owner-citation-carrier-v1';

/** Retain the exact selections. The normal parser still has to resolve every
 * ID against this run's catalog and validate the answer before saving. */
function projectOwnerCitationCarrier(raw: string): string {
  let reply: { kind?: unknown; segments?: Array<{ citations?: unknown[] }> } | null;
  try { reply = JSON.parse(raw); } catch { return raw; }
  if (reply?.kind !== 'synthesis' || !Array.isArray(reply.segments)) return raw;
  let changed = false;
  for (const segment of reply.segments) {
    if (!Array.isArray(segment?.citations) || !segment.citations.some(citation => typeof citation === 'string')) continue;
    segment.citations = segment.citations.map(citation => typeof citation === 'string' ? { citationId: citation } : citation);
    changed = true;
  }
  return changed ? JSON.stringify(reply) : raw;
}

/** Final selection is a projection; the durable packet keeps all original calls. */
export function projectFinalToolOutput(output: ModelTurnOutput, ownerCitationCarrier = false): ModelTurnOutput {
  const finals = output.toolCalls.filter(call => call.name === 'final_response');
  if (!finals.length) return output;
  if (finals.length === 1 && output.toolCalls.length === 1) return {
    ...output, text: ownerCitationCarrier ? projectOwnerCitationCarrier(finals[0].arguments) : finals[0].arguments, toolCalls: [],
  };
  return { ...output, text: '', toolCalls: output.toolCalls.filter(call => call.name !== 'final_response'),
    toolProtocolFeedback: { code: 'mixed_final_response', text: '本轮final_response与其他调用或多个收尾同时出现，提前回答未交付。已执行工具仅以真实结果为准；先读取本轮结果，之后单独提交一次final_response，不重放保存或业务动作，不根据提前回答补造事实。仍限原四轮预算。' } };
}
