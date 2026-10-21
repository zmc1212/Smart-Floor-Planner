import { fail, fingerprint } from '../contracts';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { resolveCatalogCitation } from './citation-catalog';
import type { SynthesisSource } from './synthesis';

export const synthesisRepairProtocol = 'synthesis-edit-v1';
export const finalAnswerRepairProtocol = 'final-answer-repair-v2';
export type FinalAnswerRepairScope = 'current_budget_available' | 'current_budget_unavailable';
const finalRepairPrefix = '最终校验修复绑定：';
const prefix = '\n有界编辑协议：';
const suffix = '\n仅返回synthesis_repair及匹配的baseHash。edits按原segments下标独立定位，每段最多一项；text/basis仅改指定字段，addCitationIds/removeCitationIds明确增删已有引用，未提及的正文和引用保留。remove=true删除该段且不能带其他修改；append仅新增必要段。不能整体替换citations，不自动采用任何候选。最终完整回答仍须通过全部来源、数值、承诺与范围校验，原六段/每段四引用/唯一修复和调用预算保持。';
type Draft = { kind: 'synthesis'; segments: Array<{ basis: 'evidence' | 'advice' | 'uncertainty'; text: string; citations: Array<{ citationId: string }> }> };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

/** Application control for the existing one final repair, including ordinary
 * and legacy replies. It supplies no answer, source or edit selection. */
export function finalAnswerRepairControl(raw: string, responseScope?: FinalAnswerRepairScope) {
  return { type: 'text' as const, text: finalRepairPrefix + JSON.stringify({ protocol: finalAnswerRepairProtocol, baseHash: fingerprint(raw), ...(responseScope ? { responseScope } : {}) }) };
}
export function finalAnswerRepairBase(messages: ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const control = messages[index], previous = messages[index - 1];
    if (control.role !== 'system' || previous?.role !== 'assistant' || previous.toolCalls?.length) continue;
    for (const part of control.content) {
      if (part.type !== 'text' || !part.text.startsWith(finalRepairPrefix)) continue;
      try {
        const value: unknown = JSON.parse(part.text.slice(finalRepairPrefix.length));
        if (!object(value) || !keys(value, ['protocol', 'baseHash', 'responseScope'])
          || ![finalAnswerRepairProtocol, 'final-answer-repair-v1'].includes(String(value.protocol))
          || value.baseHash !== fingerprint(previous.content)) continue;
        if (Object.hasOwn(value,'responseScope') && (value.protocol !== finalAnswerRepairProtocol
          || !['current_budget_available','current_budget_unavailable'].includes(String(value.responseScope)))) continue;
        return { raw: previous.content, baseHash: value.baseHash as string, responseScope: value.responseScope as FinalAnswerRepairScope | undefined };
      } catch { /* Unrecognized controls never authorize a repair projection. */ }
    }
  }
  return null;
}

/** Only catalog drafts use edits. Legacy quote repairs retain their wire
 * contract. This checks shape, not support for the rejected draft's claims. */
function draft(raw: string): Draft | null {
  try {
    const value = JSON.parse(raw);
    if (!object(value) || !keys(value, ['kind', 'segments']) || value.kind !== 'synthesis'
      || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 6) return null;
    for (const segment of value.segments) {
      if (!object(segment) || !keys(segment, ['basis', 'text', 'citations']) || !['evidence', 'advice', 'uncertainty'].includes(String(segment.basis))
        || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 1200
        || !Array.isArray(segment.citations) || segment.citations.length > 4
        || segment.citations.some(c => !object(c) || !keys(c, ['citationId']) || typeof c.citationId !== 'string')
        || new Set(segment.citations.map(c => c.citationId)).size !== segment.citations.length) return null;
    }
    return value as Draft;
  } catch { return null; }
}

export function withSynthesisRepairProtocol(issue: { code: string; feedback: string } | null, raw: string) {
  if (!issue || !draft(raw)) return issue;
  return { ...issue, feedback: issue.feedback + prefix + JSON.stringify({ protocol: synthesisRepairProtocol, baseHash: fingerprint(raw) }) + suffix };
}

/** The envelope must be an application control immediately after the rejected
 * assistant output. User/tool copies cannot authorize editing or pick a base. */
export function synthesisRepairBase(messages: ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const control = messages[index];
    if (control.role !== 'system') continue;
    for (const part of control.content) {
      if (part.type !== 'text' || !part.text.endsWith(suffix)) continue;
      const start = part.text.lastIndexOf(prefix);
      if (start < 0) continue;
      let envelope: unknown;
      try { envelope = JSON.parse(part.text.slice(start + prefix.length, -suffix.length)); } catch { continue; }
      const previous = messages[index - 1];
      if (!object(envelope) || !keys(envelope, ['protocol', 'baseHash']) || envelope.protocol !== synthesisRepairProtocol
        || previous?.role !== 'assistant' || previous.toolCalls?.length || envelope.baseHash !== fingerprint(previous.content)) continue;
      const original = draft(previous.content);
      if (original) return { raw: previous.content, original, baseHash: envelope.baseHash as string };
    }
  }
  return null;
}

/** A repair-only final tool, using the already authorized current catalog.
 * It adds no tool execution or model turn and exposes no new source. */
export function synthesisRepairTool(messages: ModelMessage[], citationIds: string[]): ModelTool | null {
  const base = synthesisRepairBase(messages);
  if (!base) return null;
  const id = { type: 'string', enum: citationIds }, basis = { type: 'string', enum: ['evidence', 'advice', 'uncertainty'] };
  return { name: 'final_response', description: '对上一份被拒绝回答作唯一一次有界编辑；未改字段保留，完整结果由原服务端重新校验。', parameters: {
    type: 'object', additionalProperties: false, required: ['kind', 'baseHash', 'edits'], properties: {
      kind: { type: 'string', enum: ['synthesis_repair'] }, baseHash: { type: 'string', enum: [base.baseHash] },
      edits: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['segment'], minProperties: 2, properties: {
        segment: { type: 'integer', minimum: 0, maximum: base.original.segments.length - 1 },
        text: { type: 'string', minLength: 1, maxLength: 1200 }, basis,
        addCitationIds: { type: 'array', maxItems: 4, uniqueItems: true, items: id },
        removeCitationIds: { type: 'array', maxItems: 4, uniqueItems: true, items: id }, remove: { type: 'boolean', enum: [true] },
      } } },
      append: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['basis', 'text', 'citations'], properties: {
        basis, text: { type: 'string', minLength: 1, maxLength: 1200 },
        citations: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['citationId'], properties: { citationId: id } } },
      } } },
    },
  } };
}

/** Materialize explicit edits only. Never union suggestions or select evidence
 * for the model. The caller revalidates the COMPLETE answer before persisting
 * delivery; provider steps retain the original edit response for audit/replay. */
export function resolveSynthesisRepair(raw: string, messages: ModelMessage[], sources: SynthesisSource[], repairs: number) {
  if (Buffer.byteLength(raw) > 24000) fail('invalid_model_answer', 502);
  let value: unknown; try { value = JSON.parse(raw); } catch { return raw; }
  const base = synthesisRepairBase(messages);
  if (!object(value) || value.kind !== 'synthesis_repair') {
    if (base && repairs === 1) fail('invalid_model_answer', 502);
    return raw;
  }
  if (repairs !== 1 || !base || !keys(value, ['kind', 'baseHash', 'edits', 'append']) || value.baseHash !== base.baseHash
    || !Array.isArray(value.edits) || value.edits.length > 6 || (value.append !== undefined && (!Array.isArray(value.append) || value.append.length > 6))) fail('invalid_model_answer', 502);
  const result = structuredClone(base.original), edited = new Set<number>(), removed = new Set<number>();
  const ids = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.length > 4 || input.some(id => typeof id !== 'string') || new Set(input).size !== input.length) fail('invalid_model_citation', 502);
    for (const citationId of input) resolveCatalogCitation({ citationId }, sources);
    return input;
  };
  for (const segment of result.segments) for (const citation of segment.citations) resolveCatalogCitation(citation, sources);
  for (const edit of value.edits) {
    if (!object(edit) || !keys(edit, ['segment', 'text', 'basis', 'addCitationIds', 'removeCitationIds', 'remove'])
      || !Number.isInteger(edit.segment) || Number(edit.segment) < 0 || Number(edit.segment) >= result.segments.length
      || edited.has(Number(edit.segment)) || Object.keys(edit).length < 2) fail('invalid_model_answer', 502);
    const index = Number(edit.segment), segment = result.segments[index]; edited.add(index);
    if (Object.hasOwn(edit, 'remove')) {
      if (edit.remove !== true || Object.keys(edit).length !== 2) fail('invalid_model_answer', 502);
      removed.add(index); continue;
    }
    if (Object.hasOwn(edit, 'text')) {
      if (typeof edit.text !== 'string' || !edit.text.trim() || edit.text.length > 1200) fail('invalid_model_answer', 502);
      segment.text = edit.text;
    }
    if (Object.hasOwn(edit, 'basis')) {
      if (!['evidence', 'advice', 'uncertainty'].includes(String(edit.basis))) fail('invalid_model_answer', 502);
      segment.basis = edit.basis as Draft['segments'][number]['basis'];
    }
    const add = Object.hasOwn(edit, 'addCitationIds') ? ids(edit.addCitationIds) : [];
    const remove = Object.hasOwn(edit, 'removeCitationIds') ? ids(edit.removeCitationIds) : [];
    if (add.some(id => remove.includes(id) || segment.citations.some(c => c.citationId === id))
      || remove.some(id => !segment.citations.some(c => c.citationId === id))) fail('invalid_model_citation', 502);
    segment.citations = [...segment.citations.filter(c => !remove.includes(c.citationId)), ...add.map(citationId => ({ citationId }))];
  }
  result.segments = result.segments.filter((_, index) => !removed.has(index));
  for (const segment of value.append || []) {
    const parsed = draft(JSON.stringify({ kind: 'synthesis', segments: [segment] }));
    if (!parsed) fail('invalid_model_answer', 502);
    for (const citation of parsed.segments[0].citations) resolveCatalogCitation(citation, sources);
    result.segments.push(parsed.segments[0]);
  }
  const output = JSON.stringify(result);
  if ((!value.edits.length && !value.append?.length) || !draft(output) || Buffer.byteLength(output) > 24000) fail('invalid_model_answer', 502);
  return output;
}
