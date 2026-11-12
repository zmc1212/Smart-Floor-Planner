import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unavailableNoticeText } from '@/lib/assistant/knowledge/sources';
import type { PostgresTransaction } from '@/db/transaction';
import { publishedPublicMaterial, publishedPublicMaterialStatus } from '@/lib/construction/public-read';
import { publicFailure } from '@/lib/construction/public-http';

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

test('a source read failure is retryable and never retried as a withdrawal probe', async () => {
  let calls = 0;
  const site = { id: '3', enterprise_id: '1', current_version_id: '4', status: 'published',
    reviewed_by: '6', customer_id: '2', consented_by: '2', consented_version_id: '4' };
  const version = { id: '4', content: { sourceCount: 1, photoCount: 0 } };
  const tx = { async execute() {
    calls++;
    if (calls === 1) return { rows: [site] };
    if (calls === 2) return { rows: [version] };
    throw new Error('connection reset while reading the source');
  } } as unknown as PostgresTransaction;
  assert.deepEqual(await publishedPublicMaterialStatus(tx, '1', '3', '4'), { material: null, reason: 'source_unreadable' });
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(publishedPublicMaterial(tx, '1', '3', '4'), { code: 'public_source_unreadable', status: 503 });
  calls = 0;
  site.status = 'withdrawn';
  assert.deepEqual(await publishedPublicMaterialStatus(tx, '1', '3', '4'), { material: null, reason: 'source_withdrawn' });
  assert.equal(calls, 1);
  const response = publicFailure(new Error('database offline'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'public_source_unreadable');
});
