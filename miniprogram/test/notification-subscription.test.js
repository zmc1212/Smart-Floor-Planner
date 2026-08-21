const test = require('node:test');
const assert = require('node:assert/strict');

const api = require('../utils/api.js');
const notification = require('../utils/notification.js');

const templates = [
  { type: 'workflow_todo', title: '装修待办提醒', templateId: '48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc' },
  { type: 'lead_assignment', title: '客户指派成功通知', templateId: 'wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA' },
  { type: 'new_lead', title: '新增客户成功通知', templateId: 'EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc' },
  { type: 'measurement_appointment', title: '上门量房提醒', templateId: 'CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl' },
  { type: 'design_published', title: '设计案例发布提醒', templateId: 'XEQFWwyalQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag' },
];

test('versioned notification config requires every semantic template and ignores legacy scalar cache', () => {
  assert.equal(notification.normalizeTemplateConfig({ miniprogramTemplateId: 'legacy' }), null);
  assert.equal(notification.normalizeTemplateConfig({ version: 2, templates: templates.slice(0, 4) }), null);
  assert.deepEqual(
    notification.normalizeTemplateConfig({ version: 2, templates }).templates.map((item) => item.type),
    notification.TEMPLATE_ORDER
  );
});

test('versioned notification config rejects duplicate template IDs', () => {
  const config = { version: 2, templates: templates.map((template) => ({ ...template })) };
  config.templates[3].templateId = config.templates[0].templateId;
  assert.equal(notification.normalizeTemplateConfig(config), null);
});

test('role-scoped subscribe kinds stay within the WeChat three-template limit', () => {
  assert.equal(notification.getSubscribeKindsForRole('customer').length, 2);
  assert.equal(notification.getSubscribeKindsForRole('designer').length, 3);
  assert.equal(notification.getSubscribeKindsForRole('measurer').length, 3);
  assert.equal(notification.getSubscribeKindsForRole('enterprise_admin').length, 2);
  assert.deepEqual(notification.getSubscribeKindsForRole('referrer'), []);
  assert.ok(notification.getSubscribeKindsForRole('customer').includes('design_published'));
});

test('notification authorization requests role-scoped templates and returns every result state', async () => {
  const originalWx = global.wx;
  const originalRequest = api.request;
  const originalGetApp = global.getApp;
  const stored = [];
  const toasts = [];
  let requestedIds = [];
  api.request = async () => ({ data: { version: 2, templates } });
  global.getApp = () => ({
    globalData: {
      bootstrap: { current: { role: 'customer', mode: 'customer' } }
    }
  });
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync(key, value) { stored.push([key, value]); },
    showToast(options) { toasts.push(options.title); },
    requestSubscribeMessage(options) {
      requestedIds = options.tmplIds;
      options.success({
        [templates[3].templateId]: 'accept',
        [templates[4].templateId]: 'reject'
      });
    }
  };

  try {
    const result = await notification.requestNotification();
    assert.deepEqual(requestedIds, [templates[3].templateId, templates[4].templateId]);
    assert.deepEqual(result.accepted, [templates[3].templateId]);
    assert.deepEqual(result.rejected, [templates[4].templateId]);
    assert.equal(stored[0][0], notification.TEMPLATE_CONFIG_STORAGE_KEY);
    assert.deepEqual(toasts, ['已开启 1/2 项']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('designer authorization requests at most three templates', async () => {
  const originalWx = global.wx;
  const originalRequest = api.request;
  const originalGetApp = global.getApp;
  let requestedIds = [];
  api.request = async () => ({ data: { version: 2, templates } });
  global.getApp = () => ({
    globalData: {
      bootstrap: { current: { role: 'designer', mode: 'staff' } }
    }
  });
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    showToast() {},
    requestSubscribeMessage(options) {
      requestedIds = options.tmplIds;
      options.success(Object.fromEntries(options.tmplIds.map((id) => [id, 'accept'])));
    }
  };

  try {
    await notification.requestNotification({ role: 'designer' });
    assert.equal(requestedIds.length, 3);
    assert.ok(requestedIds.length <= 3);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});

test('notification authorization does not fall back to a hard-coded ID without server or V2 cache', async () => {
  const originalWx = global.wx;
  const originalRequest = api.request;
  const originalGetApp = global.getApp;
  const toasts = [];
  let requestCalled = false;
  api.request = async () => { throw new Error('offline'); };
  global.getApp = () => ({ globalData: { bootstrap: { current: { role: 'customer' } } } });
  global.wx = {
    getStorageSync() { return 'legacy-template-id'; },
    showToast(options) { toasts.push(options.title); },
    requestSubscribeMessage() { requestCalled = true; }
  };

  try {
    const result = await notification.requestNotification();
    assert.equal(requestCalled, false);
    assert.deepEqual(result.templateIds, []);
    assert.deepEqual(toasts, ['通知配置暂不可用，请稍后重试']);
  } finally {
    api.request = originalRequest;
    global.wx = originalWx;
    global.getApp = originalGetApp;
  }
});
