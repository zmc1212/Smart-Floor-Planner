const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { canAccessRoute } = require('../utils/identity-navigation');
const filename = path.resolve(__dirname, '../packages/construction/family/family.js');
const source = fs.readFileSync(filename, 'utf8');

function fixture(handler) {
  const calls = [], messages = [], app = { globalData: { token: 'session-a' } };
  const wx = {
    getStorageSync: () => 'session-a',
    navigateTo: options => messages.push(options.url),
    showToast: options => messages.push(options.title),
    stopPullDownRefresh: () => messages.push('refresh-stopped'),
  };
  const localRequire = createRequire(filename);
  const api = {
    request: async (url, method, data, options) => {
      calls.push({ url, method, data, options });
      return handler(url, method, data);
    },
  };
  let definition;
  new Function('require', 'Page', 'getApp', 'wx', source)(
    name => (name.includes('utils/api') ? api : localRequire(name)),
    value => { definition = value; },
    () => app,
    wx,
  );
  return {
    calls,
    messages,
    page() {
      return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
    },
  };
}

test('the family site route is available to customers and closed to unrelated staff', () => {
  const route = '/packages/construction/family/family';
  assert.equal(canAccessRoute(route, { role: 'customer', mode: 'customer' }), true);
  assert.equal(canAccessRoute(route, { mode: 'staff', staffRole: 'construction_staff' }), false);
  assert.equal(canAccessRoute('/packages/construction/camera/camera', { role: 'customer', mode: 'customer' }), true);
});

test('an owner opens one project, reads progress and camera list, and gets a share card', async () => {
  const f = fixture((url, method) => {
    if (url.startsWith('/miniprogram/construction/customer-projects')) {
      return { data: [{ id: '19', name: '工地 A', leadId: '8', role: 'owner' }] };
    }
    if (url.endsWith('/progress')) {
      return { data: { access: 'owner', progress: { overall: { color: 'green', label: '正常' }, construction: { stageName: '水电' }, summary: '施工计划V1', nodes: [] } } };
    }
    if (url.endsWith('/cameras')) return { data: { items: [{ id: '5', name: '客厅' }] } };
    if (url.endsWith('/family-viewers')) return { data: [] };
    if (url.endsWith('/family-invite') && method === 'POST') return { data: { token: 'invite-token', expiresAt: '2099-01-01T00:00:00.000Z' } };
    throw new Error('unexpected request ' + method + ' ' + url);
  });
  const page = f.page();
  page.onLoad({ projectId: '19' });
  await page.load();
  assert.equal(page.data.projectId, '19');
  assert.equal(page.data.projectName, '工地 A');
  assert.equal(page.data.role, 'owner');
  assert.equal(page.data.progress.construction.stageName, '水电');
  assert.equal(page.data.cameras.length, 1);
  assert.equal(page.data.inviteToken, 'invite-token');
  assert.ok(f.calls.some(call => call.url.endsWith('/progress')));
  assert.ok(f.calls.some(call => call.url.endsWith('/cameras')));
  assert.ok(f.calls.some(call => call.url.endsWith('/family-invite') && call.method === 'POST'));
  const share = page.onShareAppMessage();
  assert.match(share.path, /projectId=19/);
  assert.match(share.path, /invite=invite-token/);
  page.openCamera({ currentTarget: { dataset: { project: '19' } } });
  assert.equal(f.messages.at(-1), '/packages/construction/camera/camera?projectId=19');
});

test('a family share card is accepted before reading the project', async () => {
  const f = fixture((url, method) => {
    if (url.startsWith('/miniprogram/construction/family-invites/')) return { data: { projectId: '19', access: 'family_view' } };
    if (url.startsWith('/miniprogram/construction/customer-projects')) {
      return { data: [{ id: '19', name: '工地 A', leadId: '8', role: 'family' }] };
    }
    if (url.endsWith('/progress')) return { data: { access: 'family_view', progress: { overall: { color: 'yellow', label: '正常' }, construction: { stageName: '水电' }, summary: '施工计划V1', nodes: [] } } };
    if (url.endsWith('/cameras')) return { data: { items: [] } };
    throw new Error('unexpected request ' + method + ' ' + url);
  });
  const page = f.page();
  page.onLoad({ projectId: '19', invite: 'signed-card' });
  await page.load();
  assert.equal(f.calls[0].url, '/miniprogram/construction/family-invites/signed-card/accept');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(page.data.role, 'family');
  assert.ok(!f.calls.some(call => call.url.endsWith('/family-viewers')));
  assert.ok(!f.calls.some(call => call.url.endsWith('/family-invite') && call.method === 'POST'));
});
