const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

test('password login 401 rejects with the backend Chinese error instead of Unauthorized', async () => {
  const apiPath = require.resolve('../utils/api.js');
  delete require.cache[apiPath];

  const originals = {
    getApp: global.getApp,
    wx: global.wx,
  };

  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync() {
      return '';
    },
    setStorageSync() {},
    request(options) {
      options.success({
        statusCode: 401,
        data: { success: false, error: '用户名或密码错误' },
      });
    },
    showModal() {},
  };

  try {
    const api = require(apiPath);
    await assert.rejects(
      () => api.passwordLogin('gongjie', 'wrong'),
      (err) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.error, '用户名或密码错误');
        return true;
      }
    );
  } finally {
    delete require.cache[apiPath];
    if (originals.getApp === undefined) delete global.getApp;
    else global.getApp = originals.getApp;
    if (originals.wx === undefined) delete global.wx;
    else global.wx = originals.wx;
  }
});
