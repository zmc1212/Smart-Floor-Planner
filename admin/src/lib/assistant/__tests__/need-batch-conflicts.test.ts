import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needWriteFeedback, parseNeedWrites } from '../agent/memory';

const source = '请记下：先不确定装修日期，不要替我定日期。';
const first = { room: '', field: 'timeline', value: '先不确定装修日期', quote: '请记下：先不确定装修日期' };
const duplicate = { ...first, additionalNeeds: [{ room: '', field: 'timeline', value: '不要替我定日期', quote: '不要替我定日期' }] };
function rejectedFeedback(input: unknown, text = source) {
  let failure: unknown;
  try { parseNeedWrites(input); } catch (error) { failure = error; }
  assert.ok(failure, 'The conflicting batch must remain rejected');
  return needWriteFeedback(failure, text, input);
}

test('saved 1396/1397 duplicate timeline proposals expose exact batch conflict without changing fields or values', () => {
  const original = structuredClone(duplicate), feedback = rejectedFeedback(duplicate);
  assert.ok(feedback && 'batchConflicts' in feedback);
  assert.equal(feedback.error, 'invalid_message');
  assert.equal(feedback.batchCommitted, false);
  assert.deepEqual(feedback.batchConflicts, [{ reason: 'duplicate_room_field', room: '', field: 'timeline', indices: [0, 1] }]);
  assert.deepEqual(feedback.submittedWrites?.map(({ room, field, value, quote }) => ({ room, field, value, quote })), [first, duplicate.additionalNeeds[0]]);
  assert.deepEqual(feedback.sourceIssues, [], 'Original substrings are valid; the batch key collision is distinct');
  assert.deepEqual(duplicate, original, 'Diagnostics cannot rewrite model parameters');
});

test('all validated duplicate groups are reported with their actual original argument indices', () => {
  const a = { room: '书房', field: 'desk', value: '靠窗', quote: '书房书桌靠窗' };
  const b = { room: '', field: 'timeline', value: '日期未定', quote: '日期未定' };
  const feedback = rejectedFeedback({ ...a, additionalNeeds: [b, a, b] }, '书房书桌靠窗，日期未定。');
  assert.ok(feedback && 'batchConflicts' in feedback);
  assert.deepEqual(feedback.batchConflicts, [
    { reason: 'duplicate_room_field', room: '书房', field: 'desk', indices: [0, 2] },
    { reason: 'duplicate_room_field', room: '', field: 'timeline', indices: [1, 3] },
  ]);
  assert.equal(parseNeedWrites({ ...a, additionalNeeds: [{ ...a, room: '客厅' }, b] }).length, 3, 'Independent room/field keys remain valid');
});

test('malformed or authority-bearing arguments never become validated duplicate diagnostics', () => {
  for (const input of [
    { ...duplicate, additionalNeeds: [{ ...duplicate.additionalNeeds[0], tenantId: 'never-expose-authority' }] },
    { ...duplicate, additionalNeeds: [null] },
    { ...duplicate, additionalNeeds: Array.from({ length: 4 }, () => first) },
  ]) {
    const feedback = rejectedFeedback(input);
    assert.ok(feedback);
    assert.equal('batchConflicts' in feedback, false);
    assert.equal(feedback.submittedWrites, undefined);
    assert.ok(!JSON.stringify(feedback).includes('never-expose-authority'));
  }
});
