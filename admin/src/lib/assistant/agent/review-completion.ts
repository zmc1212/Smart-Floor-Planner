import type { ModelMessage, ModelTool } from '../contracts/model';
import { fail } from '../contracts';
import { finishContextTool, contextReady } from './native-final';
import { reviewTurnMode } from './review-runtime';
import { isNeedInquiry } from './need-write-intent';

export const reviewCompletionProtocol = 'review-completion-v1';
export type ReviewCompletion = { mode: 'receipt_only' | 'answer'; questionSourceIds: string[] };
/** Existing negative write guards apply to individual source clauses only.
 * They never choose the answer or suppress the rest of a mixed user turn. */
export const requirementClauseWritable = (text: string) => reviewTurnMode(text) === 'propose' && !isNeedInquiry(text);
export const reviewCompletionInstructions = '本阶段按整条客户原话规划工具，不生成答复正文或final_response。所需上下文足够后，按finish_context的Schema声明接续方式：客户本轮还有装修问题、解释或咨询要回应时选answer，并列出对应的本轮原话分句ID；只有本轮内容都只需真实需求业务回执时才选receipt_only及空questionSourceIds，由服务端装配真实提案状态，不再生成自由正文。明确更正并另问量房等问题仍是answer，不能把业务回执当作问题答案；金额未定也不阻断其他咨询。';

/** Presentation planning belongs to the same Agent/tool round. IDs identify
 * exact current originals, not keywords, expected answers or save consent. */
export function reviewCompletionTool(sourceIds: string[]): ModelTool {
  if (!sourceIds.length || sourceIds.length > 64 || new Set(sourceIds).size !== sourceIds.length) fail('agent_input_limit', 422);
  const branch = (mode: ReviewCompletion['mode']) => ({ type: 'object', properties: {
    mode: { type: 'string', const: mode },
    questionSourceIds: { type: 'array', items: { type: 'string', enum: sourceIds },
      minItems: mode === 'answer' ? 1 : 0, maxItems: mode === 'answer' ? sourceIds.length : 0 },
  }, required: ['mode', 'questionSourceIds'], additionalProperties: false });
  return { name: finishContextTool.name, description: '结束上下文规划。answer绑定本轮仍需回答的客户分句；receipt_only仅适用于不含其他待答咨询的需求操作回执。两者都不保存或批准业务，不能自行输出完成状态。',
    parameters: { type: 'object', anyOf: [branch('receipt_only'), branch('answer')] } };
}

/** Read only the validated, paired finish call in this graph checkpoint.
 * A review proposal alone never suppresses a customer's independent question. */
export function reviewCompletionPlan(messages: ModelMessage[], sourceIds: string[]): ReviewCompletion | null {
  const last = messages.at(-1), request = messages.at(-2);
  if (last?.role !== 'tool' || last.content !== contextReady || request?.role !== 'assistant' || request.toolCalls?.length !== 1) return null;
  const call = request.toolCalls[0];
  if (call.name !== finishContextTool.name || call.id !== last.callId) return null;
  let value: ReviewCompletion;
  try { value = JSON.parse(call.arguments); } catch { return fail('invalid_model_answer', 502); }
  if (!value || Object.keys(value).some(key => !['mode', 'questionSourceIds'].includes(key))
    || !['receipt_only', 'answer'].includes(value.mode) || !Array.isArray(value.questionSourceIds)
    || value.questionSourceIds.some(id => !sourceIds.includes(id)) || new Set(value.questionSourceIds).size !== value.questionSourceIds.length
    || (value.mode === 'answer' ? !value.questionSourceIds.length : value.questionSourceIds.length > 0)) fail('invalid_model_answer', 502);
  return value;
}
