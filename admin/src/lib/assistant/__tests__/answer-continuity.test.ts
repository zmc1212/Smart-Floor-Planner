import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertAnswerContinuity, assertCorrectedUseCitation, synthesisAnswerFocus } from '../agent/answer-continuity';
import { focusedSynthesisMessages, parseSynthesis, synthesisRepairFeedback, type SynthesisAnswer, type SynthesisSource } from '../agent/synthesis';
import type { ModelMessage } from '../contracts/model';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v51.json', import.meta.url), 'utf8')) as {
  cases: Array<{ runId: string; label: string; native: boolean; answer: SynthesisAnswer; sources: SynthesisSource[]; expectedFailure: boolean }>;
};
const v52 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v52.json', import.meta.url), 'utf8')) as {
  cases: Array<{ runId: string; finding: string; answer: SynthesisAnswer; sources: SynthesisSource[] }>;
};
const v53 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v53.json', import.meta.url), 'utf8')) as { answer: SynthesisAnswer; sources: SynthesisSource[] };
const v54 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v54.json', import.meta.url), 'utf8')) as { answer: SynthesisAnswer; sources: SynthesisSource[] };
const v55 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v55.json', import.meta.url), 'utf8')) as { answer: SynthesisAnswer; sources: SynthesisSource[] };
const v56 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v56.json', import.meta.url), 'utf8')) as {
  native: { answer: SynthesisAnswer; sources: SynthesisSource[] };
  service: Array<{ runId: string; answer: SynthesisAnswer; sources: SynthesisSource[] }>;
};
const saved = fixture.cases.find(c => c.runId === '505')!;
const unavailable = fixture.cases.find(c => c.runId === '507')!;
const answer = (text: string, basis: 'advice' | 'uncertainty' = 'uncertainty'): SynthesisAnswer => ({ kind: 'synthesis', segments: [{ basis, text, citations: [] }] });

for (const c of fixture.cases) test(`persisted v51 ${c.native ? 'native' : 'service'} ${c.runId} ${c.label}: ${c.expectedFailure ? 'reject observed defect' : 'preserve admissible answer'}`, () => {
  if (c.expectedFailure) assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /invalid_model_answer/);
  else assert.doesNotThrow(() => parseSynthesis(JSON.stringify(c.answer), c.sources));
});
for (const c of v52.cases) test(`persisted v52 ${c.runId}: reject observed ${c.finding}`, () => {
  assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /invalid_model_answer/);
});
test('persisted v53 4075: reject unscoped coordinate readiness, without mistaking its factual acknowledgement for a request', () => {
  const acknowledgement = '书房这边沿用你此前明确的需求：偶尔双人办公，使用电脑和台灯，书桌靠窗。';
  assert.doesNotThrow(() => assertAnswerContinuity(answer(acknowledgement), v53.sources));
  assert.throws(() => parseSynthesis(JSON.stringify(v53.answer), v53.sources), /invalid_model_answer/);
  assert.throws(() => assertAnswerContinuity(answer('家具实际尺寸和现场点位坐标还没落到可执行的程度。'), v53.sources), /invalid_model_answer/);
  assert.doesNotThrow(() => assertAnswerContinuity(answer('本轮可用资料未提供现场尺寸或坐标，本次不能据此定点。'), v53.sources));
});

test('persisted v54 4083: issue and formal citations cannot replace the current private use original', () => {
  assert.throws(() => parseSynthesis(JSON.stringify(v54.answer), v54.sources), /invalid_model_answer/);
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(v54.answer), v54.sources), /invalid_model_answer/);
  const corrected = structuredClone(v54.answer), source = v54.sources.find(s => s.material?.need?.field === 'use')!;
  corrected.segments[1].citations.push({ sourceId: source.sourceId, quote: source.text });
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(corrected), v54.sources));
  assert.doesNotThrow(() => assertCorrectedUseCitation({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '这件事仍待团队核对。', citations: [] }] }, v54.sources));
});

test('current correction citations accept exact authorized aliases, but another room or an unrelated excerpt cannot stand in', () => {
  const original = v54.sources.find(s => s.material?.need?.field === 'use')!;
  const alias = { ...structuredClone(original), sourceId: 'authorized-current-use-alias' };
  const cited = structuredClone(v54.answer);
  cited.segments[1].citations.push({ sourceId: alias.sourceId, quote: alias.text });
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(cited), [...v54.sources, alias]));
  alias.material!.roomName = '厨房';
  assert.throws(() => assertCorrectedUseCitation(cited, [...v54.sources, alias]), /invalid_model_answer/);
  const unrelated = structuredClone(v54.answer);
  unrelated.segments[1].citations.push({ sourceId: original.sourceId, quote: '电脑和台灯不变' });
  assert.throws(() => assertCorrectedUseCitation(unrelated, v54.sources), /invalid_model_answer/);
});

test('persisted v55 4095: preserve max4 citation shape rejection without truncation or another repair attempt', () => {
  assert.equal(v55.answer.segments[0].citations.length, 5);
  assert.throws(() => parseSynthesis(JSON.stringify(v55.answer), v55.sources), /invalid_model_answer/);
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(v55.answer), v55.sources), /invalid_model_answer/);
});

for (const c of v56.service) test(`completed actual v56 service ${c.runId}: final parser preserves its original answer`, () => {
  assert.deepEqual(parseSynthesis(JSON.stringify(c.answer), c.sources), c.answer);
});

test('actual native v56 4109: adjacent exact same-source quotes preserve all support in four canonical citations', () => {
  const before = JSON.stringify(v56.native), parsed = parseSynthesis(JSON.stringify(v56.native.answer), v56.native.sources);
  assert.equal(parsed.segments[0].citations.length, 4);
  assert.equal(JSON.stringify(v56.native), before);
  assert.deepEqual(parsed.segments.map(s => s.text), v56.native.answer.segments.map(s => s.text.replace('不等于现场点位已经落实', '不能据此确认处理结果')));
  for (const c of v56.native.answer.segments[0].citations)
    assert.ok(parsed.segments[0].citations.some(p => p.sourceId === c.sourceId && p.quote.includes(c.quote)));
  const numbers = (a: SynthesisAnswer) => [...new Set(a.segments[0].citations.flatMap(c => c.quote.match(/\d+(?:\.\d+)?/g) || []))].sort();
  assert.deepEqual(numbers(parsed), numbers(v56.native.answer));
  assert.equal(synthesisRepairFeedback(JSON.stringify(v56.native.answer), v56.native.sources), null);
  const positive = structuredClone(v56.native.answer);
  positive.segments[1].text += '现场点位已经落实。';
  assert.throws(() => parseSynthesis(JSON.stringify(positive), v56.native.sources), /unsupported_model_commitment/);
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(positive), v56.native.sources), /unsupported_model_commitment/);
});

test('oversized duplicate lists cannot hide bad or foreign quotes, add gap facts, exceed quote length or remove metadata', () => {
  for (const mutate of [
    (a: SynthesisAnswer) => { a.segments[0].citations[0].quote = '并非原文的不存在节选'; },
    (a: SynthesisAnswer) => { a.segments[0].citations[0].sourceId = 'foreign-source'; },
    (a: SynthesisAnswer) => { Object.assign(a.segments[0].citations[0], { hidden: 'must-not-drop' }); },
  ]) {
    const a = structuredClone(v56.native.answer); mutate(a);
    assert.throws(() => parseSynthesis(JSON.stringify(a), v56.native.sources), /invalid_model_answer/);
  }
  for (const gap of ['未被原引用覆盖的500元条件', ' '.repeat(450)]) {
    const sources = structuredClone(v56.native.sources), a = structuredClone(v56.native.answer);
    const c = a.segments[0].citations[0], next = a.segments[0].citations[1], source = sources.find(s => s.sourceId === c.sourceId)!;
    source.text = c.quote + gap + next.quote;
    assert.throws(() => parseSynthesis(JSON.stringify(a), sources), /invalid_model_answer/);
  }
});

test('current use is derived only from authorized use originals; unavailable correction has no guessed or revived value', () => {
  const known = synthesisAnswerFocus(saved.sources);
  assert.equal(known.currentUses.length, 1);
  assert.equal(known.currentUses[0].status, 'known');
  if (known.currentUses[0].status !== 'known') assert.fail('expected available current use');
  const current = known.currentUses[0];
  const original = saved.sources.find(s => s.sourceId === current.sourceId && s.material?.need?.field === 'use');
  assert.ok(original);
  assert.equal(current.value, original.material!.need!.value);
  assert.match(current.value, /单人办公/);
  assert.equal(current.occupancySpecified, true);
  const unknown = synthesisAnswerFocus(unavailable.sources);
  assert.deepEqual(unknown.currentUses, [{ room: '书房', status: 'unavailable' }]);
  assert.doesNotMatch(JSON.stringify(unknown.currentUses), /单人|双人|sourceId|supersedes/);
  assert.deepEqual(unknown.knowledgeSourceIds, [...new Set(unavailable.sources.filter(s => s.kind === 'knowledge').map(s => s.sourceId))]);
  assert.deepEqual(synthesisAnswerFocus(saved.sources.filter(s => s.material?.ref.type === 'formal_plan')).currentUses, []);
});

test('a known use without an expressed headcount or a different room does not suppress a necessary question', () => {
  const sources = structuredClone(saved.sources);
  for (const s of sources) if (s.material?.need?.field === 'use') s.material.need.value = '书房用于办公';
  assert.equal(synthesisAnswerFocus(sources).currentUses[0].status, 'known');
  assert.doesNotThrow(() => assertAnswerContinuity(answer('你可以补充书房办公人数，便于后续核对用途。'), sources));
  assert.doesNotThrow(() => assertAnswerContinuity(answer('你可以补充厨房办公人数；书房沿用此前更正。'), saved.sources));
});

test('known private correction survives without a fresh save claim or another customer confirmation; team reconciliation remains allowed', () => {
  for (const text of [
    '沿用你此前更正的单人办公，电脑和台灯仍保留；当前正式版本的双人描述需团队核对，不会由这次解释自动改版。',
    '书房按单人办公继续核对；请团队确认单人办公如何对应正式方案的点位。本轮可用资料未提供现场尺寸。',
    '本轮未取得实际量测依据，无法据此判断插座位置；这不影响沿用你此前更正的办公人数。',
    '沿用你此前更正的办公人数，家具实际尺寸可在原聊天继续补充；需要人工时沿原接续流程处理。',
  ]) assert.doesNotThrow(() => assertAnswerContinuity(answer(text), saved.sources));
  assert.throws(() => assertAnswerContinuity(answer('你可以直接在原聊天里补充单人办公的确认信息。'), saved.sources), /invalid_model_answer/);
  assert.throws(() => assertAnswerContinuity(answer('仍需要团队核对，我不替你改需求。'), saved.sources), /invalid_model_answer/);
});

test('query gaps are scoped where stated, and conditional advice does not prescribe an unavailable occupancy', () => {
  for (const text of ['具体安装位置和尺寸还没有可量测依据。后文本轮资料不足。', '所以人数、桌长和插座位置都还不能定。'])
    assert.throws(() => assertAnswerContinuity(answer(text), unavailable.sources), /invalid_model_answer/);
  for (const text of ['本轮可用资料中，具体安装位置和尺寸还没有可量测依据。', '当前可用资料不足以确认办公人数；靠窗意向、电脑和台灯继续沿用。',
    '本轮尚未取得现场坐标，不据此认定现场没有量测。', '具体尺寸仍需团队核对，不代表现场没有记录。'])
    assert.doesNotThrow(() => assertAnswerContinuity(answer(text), unavailable.sources));
  assert.throws(() => assertAnswerContinuity(answer('如果只是偶尔有人一起用，可以按“常用一人、偶尔两人”来预留。', 'advice'), unavailable.sources), /invalid_model_answer/);
  assert.doesNotThrow(() => assertAnswerContinuity(answer('人数明确后再比较办公点位与通道安排。', 'advice'), unavailable.sources));
});

test('reading aid preserves originals and tool pairs and does not authorize semantic repair, foreign citations or positive completion', () => {
  const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: '为什么还要核对？' }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'search_knowledge', arguments: '{}' }] },
    { role: 'tool', callId: 'call', content: JSON.stringify({ synthesisSources: saved.sources }) }];
  const before = JSON.stringify(messages), projected = focusedSynthesisMessages(messages, 'current');
  const tool = projected.find(m => m.role === 'tool')!;
  assert.equal(tool.callId, 'call');
  const packet = JSON.parse(tool.content);
  assert.deepEqual(packet.answerContext, synthesisAnswerFocus(saved.sources));
  assert.equal(packet.synthesisSources[0].text, saved.sources[0].text);
  assert.equal(JSON.stringify(messages), before);
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(saved.answer), saved.sources), /invalid_model_answer/);
  for (const text of ['现场已经落实。', '事项已经正式关闭。']) assert.throws(() => parseSynthesis(JSON.stringify(answer(text)), saved.sources), /unsupported_model_commitment/);
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '当前私聊用途仍沿用。', citations: [{ sourceId: 'foreign', quote: '单人办公' }] }] }), saved.sources), /invalid_model_citation/);
});
