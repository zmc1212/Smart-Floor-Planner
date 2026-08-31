const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  readWechatPhoneAuth,
  refreshWechatLoginCode,
  resetWechatLoginCodeForTests,
  resolveWechatPhoneLoginInput,
  wechatPhoneAuthToast
} = require('../utils/wechat-phone-auth.js');

test('readWechatPhoneAuth prefers code and falls back to encryptedData', () => {
  assert.equal(readWechatPhoneAuth({ errMsg: 'getPhoneNumber:fail user deny' }).reason, 'denied');
  assert.equal(
    readWechatPhoneAuth({ errMsg: 'getPhoneNumber:ok' }).reason,
    'missing'
  );
  assert.deepEqual(
    readWechatPhoneAuth({ errMsg: 'getPhoneNumber:ok', code: 'dynamic-code' }),
    { ok: true, kind: 'code', phoneCode: 'dynamic-code' }
  );
  assert.equal(
    readWechatPhoneAuth({
      errMsg: 'getPhoneNumber:ok',
      code: 'dynamic-code',
      encryptedData: 'enc',
      iv: 'iv'
    }).kind,
    'code'
  );
  assert.deepEqual(
    readWechatPhoneAuth({
      errMsg: 'getPhoneNumber:ok',
      encryptedData: 'enc',
      iv: 'iv'
    }),
    { ok: true, kind: 'encrypted', encryptedData: 'enc', iv: 'iv' }
  );
});

test('encryptedData path consumes the pre-tap login code and does not wait for a new wx.login', async () => {
  resetWechatLoginCodeForTests();
  const originalWx = global.wx;
  const codes = ['pre-tap-code', 'next-code'];
  global.wx = {
    login(options) {
      const code = codes.shift();
      if (options.success) options.success({ code });
      if (options.complete) options.complete();
    }
  };
  try {
    await refreshWechatLoginCode();
    const resolved = resolveWechatPhoneLoginInput({
      errMsg: 'getPhoneNumber:ok',
      encryptedData: 'cipher',
      iv: 'init-vector'
    });
    assert.deepEqual(resolved, {
      ok: true,
      kind: 'encrypted',
      loginCode: 'pre-tap-code',
      encryptedData: 'cipher',
      iv: 'init-vector'
    });
  } finally {
    resetWechatLoginCodeForTests();
    global.wx = originalWx;
  }
});

test('encryptedData without a prefetched login code asks the user to tap again', () => {
  resetWechatLoginCodeForTests();
  const resolved = resolveWechatPhoneLoginInput({
    errMsg: 'getPhoneNumber:ok',
    encryptedData: 'cipher',
    iv: 'init-vector'
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'session');
  assert.equal(wechatPhoneAuthToast('session'), '请再点一次授权');
  assert.equal(wechatPhoneAuthToast('denied'), '已取消授权');
  assert.equal(wechatPhoneAuthToast('missing'), '获取手机号失败');
});

test('login, onboarding, open-account, and claim pages wire the encryptedData fallback', () => {
  const pages = [
    'packages/business/login/login.js',
    'packages/business/onboarding/onboarding.js',
    'packages/business/enterprise-register/enterprise-register.js',
    'packages/business/free-design-service/free-design-service.js'
  ];
  const root = path.resolve(__dirname, '..');
  for (const relative of pages) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /refreshWechatLoginCode/);
    assert.match(source, /resolveWechatPhoneLoginInput/);
    assert.match(source, /encryptedData/);
  }
});
