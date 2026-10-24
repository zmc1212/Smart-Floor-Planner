import { fail } from '../contracts';

export const requirementKeys = ['housing', 'household', 'style', 'budget', 'timeline'] as const;
export const roomRequirementKeys = ['room', 'space', 'usage', 'frequency', 'devices'] as const;
export const allRequirementKeys = [...requirementKeys, ...roomRequirementKeys] as const;
export type RequirementKey = typeof allRequirementKeys[number];
export type ConfirmedRequirements = Record<typeof requirementKeys[number], string> & Partial<Record<typeof roomRequirementKeys[number], string>>;
export type DraftRequirements = Record<RequirementKey, { text: string; sourceMessageId: string | null; truncated: boolean }>;
const terms: Record<typeof requirementKeys[number], RegExp> = {
  housing: /房|户型|平米|平方米|㎡|面积|厨房|卫生间|阳台/,
  household: /居住|住[着了几人]|口人|个人住|人住|孩子|老人|父母|宠物|办公|夫妻|一家|独居/,
  style: /风格|现代|简约|极简|北欧|中式|奶油|原木|法式|日式|美式/,
  budget: /预算|报价|费用|总价|[万元块]|花费/,
  timeline: /时间|入住|开工|完工|工期|明年|今年|明天|个月|半年|年底/,
};

/** Candidate excerpts only. Whole customer clauses retain negation/uncertainty;
 * no inferred amounts, deadlines, household counts or model-generated facts. */
export function excerptRequirements(messages: Array<{ id: string; text: string }>): DraftRequirements {
  const fields = Object.fromEntries(requirementKeys.map(k => [k, { text: '', sourceMessageId: null, truncated: false }])) as DraftRequirements;
  for (const message of messages) {
    for (const clause of message.text.split(/[。！？!?；;\n]+/u).map(s => s.trim()).filter(Boolean)) {
      for (const field of requirementKeys) {
        if (!terms[field].test(clause)) continue;
        const chars = Array.from(clause);
        fields[field] = { text: chars.slice(0, 1000).join(''), sourceMessageId: message.id, truncated: chars.length > 1000 };
      }
    }
  }
  return fields;
}

/** An Agent may select customer excerpts, but cannot invent their text or origin.
 * Tenant/conversation scoping and source sequence locking belong to the service. */
export function evidencedRequirements(messages: Array<{ id: string; text: string }>, value: unknown): DraftRequirements {
  if (!Array.isArray(value) || !value.length || value.length > allRequirementKeys.length) fail('invalid_requirement_evidence', 422);
  const fields = Object.fromEntries(requirementKeys.map(k => [k, { text: '', sourceMessageId: null, truncated: false }])) as DraftRequirements;
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail('invalid_requirement_evidence', 422);
    const { field, text, sourceMessageId } = candidate as Record<string, unknown>;
    if (Object.keys(candidate).some(k => !['field', 'text', 'sourceMessageId'].includes(k))
      || typeof field !== 'string' || !allRequirementKeys.includes(field as RequirementKey) || seen.has(field)
      || typeof text !== 'string' || !text.trim() || Array.from(text).length > 1000
      || typeof sourceMessageId !== 'string') fail('invalid_requirement_evidence', 422);
    const source = messages.find(m => m.id === sourceMessageId);
    if (!source || !source.text.includes(text as string)) fail('invalid_requirement_evidence', 422);
    seen.add(field as string);
    fields[field as RequirementKey] = { text: text as string, sourceMessageId: sourceMessageId as string, truncated: false };
  }
  return fields;
}

export function confirmedRequirements(value: unknown): ConfirmedRequirements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(k => !allRequirementKeys.includes(k as RequirementKey)) || requirementKeys.some(k => !(k in fields))) fail('invalid_message', 422);
  for (const k of Object.keys(fields)) if (typeof fields[k] !== 'string' || Array.from(fields[k] as string).length > 1000) fail('invalid_message', 422);
  const result = Object.fromEntries(Object.keys(fields).map(k => [k, (fields[k] as string).trim()])) as ConfirmedRequirements;
  if (!Object.values(result).some(Boolean)) fail('invalid_message', 422);
  return result;
}
