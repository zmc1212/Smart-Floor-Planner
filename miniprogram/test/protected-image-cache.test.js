const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const utilPath = path.join(__dirname, '..', 'utils', 'protectedImageCache.js');

function loadUtil(wxStub) {
  const originalWx = global.wx;
  global.wx = wxStub;
  delete require.cache[require.resolve(utilPath)];
  try {
    return require(utilPath);
  } finally {
    global.wx = originalWx;
  }
}

function createWxStub(options = {}) {
  const files = new Map(options.files || []);
  let requestCount = 0;
  const wxStub = {
    env: { USER_DATA_PATH: '/tmp/wx-user' },
    getStorageSync() { return options.token || ''; },
    getFileSystemManager() {
      return {
        accessSync(filePath) {
          if (!files.has(filePath)) throw new Error('not found');
        },
        writeFile({ filePath, data, success }) {
          files.set(filePath, data);
          success();
        },
      };
    },
    request({ success }) {
      requestCount += 1;
      success({
        statusCode: 200,
        data: options.body || Buffer.from('png-bytes'),
        header: { 'content-type': options.contentType || 'image/png' },
      });
    },
    _files: files,
    _requestCount() { return requestCount; },
  };
  return wxStub;
}

test('protected image cache returns an existing local file without downloading', async () => {
  const cached = '/tmp/wx-user/protected-img-lead1-gen9.png';
  const wxStub = createWxStub({ files: [[cached, Buffer.from('png-bytes')]] });
  const { fetchProtectedImage, resetProtectedImageCacheForTests } = loadUtil(wxStub);
  global.wx = wxStub;
  resetProtectedImageCacheForTests();
  try {
    const filePath = await fetchProtectedImage('/miniprogram/customer-projects/1/published-generations/9/image', 'lead1-gen9');
    assert.equal(filePath, cached);
    assert.equal(wxStub._requestCount(), 0);
  } finally {
    resetProtectedImageCacheForTests();
    delete global.wx;
  }
});

test('protected image cache downloads once and reuses the written file', async () => {
  const wxStub = createWxStub();
  const { fetchProtectedImage, resetProtectedImageCacheForTests } = loadUtil(wxStub);
  global.wx = wxStub;
  resetProtectedImageCacheForTests();
  try {
    const first = await fetchProtectedImage('/miniprogram/x', 'lead1-gen9');
    const second = await fetchProtectedImage('/miniprogram/x', 'lead1-gen9');
    assert.equal(first, '/tmp/wx-user/protected-img-lead1-gen9.png');
    assert.equal(second, first);
    assert.equal(wxStub._requestCount(), 1);
  } finally {
    resetProtectedImageCacheForTests();
    delete global.wx;
  }
});

test('floor-plan cache key changes when the plan is updated', () => {
  const wxStub = createWxStub();
  const { floorPlanCacheKey } = loadUtil(wxStub);
  const before = floorPlanCacheKey('lead1', { id: 'fp1', updatedAt: '2026-08-21T10:00:00.000Z' });
  const after = floorPlanCacheKey('lead1', { id: 'fp1', updatedAt: '2026-08-22T11:00:00.000Z' });
  assert.notEqual(before, after);
  assert.match(before, /lead1/);
  assert.match(before, /fp1/);
});
