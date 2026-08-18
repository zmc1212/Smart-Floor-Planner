const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../utils/api.js');

function loadPage() {
  const pagePath = require.resolve('../packages/business/measurer-unavailability/measurer-unavailability.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

function pageContext(definition, data = {}) {
  return {
    data: { ...definition.data, ...data },
    setData(next) { Object.assign(this.data, next); },
    load: async () => {},
  };
}

test('measurer unavailability saves only a forward local time range to the scoped API', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalWx = global.wx;
  const requests = [];
  api.request = async (...args) => { requests.push(args); return { success: true, data: {} }; };
  global.wx = { showToast() {} };

  try {
    const context = pageContext(definition, {
      date: '2026-08-20', startTime: '09:00', endTime: '11:00', reason: '培训',
    });
    await definition.save.call(context);
    assert.deepEqual(requests, [[
      '/measurer-unavailability',
      'POST',
      { startAt: '2026-08-20T09:00:00+08:00', endAt: '2026-08-20T11:00:00+08:00', reason: '培训' },
    ]]);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});

test('measurer unavailability rejects an invalid range before making an API request', async () => {
  const definition = loadPage();
  const originalRequest = api.request;
  const originalWx = global.wx;
  let requestCalled = false;
  const toasts = [];
  api.request = async () => { requestCalled = true; };
  global.wx = { showToast(options) { toasts.push(options.title); } };

  try {
    const context = pageContext(definition, {
      date: '2026-08-20', startTime: '11:00', endTime: '09:00',
    });
    await definition.save.call(context);
    assert.equal(requestCalled, false);
    assert.deepEqual(toasts, ['结束时间需晚于开始时间']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
  }
});
