import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FAMILY_INVITE_PAGE,
  buildAcquisitionChatPath,
  buildPromotionServicePath,
  createFamilyInviteCode,
} from '../wechat-miniprogram-code';
import { resetWechatAccessTokenCacheForTests } from '../wechat-access-token';

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

test('a family invite code opens the build that generated it in every environment', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  const scene = 'f1.19.zzzzzz.abcdefghijkl';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  try {
    for (const envVersion of ['develop', 'trial', 'release'] as const) {
      resetWechatAccessTokenCacheForTests();
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.includes('/cgi-bin/stable_token')) {
          return new Response(
            JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }) as typeof fetch;

      const bytes = await createFamilyInviteCode(scene, { fetchImpl, envVersion });
      assert.deepEqual([...bytes], [...png]);
      const request = calls.find(call => call.url.includes('/wxa/'));
      assert.ok(request, envVersion);
      assert.match(request.url, /\/wxa\/getwxacodeunlimit\?/);
      const body = JSON.parse(String(request.init?.body));
      assert.equal(body.scene, scene);
      assert.equal(body.page, FAMILY_INVITE_PAGE);
      assert.equal(body.env_version, envVersion);
      assert.equal(body.check_path, false);
      assert.equal(body.width, 430);
    }
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});
