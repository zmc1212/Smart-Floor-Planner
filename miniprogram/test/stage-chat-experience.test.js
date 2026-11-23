const assert = require('node:assert/strict');
const test = require('node:test');
const { inputCandidates } = require('../packages/assistant/lib/stage-chat-experience');

test('stage input guidance replaces only the matched suffix at the caret', () => {
  const text = '明天我想问水电，再看门窗';
  const caret = text.indexOf('，');
  const suggestion = '水电点位怎么检查？';
  const match = inputCandidates(text, caret, [suggestion, '门窗进场要注意什么？']);
  assert.deepEqual(match.items, [suggestion]);
  assert.equal(text.slice(0, match.start) + match.items[0] + text.slice(match.end),
    '明天我想问水电点位怎么检查？，再看门窗');
  assert.equal(inputCandidates('', 0, [suggestion]), null);
  assert.equal(inputCandidates('水电', 2, []), null);
  assert.equal(inputCandidates('水电\n', 3, [suggestion]), null);
});
