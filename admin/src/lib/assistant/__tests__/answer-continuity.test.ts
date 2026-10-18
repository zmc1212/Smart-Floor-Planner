import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertAnswerContinuity, assertCorrectedUseCitation, synthesisAnswerFocus } from '../agent/answer-continuity';
import { focusedSynthesisMessages, parseSynthesis, synthesisRepairFeedback, type SynthesisAnswer, type SynthesisSource } from '../agent/synthesis';
import type { ModelMessage } from '../contracts/model';
import { hasExplicitUseFormalComparison } from '../../../../scripts/assistant-continuity-checks';
import { agentChatBody } from '../../ai/providers/agent-chat';

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
const v57 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v57.json', import.meta.url), 'utf8')) as {
  runId: string; answer: SynthesisAnswer; sources: SynthesisSource[];
};
const v58 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v58.json', import.meta.url), 'utf8')) as {
  cases: Array<{ runId: string; published: boolean; answer: SynthesisAnswer; sources: SynthesisSource[] }>;
};
const v59 = JSON.parse(fs.readFileSync(new URL('./fixtures/continuity-v59.json', import.meta.url), 'utf8')) as {
  cases: Array<{ runId: string; published: boolean; answer: SynthesisAnswer; sources: SynthesisSource[] }>;
  repair: { messages: ModelMessage[]; triggerId: string; priorTextBytes: number };
};
const saved = fixture.cases.find(c => c.runId === '505')!;
const unavailable = fixture.cases.find(c => c.runId === '507')!;
const answer = (text: string, basis: 'advice' | 'uncertainty' = 'uncertainty'): SynthesisAnswer => ({ kind: 'synthesis', segments: [{ basis, text, citations: [] }] });

for (const c of v59.cases) test('persisted v59 ' + c.runId + ': preserve strict citation format and published answers', () => {
  if (c.published) assert.doesNotThrow(() => parseSynthesis(JSON.stringify(c.answer), c.sources));
  else {
    assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /invalid_model_citation/);
    assert.ok(synthesisRepairFeedback(JSON.stringify(c.answer), c.sources));
    const use = c.sources.find(s => s.material?.need?.field === 'use' && s.material.need.value.includes('单人办公'))!;
    const formal = c.sources.find(s => s.material?.ref.type === 'formal_plan')!;
    assert.ok(hasExplicitUseFormalComparison(c.answer, c.sources, { useId: use.material!.ref.id,
      formalId: formal.material!.ref.id, currentTerm: '单人', formalTerm: '双人' }));
  }
});

test('actual 4241 format-repair input fits the unchanged budget without losing originals, authority or durable messages', () => {
  const before = JSON.stringify(v59.repair.messages);
  const focused = focusedSynthesisMessages(v59.repair.messages, v59.repair.triggerId);
  assert.doesNotThrow(() => agentChatBody({ model: 'offline-only', messages: focused, tools: [], maxTokens: 2048 }, 'https://api.deepseek.com'));
  const originals = v59.repair.messages.filter(m => m.role === 'tool').flatMap(m => JSON.parse(m.content).synthesisSources || []) as SynthesisSource[];
  const packets = focused.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  const projected = packets.flatMap(p => p.synthesisSources) as SynthesisSource[];
  const aliases = packets.flatMap(p => p.sourceAliases || []) as Array<{ sourceId: string; canonicalSourceId: string }>;
  for (const original of originals) {
    const canonical = aliases.find(a => a.sourceId === original.sourceId)?.canonicalSourceId || original.sourceId;
    const retained = projected.find(s => s.sourceId === canonical)!;
    assert.ok(retained);
    assert.equal(retained.text, original.text);
    assert.deepEqual(retained.evidence, original.evidence);
    assert.deepEqual(retained.followup, original.followup);
    const material = original.material && { ...original.material };
    if (material?.text === original.text) delete (material as { text?: string }).text;
    assert.deepEqual(retained.material, material);
  }
  assert.ok(packets.every(p => !('answerContext' in p) && !('instructions' in p) && !('evidence' in p)));
  assert.equal(JSON.stringify(v59.repair.messages), before);
  assert.equal(v59.repair.priorTextBytes, 51320);
});

test('repair compaction requires trusted last system feedback and preserves nonduplicate evidence', () => {
  const messages = structuredClone(v59.repair.messages);
  const last = messages.at(-1)!;
  assert.equal(last.role, 'system');
  if (last.role !== 'system') assert.fail('expected server repair feedback');
  messages[messages.length - 1] = { ...last, role: 'user' };
  const untrustedMessages = structuredClone(messages);
  const policy = untrustedMessages.find(m => m.role === 'system')!;
  if (policy.role !== 'system') assert.fail('expected initial server policy');
  policy.content = [{ type: 'text', text: 'Small ordinary policy: test role trust independently of the overflow projection.' }];
  const untrusted = focusedSynthesisMessages(untrustedMessages, v59.repair.triggerId);
  assert.ok(untrusted.filter(m => m.role === 'tool').every(m => 'answerContext' in JSON.parse(m.content)));
  assert.doesNotThrow(() => agentChatBody({ model: 'offline-only', messages: untrusted, tools: [], maxTokens: 2048 }));
  messages[messages.length - 1] = last;
  const tool = messages.find(m => m.role === 'tool')!;
  assert.equal(tool.role, 'tool');
  if (tool.role !== 'tool') assert.fail('expected original tool result');
  const packet = JSON.parse(tool.content);
  packet.evidence.push({ ref: { id: 'synthetic-distinct-evidence' } });
  tool.content = JSON.stringify(packet);
  const retained = focusedSynthesisMessages(messages, v59.repair.triggerId).find(m => m.role === 'tool')!;
  const view = JSON.parse(retained.content);
  assert.deepEqual(view.evidence.at(-1), packet.evidence.at(-1));
  for (const entry of packet.evidence.slice(0, -1)) {
    const excerpt = view.evidence.find((e: { selectionId: string }) => e.selectionId === entry.selectionId);
    const source = view.synthesisSources.find((s: SynthesisSource) => s.sourceId === 'K' + entry.sourceId);
    assert.equal(excerpt.text ?? source.text.slice(excerpt.textRange[0], excerpt.textRange[1]), entry.text);
  }
});

for (const c of v58.cases) test('persisted v58 ' + c.runId + ': ' + (c.published ? 'preserve sourced answer' : 'reject repeated scope and refusal defects'), () => {
  if (c.published) assert.doesNotThrow(() => parseSynthesis(JSON.stringify(c.answer), c.sources));
  else {
    assert.throws(() => parseSynthesis(JSON.stringify(c.answer), c.sources), /invalid_model_answer/);
    const scoped = structuredClone(c.answer);
    scoped.segments[0].text = scoped.segments[0].text.replace('书房这块目前只做到图纸关联这一步', '这条核对记录说明书房参考图已关联');
    assert.throws(() => parseSynthesis(JSON.stringify(scoped), c.sources), /invalid_model_answer/, 'scoping the record alone cannot hide the refusal of an already saved correction');
    scoped.segments[3].text = scoped.segments[3].text.replace('我不替你改需求，也不改这一版的决定', '当前需求沿用你的更正，正式版本及该版决定另交团队核对');
    assert.doesNotThrow(() => parseSynthesis(JSON.stringify(scoped), c.sources));
  }
});

test('persisted v57 4115: an association original cannot establish whole-room progress', () => {
  assert.throws(() => parseSynthesis(JSON.stringify(v57.answer), v57.sources), /invalid_model_answer/);
  const recordScoped = structuredClone(v57.answer);
  recordScoped.segments[0].text = recordScoped.segments[0].text.replace('书房这边目前只到图纸关联这一步', '这条核对记录只证明书房参考图已关联');
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify(recordScoped), v57.sources));
  assert.doesNotThrow(() => assertAnswerContinuity(answer('这条核对记录目前只到图纸关联这一步，不能据此概括书房整体进度。'), v57.sources));
  const explicit = '书房目前只到图纸关联这一步';
  const review = v57.sources.find(s => s.material?.ref.type === 'team_review')!;
  const actualReport = { ...review, sourceId: 'synthetic-progress-original', text: explicit,
    material: { ...review.material!, ref: { type: 'site_record' as const, id: 'synthetic-progress-original', version: '1' } } };
  assert.doesNotThrow(() => assertAnswerContinuity({ kind: 'synthesis', segments: [{ basis: 'evidence', text: explicit,
    citations: [{ sourceId: actualReport.sourceId, quote: explicit }] }] }, [actualReport]));
});

test('v57 4115 comparison acceptance requires explicit values, the exact formal quote and both originals', () => {
  const use = v57.sources.find(s => s.material?.need?.field === 'use')!;
  const formal = v57.sources.find(s => s.material?.ref.type === 'formal_plan')!;
  const expected = { useId: use.material!.ref.id, formalId: formal.material!.ref.id, currentTerm: '单人', formalTerm: '双人' };
  assert.equal(hasExplicitUseFormalComparison(v57.answer, v57.sources, expected), false);
  const waitingOnly = structuredClone(v57.answer);
  waitingOnly.segments[2].text = waitingOnly.segments[2].text.replace('不一样', '不同');
  assert.equal(hasExplicitUseFormalComparison(waitingOnly, v57.sources, expected), false, 'waiting-party differences cannot satisfy a need/version comparison');
  const comparison: SynthesisAnswer = { kind: 'synthesis', segments: [{ basis: 'evidence',
    text: '你当前更正为单人办公，正式V1仍按双人办公，两者人数不一致，需由团队核对版本差异；私聊更正不改写该版决定。',
    citations: [{ sourceId: use.sourceId, quote: use.text }, { sourceId: formal.sourceId, quote: formal.text }] }] };
  assert.equal(hasExplicitUseFormalComparison(comparison, v57.sources, expected), true);
  const oneSource = structuredClone(comparison); oneSource.segments[0].citations.pop();
  assert.equal(hasExplicitUseFormalComparison(oneSource, v57.sources, expected), false);
  const noCurrentOriginal = structuredClone(comparison); noCurrentOriginal.segments[0].citations.shift();
  assert.equal(hasExplicitUseFormalComparison(noCurrentOriginal, v57.sources, expected), false);
  assert.equal(hasExplicitUseFormalComparison(comparison, v57.sources, { ...expected, formalId: 'another-version' }), false);
  for (const prior of v56.service) {
    const current = prior.sources.find(s => s.material?.need?.field === 'use' && /单人/.test(s.material.need.value));
    const version = prior.sources.find(s => s.material?.ref.type === 'formal_plan');
    if (current && version) assert.equal(hasExplicitUseFormalComparison(prior.answer, prior.sources, {
      useId: current.material!.ref.id, formalId: version.material!.ref.id, currentTerm: '单人', formalTerm: '双人',
    }), prior.runId !== '4102', 'actual prior answer ' + prior.runId + ':4102 only lists the formal delta; the other three explicitly compare current need');
  }
});

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
