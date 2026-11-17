import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAcquisitionChatPath, buildPromotionServicePath } from '../wechat-miniprogram-code';

const token = `rp_${'a'.repeat(32)}`;

test('acquisition code opens XiaoK chat with the opaque promotion token', () => {
  const path = buildAcquisitionChatPath(token);
  assert.equal(path, `packages/business/acquisition-chat/acquisition-chat?entryCode=${encodeURIComponent(token)}`);
  assert.ok(Buffer.byteLength(path, 'utf8') <= 128);
});

test('acquisition path rejects non-promotion tokens instead of guessing a page', () => {
  assert.throws(() => buildAcquisitionChatPath('sa_' + 'a'.repeat(32)));
  assert.throws(() => buildAcquisitionChatPath('rp_short'));
});

test('the existing service-code path stays unchanged', () => {
  assert.equal(buildPromotionServicePath(token), `packages/business/free-design-service/free-design-service?token=${encodeURIComponent(token)}`);
});
