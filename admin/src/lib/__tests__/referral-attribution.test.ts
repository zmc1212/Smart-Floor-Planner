import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  openPendingReferralSource,
  sealPendingReferralSource,
} from '@/lib/referral-attribution';
import { resetWechatAccessTokenCacheForTests } from '@/lib/wechat-access-token';
import {
  buildPromotionServicePath,
  createPromotionServiceCode,
  PROMOTION_SERVICE_PAGE,
} from '@/lib/wechat-miniprogram-code';

test('pending referral sources are opaque, authenticated, and time limited', () => {
  const now = new Date('2026-08-17T00:00:00.000Z');
  const token = sealPendingReferralSource(
    {
      promotionCodeId: BigInt(17),
      membershipId: BigInt(23),
      version: 4,
    },
    { now, ttlSeconds: 600 }
  );

  assert.match(token, /^prs_[A-Za-z0-9_-]+$/);
  const packed = Buffer.from(token.slice(4), 'base64url').toString('utf8');
  assert.equal(packed.includes('"p":"17"'), false);
  assert.equal(packed.includes('"m":"23"'), false);

  const opened = openPendingReferralSource(token, {
    now: new Date('2026-08-17T00:09:59.000Z'),
  });
  assert.deepEqual(opened, {
    promotionCodeId: BigInt(17),
    membershipId: BigInt(23),
    version: 4,
    expiresAt: new Date('2026-08-17T00:10:00.000Z'),
    expired: false,
  });

  assert.equal(
    openPendingReferralSource(token, {
      now: new Date('2026-08-17T00:10:01.000Z'),
    })?.expired,
    true
  );
  assert.equal(
    openPendingReferralSource(`${token.slice(0, -1)}x`, { now }),
    null
  );
});

test('promotion service codes use the anonymous claim route and real WeChat PNG bytes', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const token = `rp_${'A'.repeat(32)}`;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/cgi-bin/token')) {
      return new Response(
        JSON.stringify({ access_token: 'wechat_access_token', expires_in: 7200 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    assert.equal(
      buildPromotionServicePath(token),
      `${PROMOTION_SERVICE_PAGE}?token=${token}`
    );
    const bytes = await createPromotionServiceCode(token, { fetchImpl });
    assert.deepEqual([...bytes], [...png]);
    assert.equal(calls.length, 2);
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.path, `${PROMOTION_SERVICE_PAGE}?token=${token}`);
    assert.equal(body.width, 430);
    assert.deepEqual(body.line_color, { r: 8, g: 137, b: 57 });
    assert.equal(JSON.stringify(body).includes('enterprise'), false);
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('promotion code image route keeps provider failures stable and private', () => {
  const route = readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/miniprogram/referrer-memberships/[id]/promotion-code/image/route.ts'
    ),
    'utf8'
  );

  assert.match(route, /invalid_membership_id[\s\S]*status:\s*400/);
  assert.match(route, /promotion_code_lookup_failed[\s\S]*status:\s*500/);
  assert.match(route, /wechat_code_unavailable[\s\S]*status:\s*502/);
  assert.doesNotMatch(route, /error:\s*error\s+instanceof\s+Error/);
});
