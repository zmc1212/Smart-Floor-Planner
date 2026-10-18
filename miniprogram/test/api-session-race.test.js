const assert = require('node:assert/strict');
const test = require('node:test');

async function withRequests(run) {
  const apiPath = require.resolve('../utils/api');
  const originals = { getApp: global.getApp, wx: global.wx };
  const app = { globalData: { token: 'old-session', userInfo: { nickname: '测试用户' } } };
  const storage = new Map([['token', 'old-session'], ['userInfo', app.globalData.userInfo]]);
  const requests = [];
  let modals = 0;
  global.getApp = () => app;
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => requests.push(options),
    showModal: options => { modals += 1; options.complete?.(); },
  };
  delete require.cache[apiPath];
  try { await run({ api: require(apiPath), app, storage, requests, modals: () => modals }); }
  finally {
    delete require.cache[apiPath];
    if (originals.getApp === undefined) delete global.getApp; else global.getApp = originals.getApp;
    if (originals.wx === undefined) delete global.wx; else global.wx = originals.wx;
  }
}

test('a delayed 401 from the previous identity cannot delete a newly logged-in session', () => withRequests(async ({ api, app, storage, requests, modals }) => {
  const pending = api.request('/leads');
  const rejected = assert.rejects(pending, error => error.statusCode === 401);
  app.globalData.token = 'new-session';
  storage.set('token', 'new-session');
  requests[0].success({ statusCode: 401, data: { success: false, error: 'Unauthorized' } });
  await rejected;
  assert.equal(app.globalData.token, 'new-session');
  assert.equal(storage.get('token'), 'new-session');
  assert.equal(app.globalData.userInfo.nickname, '测试用户');
  assert.equal(modals(), 0);
}));

test('a current-session 401 still clears invalid credentials and offers login', () => withRequests(async ({ api, app, storage, requests, modals }) => {
  const pending = api.request('/leads');
  const rejected = assert.rejects(pending, error => error.statusCode === 401);
  requests[0].success({ statusCode: 401, data: { success: false, error: 'Unauthorized' } });
  await rejected;
  assert.equal(app.globalData.token, null);
  assert.equal(storage.has('token'), false);
  assert.equal(modals(), 1);
}));

test('a temporary 503 rejects for existing retry UI while preserving the current session', () => withRequests(async ({ api, app, storage, requests, modals }) => {
  const pending = api.request('/leads');
  const rejected = assert.rejects(pending, error => error.statusCode === 503);
  requests[0].success({ statusCode: 503, data: { success: false, error: '身份服务暂时不可用，请稍后重试' } });
  await rejected;
  assert.equal(app.globalData.token, 'old-session');
  assert.equal(storage.get('token'), 'old-session');
  assert.equal(modals(), 0);
}));
