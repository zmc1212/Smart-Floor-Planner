import { createCipheriv } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWechatAccessToken,
  resetWechatAccessTokenCacheForTests,
} from '@/lib/wechat-access-token';
import {
  decryptWechatEncryptedPhoneNumber,
  getWechatPhoneNumber,
  resolveWechatPhoneLogin,
} from '@/lib/wechat-miniprogram-auth';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('WeChat access tokens come from the stable-token API and are reused until expiry', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ access_token: 'stable_token_1', expires_in: 7200 });
  }) as typeof fetch;

  try {
    const now = 1_700_000_000_000;
    const first = await getWechatAccessToken({ fetchImpl, now });
    const second = await getWechatAccessToken({
      fetchImpl,
      now: now + 60_000,
    });

    assert.equal(first, 'stable_token_1');
    assert.equal(second, 'stable_token_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.weixin.qq.com/cgi-bin/stable_token');
    assert.equal(calls[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      grant_type: 'client_credential',
      appid: 'wx_test_app',
      secret: 'test_secret',
      force_refresh: false,
    });
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('phone-number lookup retries once after a stale access_token', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  resetWechatAccessTokenCacheForTests();

  const tokenCalls: string[] = [];
  const phoneCalls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/cgi-bin/stable_token')) {
      const body = JSON.parse(String(init?.body || '{}'));
      tokenCalls.push(body.force_refresh ? 'refresh' : 'stable');
      return jsonResponse({
        access_token: tokenCalls.length === 1 ? 'stale_token' : 'fresh_token',
        expires_in: 7200,
      });
    }
    if (url.includes('/wxa/business/getuserphonenumber')) {
      phoneCalls.push(url);
      if (url.includes('stale_token')) {
        return jsonResponse({
          errcode: 40001,
          errmsg:
            'invalid credential, access_token is invalid or not latest, could get access_token by getStableAccessToken',
        });
      }
      return jsonResponse({
        errcode: 0,
        phone_info: {
          phoneNumber: '8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86',
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;

  try {
    const phone = await getWechatPhoneNumber('phone_code', { fetchImpl });
    assert.equal(phone, '13800138000');
    assert.deepEqual(tokenCalls, ['stable', 'stable']);
    assert.equal(phoneCalls.length, 2);
    assert.match(phoneCalls[0], /stale_token/);
    assert.match(phoneCalls[1], /fresh_token/);
  } finally {
    resetWechatAccessTokenCacheForTests();
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

function encryptWechatPhone(appId: string, sessionKey: Buffer, iv: Buffer, phone: string) {
  const cipher = createCipheriv('aes-128-cbc', sessionKey, iv);
  const payload = JSON.stringify({
    phoneNumber: `86${phone}`,
    purePhoneNumber: phone,
    countryCode: '86',
    watermark: { appid: appId, timestamp: 1_700_000_000 },
  });
  return Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString(
    'base64'
  );
}

test('legacy encryptedData decrypts to the bound WeChat phone', () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  const sessionKey = Buffer.alloc(16, 7);
  const iv = Buffer.alloc(16, 9);
  try {
    const encryptedData = encryptWechatPhone(
      'wx_test_app',
      sessionKey,
      iv,
      '13800138000'
    );
    assert.equal(
      decryptWechatEncryptedPhoneNumber({
        encryptedData,
        iv: iv.toString('base64'),
        sessionKey: sessionKey.toString('base64'),
      }),
      '13800138000'
    );
  } finally {
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});

test('legacy encryptedData login uses session_key and skips getuserphonenumber', async () => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'wx_test_app';
  process.env.WX_APPSECRET = 'test_secret';
  const sessionKey = Buffer.alloc(16, 3);
  const iv = Buffer.alloc(16, 5);
  const encryptedData = encryptWechatPhone(
    'wx_test_app',
    sessionKey,
    iv,
    '13900139000'
  );
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/sns/jscode2session')) {
      return jsonResponse({
        openid: 'openid-legacy',
        unionid: 'union-legacy',
        session_key: sessionKey.toString('base64'),
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;

  try {
    const identity = await resolveWechatPhoneLogin(
      {
        loginCode: 'pre-tap-login',
        encryptedData,
        iv: iv.toString('base64'),
      },
      { fetchImpl }
    );
    assert.equal(identity.openid, 'openid-legacy');
    assert.equal(identity.phone, '13900139000');
  } finally {
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  }
});
