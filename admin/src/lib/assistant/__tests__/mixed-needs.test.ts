import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyNeedDelta, hasExplicitNeedCorrection, readMemory, uncoveredNeedStatements, type NeedWrite } from '../agent/memory';

const desk: NeedWrite = { room: '书房', field: 'desk', value: '书桌改为靠内墙', quote: '书房书桌改为靠内墙' };
const budget: NeedWrite = { room: '', field: 'budget', value: '18万元', quote: '预算改为18万元' };
const mixed = '更正：书房书桌改为靠内墙；预算改为18万元。另外，如果仍靠窗会有哪些取舍？后面是假设，不要保存。';

test('mixed correction coverage requires the whole explicit block but excludes the separately introduced hypothetical question', () => {
  assert.equal(hasExplicitNeedCorrection(mixed), true);
  assert.deepEqual(uncoveredNeedStatements(mixed, [desk]), ['预算改为18万元']);
  assert.deepEqual(uncoveredNeedStatements(mixed, [desk, budget]), []);
  const broad = { ...desk, quote: mixed };
  assert.deepEqual(uncoveredNeedStatements(mixed, [broad]), ['预算改为18万元'], 'A broad quote is not a receipt for a missing value');
  assert.deepEqual(uncoveredNeedStatements('更正：书房书桌改为靠内墙，书房收纳改为封闭柜，另外插座怎么确定？', [desk]), ['书房收纳改为封闭柜']);
});

test('mixed correction coverage cannot turn conditions, reported speech or a refusal into a saving scope', () => {
  for (const text of ['更正：如果书房书桌改为靠内墙；预算改为18万元。另外插座怎么确定？',
    '设计师说“更正：书房书桌改为靠内墙；预算改为18万元”。另外插座怎么确定？',
    '更正：书房书桌改为靠内墙，另外如果预算允许才按刚才的更正，可以吗？',
    '更正：书房书桌改为靠内墙；预算改为18万元。另外插座怎么确定？不要记录。']) {
    assert.deepEqual(uncoveredNeedStatements(text, [desk]), [], text);
    assert.equal(hasExplicitNeedCorrection(text), false, text);
  }
});

test('mixed correction global budget cannot inherit a room from an unrelated clause', () => {
  for (const text of [mixed, '更正：书房书桌改为靠内墙；全屋预算改为18万元。另外插座怎么确定？']) {
    assert.throws(() => applyNeedDelta(readMemory({}), { ...budget, room: '书房', sourceMessageId: '2', expectedVersion: 0 },
      { id: '2', text }, '9:0:0', 'now'), /need_source_mismatch/);
  }
});

test('mixed correction explicit budget scope and the unchanged global scope retain their own correction keys', () => {
  for (const [room, quote] of [['', '预算改为18万元'], ['全屋', '全屋预算改为18万元'], ['书房', '书房预算改为18万元']]) {
    const text = `更正：书房书桌改为靠内墙；${quote}。另外插座怎么确定？`;
    const next = applyNeedDelta(readMemory({}), { ...budget, room, quote, sourceMessageId: '2', expectedVersion: 0 },
      { id: '2', text }, '9:0:0', 'now');
    assert.equal(next.facts[0].room, room);
  }
});

test('mixed correction hypothetical tail cannot supply a new current need', () => {
  assert.throws(() => applyNeedDelta(readMemory({}), { ...desk, value: '靠窗', quote: '如果仍靠窗会有哪些取舍', sourceMessageId: '2', expectedVersion: 0 },
    { id: '2', text: mixed }, '9:0:0', 'now'), /need_source_mismatch/);
});
