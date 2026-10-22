import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needDeskPositionFeedback, needInterpretations, type NeedFact, type NeedMemory } from '../agent/memory';

const old: NeedFact = { id: 'old', room: '', field: 'desk', value: '书房书桌靠窗', quote: '请记下：书房书桌靠窗', sourceMessageId: '1',
  provenance: 'customer_statement', status: 'current', supersedes: null, createdAt: '' };
const correction: NeedFact = { ...old, id: 'new', room: '书房', value: '靠内墙', quote: '书房书桌从靠窗改为靠内墙', sourceMessageId: '4' };
const living: NeedFact = { ...old, id: 'living', room: '客厅', field: 'devices', value: '不要投影设备', quote: '客厅不要投影设备', sourceMessageId: '2' };
const stored: NeedMemory = { version: 4, facts: [old, living, correction] };
const available = (facts: NeedFact[]) => ({ ...stored, facts, interpretations: needInterpretations(stored, facts) });
const question = '最开始我对书房和客厅怎么说，后来改了哪一项？只回顾本咨询原话，区分最初说法和当前更正；不要查企业资料或项目，也不要新增保存。';
const feedback = (text: string, memory = available(stored.facts)) => needDeskPositionFeedback(JSON.stringify({ kind: 'general', text }), memory, question);

test('historical sentence headers bind following clauses without converting the original position into a current claim', () => {
  const before = JSON.stringify(stored);
  for (const text of [
    '最开始，您对书房和客厅的说法是：书房书桌靠窗，保留收纳；客厅不要投影设备。后来，您改了书房书桌的位置，从靠窗改为靠内墙。',
    '最初，书房书桌靠窗，保留收纳；客厅不要投影设备。现在书房书桌靠内墙。',
    '当时，书房书桌靠窗。后来书桌从靠窗改为靠内墙。',
    '最开始书房书桌靠窗，现在书房书桌靠内墙。',
  ]) assert.equal(feedback(text), null, text);
  assert.equal(JSON.stringify(stored), before);
});

test('current markers, sentence boundaries and withdrawal still reject revival of an old desk position', () => {
  for (const text of [
    '最初，书房书桌靠窗。现在书房书桌还是靠窗。',
    '最初，书房书桌目前靠窗。',
    '最开始，书房书桌靠窗，后来，书房书桌靠窗。',
    '最初，客厅不要投影设备。书房书桌靠窗。',
    '最初，客厅不要投影设备。\n书房书桌靠窗。',
  ]) assert.ok(feedback(text), text);
  const withdrawn = available([old, living]);
  assert.ok(feedback('最初，书房书桌靠窗；现在仍靠窗。', withdrawn));
  assert.ok(feedback('最初，书房书桌靠内墙。', withdrawn), 'a historical header cannot invent an unavailable original');
  assert.equal(feedback('最初，书房书桌靠窗。当前位置本次无法确认。', withdrawn), null);
});
