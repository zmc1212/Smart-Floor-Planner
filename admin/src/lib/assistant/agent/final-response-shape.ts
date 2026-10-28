import type { ModelTool } from '../contracts/model';
import { toolSchemaIssue } from './tool-protocol';

export const finalResponseShapeProtocol = 'tagged-final-fields-v1';
const fields: Record<string, { required: string[]; properties: Record<string, unknown> }> = {
  general: { required: ['kind', 'text'], properties: { text: { type: 'string' } } },
  vision: { required: ['kind', 'text'], properties: { text: { type: 'string' } } },
  unavailable: { required: ['kind', 'text'], properties: { text: { type: 'string' } } },
  business: { required: ['kind', 'resultKey'], properties: { resultKey: { type: 'string' } } },
  references: { required: ['kind', 'resultKey'], properties: { resultKey: { type: 'string' } } },
  designers: { required: ['kind', 'resultKey'], properties: { resultKey: { type: 'string' }, text: { type: 'string' } } },
  knowledge: { required: ['kind', 'selections'], properties: { selections: { type: 'array', items: { type: 'string' } } } },
  // Citation/segment semantics still belong to the existing synthesis parser.
  synthesis: { required: ['kind', 'segments'], properties: { segments: { type: 'array' } } },
};
/** Recover a format error through the existing single final-validation budget.
 * Never delete a provider field, coerce a value or dispatch a business tool. */
export async function finalResponseShapeIssue(raw: string) {
  let kind: string | undefined;
  try { const value = JSON.parse(raw); if (value && !Array.isArray(value) && typeof value.kind === 'string') kind = value.kind; } catch { /* Native validator returns the syntax/type diagnostic. */ }
  const shape = kind && fields[kind];
  // Specialized review/repair protocols and malformed/unknown kinds retain
  // their existing decoder and rejection path.
  if (!shape) return null;
  // The synthesis decoder already rejects extra root fields. Legacy result
  // wrappers leave unused fields to their original decoder; business output
  // still comes solely from the authorized service snapshot, never those fields.
  const definition: ModelTool = { name: 'final_response', description: 'Validate only final-response fields, without business effects.', parameters:
    { type: 'object', required: shape.required, properties: { kind: { type: 'string', enum: [kind] }, ...shape.properties }, additionalProperties: kind !== 'synthesis' } };
  if (!await toolSchemaIssue(definition, raw)) return null;
  return { code: 'invalid_model_answer', feedback: JSON.stringify({ status: 'invalid_final_fields', protocol: finalResponseShapeProtocol,
    kind, allowedFields: ['kind', ...Object.keys(shape.properties)], requiredFields: shape.required,
    instruction: '上一最终回复的字段不符合其kind。沿本轮已查询来源修复最终格式，不新增事实或引用，不调用查询、保存或其他业务工具。synthesis只含kind和segments；business/references使用resultKey；不要混合不同kind的字段。已有正文、条件和否定须保留。仅沿原一次最终校验恢复预算。' }) };
}
