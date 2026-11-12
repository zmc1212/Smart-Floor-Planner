import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unavailableNoticeText } from '@/lib/assistant/knowledge/sources';

test('an unavailable answer explains the actual source failure, never a guessed one', () => {
  // A transient read failure must not read as deleted or withdrawn content.
  assert.equal(unavailableNoticeText('source_unreadable'), '资料暂时无法读取，请稍后重试。');
  // A lost grant is a permission result, not a version change.
  assert.match(unavailableNoticeText('source_forbidden'), /无权/);
  // A replaced/re-saved version asks the customer to look at the current copy.
  assert.match(unavailableNoticeText('source_changed'), /已更新/);
  // A deleted original is named as missing.
  assert.match(unavailableNoticeText('source_missing'), /已不存在/);
  // A withdrawn publication is named as withdrawn.
  assert.match(unavailableNoticeText('source_withdrawn'), /已撤回/);
  // Unknown/absent reasons keep the previous generic wording.
  const fallback = '这条回答所依据的资料已不可用，请重新提问。';
  assert.equal(unavailableNoticeText(undefined), fallback);
  assert.equal(unavailableNoticeText('unexpected'), fallback);
  for (const reason of ['source_unreadable', 'source_forbidden', 'source_changed', 'source_missing', 'source_withdrawn'])
    assert.notEqual(unavailableNoticeText(reason), fallback, 'each known reason has its own explanation');
});
