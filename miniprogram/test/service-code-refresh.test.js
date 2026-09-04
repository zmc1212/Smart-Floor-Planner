const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../utils/api.js');

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
const jpeg = () => new Uint8Array([255, 216, 255, 224]).buffer;
const flush = () => new Promise(setImmediate);

function setup(t, kind, { deferWrites = false } = {}) {
  const saved = { wx: global.wx, getApp: global.getApp, Page: global.Page };
  const requests = [];
  const writes = [];
  const unlinks = [];
  const files = new Map();
  const metadata = [];
  global.getApp = () => ({ globalData: { token: 'test-session' } });
  global.wx = {
    env: { USER_DATA_PATH: '/test-user-data' },
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 296, top: 24, height: 32 }),
    getStorageSync: () => '',
    request: (options) => requests.push(options),
    navigateTo() {},
    getFileSystemManager: () => ({
      writeFile(options) {
        writes.push(options);
        files.set(options.filePath, options.data);
        if (!deferWrites) options.success();
      },
      unlink({ filePath }) { unlinks.push(filePath); files.delete(filePath); }
    })
  };
  t.after(() => Object.assign(global, saved));
  t.mock.method(api, 'request', async (endpoint) => {
    metadata.push(endpoint);
    return { data: { token: `${kind}-${metadata.length}`, enterpriseName: '测试企业' } };
  });
  let definition;
  global.Page = (value) => { definition = value; };
  const pagePath = require.resolve(`../packages/business/${kind}/${kind}.js`);
  delete require.cache[pagePath];
  require(pagePath);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }
  };
  page.onLoad({ membershipId: '123' });
  return { page, requests, writes, unlinks, files, metadata };
}

for (const kind of ['promotion-service-code', 'staff-activity-code']) {
  test(`${kind} reloads once per show with a fresh native image path and the new share token`, async (t) => {
    const { page, requests, files, metadata, unlinks } = setup(t, kind);
    assert.equal(metadata.length, 0);
    const first = page.onShow();
    await flush();
    assert.equal(requests.length, 1);
    requests[0].success({ statusCode: 200, data: png() });
    await first;
    const oldPath = page.data.qrImagePath;
    assert.match(oldPath, /\.png$/);
    assert.equal(files.size, 1);
    assert.match(page.onShareAppMessage().path, new RegExp(`${kind}-1`));
    page.onHide();
    const second = page.onShow();
    assert.equal(page.data.qrImagePath, '');
    assert.equal(page.onShareAppMessage().path, '/pages/index/index');
    await flush();
    // The signature, rather than a guessed PNG extension, determines the file format.
    requests[1].success({ statusCode: 200, header: { 'Content-Type': 'image/png' }, data: jpeg() });
    await second;
    assert.equal(metadata.length, 2);
    assert.equal(page.data.loading, false);
    assert.notEqual(page.data.qrImagePath, oldPath);
    assert.notEqual(requests[0].url, requests[1].url);
    assert.match(page.data.qrImagePath, /\.jpg$/);
    assert.ok(unlinks.includes(oldPath));
    assert.equal(files.size, 1);
    assert.match(page.onShareAppMessage().path, new RegExp(`${kind}-2`));
    page.onUnload();
    assert.equal(files.size, 0);
  });

  test(`${kind} ignores an older response after hiding and reopening`, async (t) => {
    const { page, requests, writes } = setup(t, kind);
    const first = page.onShow();
    await flush();
    page.onHide();
    const second = page.onShow();
    await flush();
    requests[1].success({ statusCode: 200, data: jpeg() });
    await second;
    const currentPath = page.data.qrImagePath;
    requests[0].success({ statusCode: 200, data: png() });
    await first;
    assert.equal(writes.length, 1);
    assert.equal(page.data.qrImagePath, currentPath);
    assert.match(page.onShareAppMessage().path, new RegExp(`${kind}-2`));
  });

  test(`${kind} cleans up an in-flight file write completed after unload`, async (t) => {
    const { page, requests, writes, files } = setup(t, kind, { deferWrites: true });
    const pending = page.onShow();
    await flush();
    requests[0].success({ statusCode: 200, data: png() });
    assert.equal(writes.length, 1);
    page.onUnload();
    writes[0].success();
    await pending;
    assert.equal(files.size, 0);
    assert.equal(page.data.qrImagePath, '');
  });

  test(`${kind} clears a stale share token when metadata fails and never requests an image`, async (t) => {
    const { page, requests } = setup(t, kind);
    page.data.promotionToken = 'stale-promotion';
    page.data.activityToken = 'stale-activity';
    api.request.mock.mockImplementation(async () => { throw { code: 'identity_context_changed' }; });
    await page.onShow();
    assert.equal(requests.length, 0);
    assert.equal(page.data.loading, false);
    assert.ok(page.data.errorMessage);
    assert.equal(page.onShareAppMessage().path, '/pages/index/index');
  });
}

test('a JSON image error preserves profile recovery without writing it as a PNG', async (t) => {
  const { page, requests, files } = setup(t, 'staff-activity-code');
  const pending = page.onShow();
  await flush();
  const bytes = new TextEncoder().encode(JSON.stringify({ code: 'designer_profile_incomplete' }));
  requests[0].success({ statusCode: 403, data: bytes.buffer });
  await pending;
  assert.equal(page.data.errorAction, 'profile');
  assert.equal(files.size, 0);
  const navigate = t.mock.method(wx, 'navigateTo');
  page.onFixProfile();
  assert.equal(navigate.mock.calls[0].arguments[0].url, '/packages/business/profile-edit/profile-edit');
  page.onHide();
  const returning = page.onShow();
  await flush();
  requests[1].success({ statusCode: 200, data: png() });
  await returning;
  assert.equal(page.data.errorMessage, '');
  assert.equal(page.data.loading, false);
});

test('an HTTP 200 response containing no image signature uses the existing retry state', async (t) => {
  const { page, requests, writes } = setup(t, 'promotion-service-code');
  const pending = page.onShow();
  await flush();
  requests[0].success({ statusCode: 200, data: new TextEncoder().encode('invalid image').buffer });
  await pending;
  assert.equal(writes.length, 0);
  assert.equal(page.data.qrImagePath, '');
  assert.ok(page.data.errorMessage);
});
