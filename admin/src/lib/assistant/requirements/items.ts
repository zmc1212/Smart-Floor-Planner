import { createHash } from 'node:crypto';
import { fail } from '../contracts';
import { allRequirementKeys, type DraftRequirements, type RequirementKey } from './contract';

export type CustomerSource = { id: string; text: string };
export type RequirementItem = { id: string; field: RequirementKey; text: string; sourceMessageId: string };
export type RequirementChange = { operation: 'add' | 'replace' | 'remove'; targetId?: string; sourceId?: string; field?: RequirementKey };
export type RequirementProposal = { sourceSeq: string; fields: unknown }
  | { sourceSeq: string; baseSummaryId: string | null; changes: unknown };
const itemId = (field: string, source: string, text: string) => 'r' + createHash('sha256').update(JSON.stringify([field, source, text])).digest('hex').slice(0, 16);

/** References are host-created, scoped customer clauses, never model-generated quotes.
 * Punctuation determines independent storage units; it does not classify intent.
 */
export function requirementSources(messages: CustomerSource[]) {
  const result = messages.flatMap(message => message.text.split(/[,，。！？!?;；\n]+/u).map(text => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: `c${message.id}.${index}`, sourceMessageId: message.id, text })));
  if (result.length > 800 || result.some(s => Array.from(s.text).length > 1000)) fail('requirements_history_too_long', 422);
  return result;
}

/** Legacy fields are read as independent clauses without rewriting old records. */
export function requirementItems(messages: CustomerSource[], fields: unknown): RequirementItem[] {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const result: RequirementItem[] = [];
  for (const field of allRequirementKeys) {
    const value = (fields as Record<string, { text?: string; sourceMessageId?: string; items?: RequirementItem[] }>)[field];
    if (!value?.text) continue;
    const items = value.items ?? value.text.split(/[,，。！？!?;；\n]+/u).map(t => t.trim()).filter(Boolean)
      .map(text => ({ id: itemId(field, value.sourceMessageId || '', text), field, text, sourceMessageId: value.sourceMessageId || '' }));
    if (!Array.isArray(items)) fail('invalid_requirement_evidence', 422);
    for (const item of items) {
      const source = messages.find(m => m.id === item.sourceMessageId);
      if (item.field !== field || !source || typeof item.text !== 'string' || !item.text.trim()
        || !source.text.includes(item.text) || item.id !== itemId(field, item.sourceMessageId, item.text)) fail('invalid_requirement_evidence', 422);
      if (!result.some(r => r.id === item.id)) result.push(item);
    }
  }
  return result;
}

/** Every edit names one item. Other items in the SAME field survive by construction. */
export function applyRequirementChanges(messages: CustomerSource[], previous: unknown, value: unknown): DraftRequirements {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail('invalid_requirement_changes', 422);
  const sources = requirementSources(messages), items = requirementItems(messages, previous), touched = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(k => !['operation', 'targetId', 'sourceId', 'field'].includes(k))) fail('invalid_requirement_changes', 422);
    const change = raw as RequirementChange;
    if (!['add', 'replace', 'remove'].includes(change.operation)) fail('invalid_requirement_changes', 422);
    const index = typeof change.targetId === 'string' ? items.findIndex(i => i.id === change.targetId) : -1;
    if (change.operation === 'add' ? change.targetId !== undefined : index < 0 || touched.has(change.targetId!)) fail('requirement_target_changed', 409);
    if (change.operation !== 'add') touched.add(change.targetId!);
    if (change.operation === 'remove') {
      if (change.sourceId !== undefined || change.field !== undefined) fail('invalid_requirement_changes', 422);
      items.splice(index, 1); continue;
    }
    const source = sources.find(s => s.id === change.sourceId);
    const field = change.operation === 'replace' ? items[index].field : change.field;
    if (!source || !field || !allRequirementKeys.includes(field) || (change.operation === 'replace' && change.field !== undefined && change.field !== field)) fail('invalid_requirement_evidence', 422);
    const item = { id: itemId(field, source.sourceMessageId, source.text), field, text: source.text, sourceMessageId: source.sourceMessageId };
    if (items.some((i, n) => n !== index && i.id === item.id)) fail('duplicate_requirement_item', 422);
    if (change.operation === 'add') items.push(item); else items[index] = item;
  }
  if (items.length > 40) fail('requirements_too_large', 422);
  const fields = {} as DraftRequirements;
  for (const key of allRequirementKeys) fields[key] = { text: '', sourceMessageId: null, truncated: false, items: [] };
  for (const field of allRequirementKeys) {
    const group = items.filter(i => i.field === field); if (!group.length) continue;
    const text = group.map(i => i.text).join('；');
    if (Array.from(text).length > 1000) fail('requirements_too_large', 422);
    fields[field] = { text, sourceMessageId: group.every(i => i.sourceMessageId === group[0].sourceMessageId) ? group[0].sourceMessageId : null,
      truncated: false, items: group };
  }
  return fields;
}
