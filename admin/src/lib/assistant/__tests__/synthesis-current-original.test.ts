import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { resolveSynthesisRepair } from '../agent/synthesis-repair';
import type { ModelMessage } from '../contracts/model';

const question = '更正：书房书桌改为靠内墙；预算改为18万元。另外，如果仍靠窗会有哪些取舍？后面是假设，不要保存。';
const hash = fingerprint({ version: 1, blocks: [{ type: 'text', text: question }] });
const source: SynthesisSource = { sourceId: 'H10165', kind: 'history', title: '本轮已记录需求的客户原话', text: question,
  history: { messageId: '10165', hash, memoryVersion: 7, seq: '4' } };
const context = { currentQuestion: question, currentOriginal: { messageId: '10165', hash } };
const tradeoff = { basis: 'advice', text: '如果仍靠窗，一般要权衡自然光、屏幕反光和收纳；具体布置仍需核对现场。', citations: [] };
const raw = (text = '预算从20万元调整为18万元，建议优先保证基础质量。') => JSON.stringify({ kind: 'synthesis', segments: [tradeoff,
  { basis: 'advice', text, citations: [] }] });

test('v107 saved current original offers one numeric repair without accepting or rewriting the rejected draft', () => {
  const original = raw(), before = JSON.stringify(source), issue = synthesisRepairFeedback(original, [source], context)!;
  assert.equal(issue.code, 'unsupported_model_commitment');
  assert.match(issue.feedback, /currentOriginalNumericPaths|segments\[1\]\.text/);
  assert.ok(issue.feedback.includes(sourceCitationCatalog(source).find(c => c.quote.includes('18'))!.citationId));
  assert.match(issue.feedback, /20|18/); assert.match(issue.feedback, /本轮客户原话|不重新保存|取舍/);
  assert.throws(() => parseSynthesis(original, [source], context), /unsupported_model_commitment/);
  assert.equal(JSON.stringify(source), before); assert.equal(original, raw());
});

test('v107 model must explicitly cite the current original or remove the extra unsupported budget paragraph', () => {
  const original = raw(), issue = synthesisRepairFeedback(original, [source], context)!;
  const messages: ModelMessage[] = [{ role: 'assistant', content: original }, { role: 'system', content: [{ type: 'text', text: issue.feedback }] }];
  const citationId = sourceCitationCatalog(source).find(c => c.quote.includes('18'))!.citationId;
  for (const edit of [{ segment: 1, text: '本轮客户原话把预算更正为18万元。', addCitationIds: [citationId] }, { segment: 1, remove: true }]) {
    const fixed = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(original), edits: [edit] }), messages, [source], 1);
    const answer = parseSynthesis(fixed, [source], context);
    assert.deepEqual(answer.segments[0], tradeoff);
    assert.equal(answer.segments.some(s => s.text.includes('20万元')), false);
  }
  assert.throws(() => resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(original), edits: [] }), messages, [source], 1), /invalid_model_answer/);
});

test('v107 numeric recovery requires the exact current message identity, hash and full original text', () => {
  for (const review of [{}, { currentQuestion: question }, { ...context, currentOriginal: { messageId: 'other', hash } },
    { ...context, currentOriginal: { messageId: '10165', hash: 'changed' } }, { ...context, currentQuestion: '另一轮更正预算18万元' }]) {
    assert.throws(() => synthesisRepairFeedback(raw(), [source], review), /unsupported_model_commitment/);
  }
  for (const changed of [{ ...source, kind: 'project' as const }, { ...source, sourceId: 'Hother' }, { ...source, history: undefined },
    { ...source, history: { ...source.history!, hash: 'changed' } }]) {
    assert.throws(() => synthesisRepairFeedback(raw(), [changed], context), /unsupported_model_commitment/);
  }
});

test('v107 unrelated quantities and positive commitments cannot enter current-original numeric recovery', () => {
  for (const text of ['建议预算控制在30万元。', '预算为18万元，我已联系设计师。', '预算为18万元，已经正式验收。']) {
    assert.throws(() => synthesisRepairFeedback(raw(text), [source], context), /unsupported_model_commitment/);
  }
  const extra = JSON.parse(raw()); extra.segments.push({ basis: 'advice', text: '建议安排30天。', citations: [] });
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(extra), [source], context), /unsupported_model_commitment/);
});

test('v107 an unknown selected source is never replaced by a current-original candidate', () => {
  const answer = JSON.parse(raw()); answer.segments[1].citations = [{ citationId: 'unknown' }];
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(answer), [source], context), /invalid_model_citation/);
});
