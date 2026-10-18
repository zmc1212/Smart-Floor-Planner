import { AssistantError, fail } from '../contracts';
import { referenceOnlyClause } from '../knowledge/reference-intent';

const roomReference = /(?:那|这|另一)(?:一)?间|(?:那|这)个房间|前者|后者|前面(?:说的)?(?:那个|房间)|刚才(?:说的)?(?:那个|房间)/;
/** A direct correction stays actionable when the customer asks a question next.
 * Proposals, reported speech and quoted examples never open a memory write. */
export function hasExplicitNeedCorrection(text: string) {
  if (!/^(?:更正|纠正)(?:一下)?[，,:：\s]/.test(text.trim()) || /不要记录|不用记录|别记录|不要记住/.test(text)) return false;
  const statement = text.trim().split(/[。！？?；;\n]/)[0];
  return /(?:改成|改为|调整为|换成)/.test(statement)
    && !/如果|假如|假设|可能|考虑|是否|是不是|要不要|能不能|可以|不改|[“”「」"]/.test(statement);
}
/** Shared production/evaluation feedback: an unresolved reference is not a global fact. */
export function needWriteFeedback(error: unknown, sourceText: string) {
  if (!(error instanceof AssistantError) || !['invalid_message','need_source_mismatch','need_room_ambiguous'].includes(error.code)) return null;
  return { status: 'not_saved', error: error.code, sourceText, instructions: error.code === 'need_room_ambiguous'
    ? '房间指代尚未明确，本次没有保存任何需求。请先向客户确认具体房间；本轮不要再调用record_need，不要用空room或代词临时保存，也不能声称已记录。'
    : 'quote和value必须逐字摘自sourceText；room必须在原文出现。假设、引用他人说法和待确认建议不能记为客户需求。请修正参数，不能声称已保存。' };
}

export const factFields = ['housing', 'household', 'style', 'budget', 'timeline', 'daylight', 'desk', 'storage', 'use', 'devices', 'other'] as const;
export type NeedFact = { id: string; room: string; field: typeof factFields[number]; value: string; quote: string; sourceMessageId: string;
  provenance: 'customer_statement'; status: 'current' | 'superseded'; supersedes: string | null; createdAt: string };
export type NeedInterpretation = { factId: string; field: 'use'; currentFactId: string | null };
export type NeedMemory = { version: number; facts: NeedFact[]; /** Read projection only; never persisted by applyNeedDelta. */ interpretations?: NeedInterpretation[] };
/** Free-form acknowledgements require a committed operation, including sourced
 * synthesis. Old facts/citations cannot stand in for this run's save receipt. */
export function assertRecordedReply(text: string, memory: NeedMemory, runId: string, otherOperationIds: string[] = []) {
  if (!/(?:已(?:经)?|帮你|帮您)(?:按(?:你|您)的更正)?(?:记下|记住|记录|保存|记为)|已(?:经)?按(?:你|您)的更正更新(?:为|了)?|记下了|记住了|记录好了/.test(text)) return;
  const prefix = runId + ':';
  if (!memory.facts.some(f => f.id.startsWith(prefix)) && !otherOperationIds.some(id => id.startsWith(prefix))) fail('unsupported_model_commitment', 502);
}
export type NeedDelta = { room: string; field: NeedFact['field']; value: string; quote: string; sourceMessageId: string; expectedVersion: number };
export type NeedWrite = Pick<NeedDelta, 'room' | 'field' | 'value' | 'quote'>;
export type NeedQualification = { factId: string; field: 'use'; value: string; sourceMessageId: string };
/** An unavailable correction is not permission to revive occupancy from an
 * older mixed row. This tombstone exposes no unavailable value/message/ID. */
export function needInterpretations(stored: NeedMemory, available: NeedFact[]): NeedInterpretation[] {
  const visible = new Set(available.map(f => f.id));
  return available.flatMap(fact => {
    if (!['desk','other'].includes(fact.field) || !/(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(fact.value)) return [];
    const current = stored.facts.find(next => next.status === 'current' && next.field === 'use' && next.room === fact.room
      && BigInt(next.sourceMessageId) > BigInt(fact.sourceMessageId) && /(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(next.value));
    return current ? [{ factId: fact.id, field: 'use' as const, currentFactId: visible.has(current.id) ? current.id : null }] : [];
  });
}
/** Old desk/other rows sometimes mix location and occupancy. A later explicit
 * occupancy correction qualifies that part only; never rewrite the old quote
 * or discard its independent furniture/location information. Read projection. */
export function needQualifications(fact: NeedFact, current: NeedFact[], originals: Map<string, string>): NeedQualification[] {
  if (!['desk','other'].includes(fact.field) || !/(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(fact.value)) return [];
  return current.filter(next => next.status === 'current' && next.field === 'use' && next.room === fact.room
    && BigInt(next.sourceMessageId) > BigInt(fact.sourceMessageId)
    && /(?:单人|一人|双人|两人|多人).{0,6}(?:办公|使用)/.test(next.value)
    && hasExplicitNeedCorrection(originals.get(next.sourceMessageId) || ''))
    .map(next => ({ factId: next.id, field: 'use' as const, value: next.value, sourceMessageId: next.sourceMessageId }));
}
/** Existing single-write arguments remain valid. A bounded batch is one atomic
 * customer statement operation, never a way to select another source/tenant. */
export function parseNeedWrites(raw: unknown): NeedWrite[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_message', 422);
  const { additionalNeeds, ...first } = raw as NeedWrite & { additionalNeeds?: unknown };
  if (additionalNeeds !== undefined && (!Array.isArray(additionalNeeds) || additionalNeeds.length > 3)) fail('invalid_message', 422);
  const writes = [first, ...((additionalNeeds || []) as NeedWrite[])];
  for (const write of writes) {
    if (!write || typeof write !== 'object' || Array.isArray(write) || Object.keys(write).some(k => !['room','field','value','quote'].includes(k))) fail('invalid_message', 422);
    parseNeedDelta({ ...write, sourceMessageId: '1', expectedVersion: 0 });
  }
  if (new Set(writes.map(w => JSON.stringify([w.room, w.field]))).size !== writes.length) fail('invalid_message', 422);
  return writes;
}
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
function statementContexts(text: string, value: string) {
  const contexts: string[] = [], boundary = /[。！？?；;\n]/;
  for (let from = 0, at = text.indexOf(value); at >= 0; at = text.indexOf(value, from)) {
    let start = at, end = at + value.length;
    while (start > 0 && !boundary.test(text[start - 1])) start--;
    while (end < text.length && !boundary.test(text[end])) end++;
    contexts.push(text.slice(start, end)); from = at + value.length;
  }
  return contexts;
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
  const statements = statementContexts(source.text, delta.value);
  if (/不要记录|不用记录|别记录|不要记住/.test(source.text) || statements.every(c =>
    /如果|假如|假设|先讨论|先聊|(?:图纸|方案).{0,8}(?:写|标|建议)|(?:设计师|师傅|小K|他|她|你).{0,4}(?:说|建议)|只是引用/.test(c))) fail('need_source_mismatch', 422);
  if (/[？?]|怎么|怎样|如何|是否|要不要|能不能|先聊|讨论|填表|系统提示/.test(delta.value)) fail('need_source_mismatch', 422);
  if (memory.facts.length >= 300) fail('need_memory_limit', 422);
  const prior = memory.facts.find(f => f.status === 'current' && f.room === delta.room && f.field === delta.field);
  return { version: memory.version + 1, facts: [...memory.facts.map(f => f.id === prior?.id ? { ...f, status: 'superseded' as const } : f),
    { id: operationId, room: delta.room, field: delta.field, value: delta.value, quote: delta.quote, sourceMessageId: source.id,
      provenance: 'customer_statement', status: 'current', supersedes: prior?.id ?? null, createdAt: now }] };
}
