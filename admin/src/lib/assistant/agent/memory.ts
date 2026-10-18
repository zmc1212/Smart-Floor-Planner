import { AssistantError, fail } from '../contracts';
import { referenceOnlyClause } from '../knowledge/reference-intent';

const roomReference = /(?:那|这|另一)(?:一)?间|(?:那|这)个房间|前者|后者|前面(?:说的)?(?:那个|房间)|刚才(?:说的)?(?:那个|房间)/;
/** Shared production/evaluation feedback: an unresolved reference is not a global fact. */
export function needWriteFeedback(error: unknown, sourceText: string) {
  if (!(error instanceof AssistantError) || !['invalid_message','need_source_mismatch','need_room_ambiguous'].includes(error.code)) return null;
  return { status: 'not_saved', error: error.code, sourceText, instructions: error.code === 'need_room_ambiguous'
    ? '房间指代尚未明确，本次没有保存任何需求。请先向客户确认具体房间；本轮不要再调用record_need，不要用空room或代词临时保存，也不能声称已记录。'
    : 'quote和value必须逐字摘自sourceText；room必须在原文出现。请修正参数，不能声称已保存。' };
}

export const factFields = ['housing', 'household', 'style', 'budget', 'timeline', 'daylight', 'desk', 'storage', 'use', 'devices', 'other'] as const;
export type NeedFact = { id: string; room: string; field: typeof factFields[number]; value: string; quote: string; sourceMessageId: string;
  provenance: 'customer_statement'; status: 'current' | 'superseded'; supersedes: string | null; createdAt: string };
export type NeedMemory = { version: number; facts: NeedFact[] };
export type NeedDelta = { room: string; field: NeedFact['field']; value: string; quote: string; sourceMessageId: string; expectedVersion: number };
export function readMemory(entry: unknown): NeedMemory {
  const memory = (entry as { agentMemory?: NeedMemory } | null)?.agentMemory;
  return memory?.facts && Number.isInteger(memory.version) ? memory : { version: 0, facts: [] };
}
export function parseNeedDelta(value: unknown): NeedDelta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const d = value as NeedDelta;
  if (Object.keys(d).some(k => !['room','field','value','quote','sourceMessageId','expectedVersion'].includes(k))
    || !factFields.includes(d.field) || typeof d.room !== 'string' || d.room.length > 40
    || typeof d.value !== 'string' || !d.value.trim() || d.value.length > 400
    || typeof d.quote !== 'string' || !d.quote.trim() || d.quote.length > 1000
    || typeof d.sourceMessageId !== 'string' || !/^[1-9]\d{0,18}$/.test(d.sourceMessageId) || !Number.isInteger(d.expectedVersion) || d.expectedVersion < 0) fail('invalid_message', 422);
  return d;
}
/** No implicit conflict resolution or room migration. Keep each independent room/field and immutable prior assertions. */
export function applyNeedDelta(memory: NeedMemory, delta: NeedDelta, source: { id: string; text: string }, operationId: string, now: string): NeedMemory {
  const existing = memory.facts.find(f => f.id === operationId);
  if (existing) return memory;
  if (memory.version !== delta.expectedVersion) fail('version_conflict');
  if (roomReference.test(delta.room)
    || (!delta.room && roomReference.test(source.text) && !['budget','timeline','household','housing'].includes(delta.field))
    || /先确认(?:一下)?(?:具体)?房间再记录/.test(source.text)) fail('need_room_ambiguous', 422);
  if (source.id !== delta.sourceMessageId || !source.text.includes(delta.quote) || !delta.quote.includes(delta.value)
    || (delta.room && !source.text.includes(delta.room))) fail('need_source_mismatch', 422);
  const clauses = source.text.split(/[，,。；;\n]/).map(c=>c.trim()).filter(c=>c.includes(delta.value));
  if (clauses.length && clauses.every(referenceOnlyClause)) fail('need_source_mismatch',422);
  if (/[？?]|怎么|怎样|如何|是否|要不要|能不能|先聊|讨论|填表|系统提示/.test(delta.value)) fail('need_source_mismatch', 422);
  if (memory.facts.length >= 300) fail('need_memory_limit', 422);
  const prior = memory.facts.find(f => f.status === 'current' && f.room === delta.room && f.field === delta.field);
  return { version: memory.version + 1, facts: [...memory.facts.map(f => f.id === prior?.id ? { ...f, status: 'superseded' as const } : f),
    { id: operationId, room: delta.room, field: delta.field, value: delta.value, quote: delta.quote, sourceMessageId: source.id,
      provenance: 'customer_statement', status: 'current', supersedes: prior?.id ?? null, createdAt: now }] };
}
