import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assertAnswerContinuity, assertCorrectedUseCitation, synthesisAnswerFocus } from '../agent/answer-continuity';
import { needInterpretations, needQualifications, type NeedFact } from '../agent/memory';
import type { SynthesisAnswer, SynthesisSource } from '../agent/synthesis';

/** Labeled synthetic originals, not new configured-model answers or DB data. */
function syntheticNeedSource(value: string): SynthesisSource {
  const text = '书房' + value + '。', hash = createHash('sha256').update(text).digest('hex');
  return { sourceId: 'synthetic-use', kind: 'project', title: '合成客户原话（书房）', text, citationQuotes: [text], material: {
    ref: { type: 'customer_need', id: 'synthetic:current', version: hash }, hash, leadId: '101', projectId: null,
    roomId: null, roomName: '书房', sourceMessageId: '2', mediaIds: [], audience: 'customer_self', basis: 'owned_conversation',
    status: 'current', text, need: { field: 'use', value, supersedes: 'synthetic:old', authority: 'customer_statement', formalApproval: false },
  } };
}
const reply = (text: string, quote?: string): SynthesisAnswer => ({ kind: 'synthesis', segments: [{ text,
  basis: quote ? 'evidence' : 'uncertainty', citations: quote ? [{ sourceId: 'synthetic-use', quote }] : [] }] });
const old: NeedFact = { id: 'synthetic:old', room: '书房', field: 'desk', value: '双人办公、书桌靠窗', quote: '书房双人办公、书桌靠窗',
  sourceMessageId: '1', provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: '' };
const unknown: NeedFact = { ...old, id: 'synthetic:current', field: 'use', value: '人数未定', quote: '书房办公人数改为人数未定', sourceMessageId: '2' };
const originals = new Map([['2', '更正一下，书房办公人数改为人数未定，桌位和设备不变。']]);

test('negative and provisional headcounts retain literal use without becoming confirmed occupancy', () => {
  for (const value of ['不需要双人办公', '暂定单人办公', '单人办公待确认', '人数未定']) {
    const focus = synthesisAnswerFocus([syntheticNeedSource(value)]).currentUses[0];
    assert.equal(focus.status, 'known');
    if (focus.status !== 'known') assert.fail('the original remains available');
    assert.equal(focus.value, value);
    assert.equal(focus.occupancySpecified, false, value);
  }
});

test('an affirmative contrast requires its own positive original rather than the denied option', () => {
  const source = syntheticNeedSource('不是双人办公，而是单人办公');
  assert.throws(() => assertCorrectedUseCitation(reply('沿用你当前单人办公需求。', '不是双人办公'), [source]), /invalid_model_answer/);
  assert.doesNotThrow(() => assertCorrectedUseCitation(reply('沿用你当前单人办公需求。', '而是单人办公'), [source]));
});

test('uncertain headcounts allow a necessary clarification while retaining the available original', () => {
  for (const value of ['不需要双人办公', '暂定单人办公', '单人办公待确认', '人数未定']) {
    assert.doesNotThrow(() => assertAnswerContinuity(reply('请你确认书房办公人数。'), [syntheticNeedSource(value)]), value);
  }
});

test('affirmed headcounts retain confirmation and provenance fences', () => {
  for (const value of ['单人办公', '偶尔双人办公', '两人使用']) {
    const source = syntheticNeedSource(value), focus = synthesisAnswerFocus([source]).currentUses[0];
    assert.ok(focus.status === 'known' && focus.occupancySpecified);
    assert.throws(() => assertAnswerContinuity(reply('请你确认书房办公人数。'), [source]), /invalid_model_answer/);
    const answer = reply('沿用你此前更正的' + value + '需求。', value);
    assert.doesNotThrow(() => assertCorrectedUseCitation(answer, [source]));
    answer.segments[0].citations[0].sourceId = 'another-source';
    assert.throws(() => assertCorrectedUseCitation(answer, [source]), /invalid_model_answer/);
  }
});

test('explicit unknown use qualifies only old mixed occupancy; revocation leaves a value-free marker', () => {
  const devices: NeedFact = { ...old, id: 'synthetic:devices', field: 'devices', value: '电脑和台灯' };
  const stored = { version: 3, facts: [old, unknown, devices] }, before = structuredClone(stored);
  assert.deepEqual(needInterpretations(stored, stored.facts), [{ factId: old.id, field: 'use', currentFactId: unknown.id }]);
  assert.deepEqual(needQualifications(old, stored.facts, originals), [{ factId: unknown.id, field: 'use', value: '人数未定', sourceMessageId: '2' }]);
  assert.deepEqual(needInterpretations(stored, [old, devices]), [{ factId: old.id, field: 'use', currentFactId: null }]);
  assert.deepEqual(stored, before);
  for (const current of [{ ...unknown, room: '厨房' }, { ...unknown, sourceMessageId: '1' }, { ...unknown, field: 'devices' as const }, { ...unknown, value: '用于办公' }]) {
    assert.deepEqual(needInterpretations({ version: 2, facts: [old, current] }, [old, current]), []);
    assert.deepEqual(needQualifications(old, [old, current], originals), []);
  }
  assert.deepEqual(needInterpretations({ version: 1, facts: [devices, unknown] }, [devices, unknown]), []);
});

test('unknown occupancy does not relax the explicit-correction requirement or furniture boundary', () => {
  assert.deepEqual(needQualifications(old, [old, unknown], new Map([['2', '先讨论书房人数未定，还没有决定怎么改。']])), []);
  assert.deepEqual(needQualifications({ ...old, value: '双人长桌' }, [unknown], originals), []);
  assert.equal(old.value, '双人办公、书桌靠窗');
});
