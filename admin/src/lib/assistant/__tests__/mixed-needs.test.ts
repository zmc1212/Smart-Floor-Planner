import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantError } from '../contracts';
import { applyNeedDelta, assertRecordedReply, hasExplicitNeedCorrection, needReplyFeedback, needWriteFeedback, readMemory, uncoveredNeedStatements, type NeedWrite } from '../agent/memory';

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

function savedMixed() {
  let state = readMemory({});
  for (const [i, write] of [desk, budget].entries()) state = applyNeedDelta(state,
    { ...write, sourceMessageId: '2', expectedVersion: state.version }, { id: '2', text: mixed }, `9:0:${i}`, 'now');
  return state;
}

test('mixed correction completed update predicates require a real receipt from this run', () => {
  const text = '书桌位置已更改为靠内墙，预算也调整为18万元。';
  for (const memory of [readMemory({}), savedMixed()]) {
    assert.throws(() => assertRecordedReply(text, memory, '90'), /unsupported_model_commitment/);
  }
  assert.doesNotThrow(() => assertRecordedReply(text, savedMixed(), '9'));
});

test('mixed correction a desk save or unrelated preference cannot authorize an unsaved budget update', () => {
  const memory = savedMixed();
  memory.facts = memory.facts.filter(f => f.field === 'desk');
  assert.throws(() => assertRecordedReply('书桌位置已更改为靠内墙，预算也调整为18万元。', memory, '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('预算已调整为18万元。', readMemory({}), '9', ['9:preference']), /unsupported_model_commitment/);
});

test('mixed correction a receipt does not support a different completed target value', () => {
  assert.throws(() => assertRecordedReply('预算已调整为19万元。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('书桌位置已更改为靠窗。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('书桌位置已经改成靠窗。', savedMixed(), '9'), /unsupported_model_commitment/);
  assert.doesNotThrow(() => assertRecordedReply('书桌位置和预算已调整为靠内墙和18万元。', savedMixed(), '9'));
});

test('mixed correction historical updates, denials and future proposals stay distinct from a new acknowledgement', () => {
  for (const text of ['之前书桌位置已更改为靠内墙，预算也调整为18万元，当前沿用原工作记录。',
    '上次预算已调整为18万元。本轮没有再改。', '当前预算尚未调整为18万元。', '如果预算调整为18万元，需要再核对范围。',
    '书桌位置还没有更改为靠内墙。', '预算将调整为18万元，确认后再处理。', '预算会调整为18万元，确认后再处理。',
    '书桌位置未更改为靠内墙。', '书桌位置从靠窗调整为靠内墙，预算从20万元调整为18万元。',
    '之前书桌位置已按你的更正更新为靠内墙。']) {
    assert.doesNotThrow(() => assertRecordedReply(text, savedMixed(), '90'), text);
  }
  assert.throws(() => assertRecordedReply('之前预算已调整为18万元，但这次预算已调整为19万元。', savedMixed(), '90'), /unsupported_model_commitment/);
  assert.throws(() => assertRecordedReply('预算没有调整为18万元。但书桌位置已更改为靠内墙。', savedMixed(), '90'), /unsupported_model_commitment/);
});

test('mixed correction historical desk updates recognize existing legacy field keys without rewriting them', () => {
  const state = savedMixed(); state.facts[0].field = 'style';
  const before = JSON.stringify(state);
  assert.doesNotThrow(() => assertRecordedReply('之前书桌位置已更改为靠内墙，预算也调整为18万元。', state, '90'));
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => assertRecordedReply('本次书桌位置已更改为靠内墙，预算也调整为18万元。', state, '90'), /unsupported_model_commitment/);
});

test('mixed correction receipt-only text and echoed hypotheses cannot complete the separate question', () => {
  for (const text of ['本次已记录书桌改为靠内墙和预算18万元。后面的假设不保存。',
    '书桌位置已更改为靠内墙，预算也调整为18万元。如果仍靠窗会有哪些取舍？后面是假设，不要保存。',
    '已记录。关于靠窗的取舍：这是假设，不保存。']) {
    const issue = needReplyFeedback(text, savedMixed(), '9', mixed);
    assert.equal(issue?.code, 'ungrounded_response_scope', text);
    assert.match(issue.feedback, /不取消回答/);
  }
  for (const text of ['书桌和预算本次已记录。靠窗能利用自然光，但直射光容易造成屏幕反光，还要留出开窗空间。',
    '本次没有保存成功。一般建议：靠窗能利用自然采光，但要注意屏幕眩光和窗帘的使用空间。',
    '本次实际保存两项。一般建议考虑自然光与屏幕反光，具体布置仍需核对现场尺寸。']) {
    assert.equal(needReplyFeedback(text, savedMixed(), '9', mixed), null, text);
  }
  assert.equal(needReplyFeedback('沿用原记录。', savedMixed(), '90', '只回顾本次聊天原话。'), null);
});

test('mixed correction one repair combines unsupported updates and the missing answer without a write', () => {
  const before = JSON.stringify(savedMixed());
  const issue = needReplyFeedback('书桌位置已更改为靠内墙，预算也调整为18万元。后面的假设不保存。', readMemory({}), '9', mixed)!;
  assert.equal(issue.code, 'unsupported_model_commitment'); assert.match(issue.feedback, /"savedFacts":\[\]/);
  assert.match(issue.feedback, /必须实际回答/); assert.match(issue.feedback, /不调用保存、查询或业务工具/);
  assert.equal(JSON.stringify(savedMixed()), before);
});

test('mixed correction parameter feedback preserves the exact assertion and diagnoses each submitted field without saving', () => {
  const wrong = { ...desk, quote: '书房书桌改为靠内墙。预算改为18万元', additionalNeeds: [{ ...budget, room: '书房' }] };
  const feedback = needWriteFeedback(new AssistantError('need_source_mismatch', 422), mixed, wrong)!;
  assert.equal(feedback.batchCommitted, false); assert.equal(feedback.assertionText, '更正：书房书桌改为靠内墙；预算改为18万元');
  assert.deepEqual(feedback.submittedWrites?.map(w => [w.quoteIsOriginal, w.validationError]), [[false,'need_source_mismatch'],[true,'need_source_mismatch']]);
  assert.equal(feedback.assertionText.includes('靠窗'), false); assert.match(feedback.instructions, /不表示写入成功/);
});
