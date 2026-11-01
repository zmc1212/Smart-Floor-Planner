const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');
const { initialEnterprise, enterpriseMethods } = require('../utils/assistant-followup-enterprise');
const { settingsPageMethods } = require('../utils/assistant-followup-settings');
function fixture(t) {
  const oldApp = global.getApp, oldWx = global.wx, calls = [];
  const context = { mode: 'staff', staffRole: 'admin', staffId: '5413', enterpriseId: '1454', enterpriseName: '微云' };
  const app = { globalData: { token: 'old', bootstrap: { current: { context } } }, hydrateStoredSession: async () => {
    calls.push('hydrate'); app.globalData.bootstrap = { current: { context: { ...context, enterpriseId: '2', enterpriseName: '合成企业' } } };
  } };
  global.getApp = () => app; global.wx = { getStorageSync: () => 'old', setStorageSync: (k, v) => calls.push(['storage', k, v]) };
  t.after(() => { global.getApp = oldApp; global.wx = oldWx; });
  const page = { ...enterpriseMethods, ...settingsPageMethods, _shown: true, _alive: true, data: { ...initialEnterprise(), followupReports: [{ private: 'old-scope' }] },
    setData(p) { Object.assign(this.data, p); }, followups: { selected: '27', hide() { calls.push('clear'); page.data.followupReports = []; }, async show() { calls.push('show'); } },
    followupMedia: { clear() { calls.push('clear-media'); } }, controller: { hide() {} } };
  page.prepareFollowupEnterprise(context);
  return { app, page, calls };
}
test('only platform identities can open enterprise management; pending writes keep their current scope', async t => {
  const f = fixture(t); t.mock.method(api, 'request', async () => { throw Error('must not call'); });
  f.page.prepareFollowupEnterprise({ staffRole: 'construction_staff' }); await f.page.openFollowupEnterprise();
  assert.equal(f.page.data.followupEnterpriseOpen, false);
  f.page.prepareFollowupEnterprise({ staffRole: 'admin' }); f.page.data.followupPending = true;
  await f.page.openFollowupEnterprise(); await f.page.selectFollowupEnterprise({ currentTarget: { dataset: { id: '2' } } });
  assert.equal(f.app.globalData.token, 'old'); assert.deepEqual(f.page.data.followupReports, [{ private: 'old-scope' }]);
});
test('search errors preserve results and the filter; a response from an old identity cannot restore an enterprise list', async t => {
  const f = fixture(t); f.page.data.followupEnterprises = [{ _id: '1' }]; f.page.data.followupEnterpriseQuery = '微云';
  t.mock.method(api, 'request', async () => { throw { statusCode: 503 }; }); await f.page.searchFollowupEnterprises();
  assert.equal(f.page.data.followupEnterpriseQuery, '微云'); assert.deepEqual(f.page.data.followupEnterprises, [{ _id: '1' }]);
  let resolve; api.request = () => new Promise(r => { resolve = r; }); const pending = f.page.searchFollowupEnterprises();
  f.app.globalData.token = 'new-identity'; f.page.closeFollowupEnterprise();
  resolve({ data: { enterprises: [{ _id: 'old-private', status: 'active' }], pagination: { totalPages: 1 } } }); await pending;
  assert.deepEqual(f.page.data.followupEnterprises, []);
});
test('an invalid identity-switch receipt cannot commit a new token or clear the current destination', async t => {
  const f = fixture(t); f.page.data.followupEnterprises = [{ _id: '2', status: 'active' }];
  t.mock.method(api, 'request', async () => ({ token: 'wrong', context: { enterpriseId: '3', staffId: '5413' } }));
  await f.page.selectFollowupEnterprise({ currentTarget: { dataset: { id: '2' } } });
  assert.equal(f.app.globalData.token, 'old'); assert.ok(!f.calls.includes('clear'));
});
test('explicit selection clears private reports and photos before signed-scope hydration and reentry', async t => {
  const f = fixture(t); f.page.data.followupEnterprises = [{ _id: '2', status: 'active' }];
  f.page.followups.show = async () => { assert.equal(f.page.data.followupEnterpriseBusy, true); f.calls.push('show'); };
  t.mock.method(api, 'request', async (url, method, body) => { assert.equal(url, '/miniprogram/identity-contexts/switch');
    assert.deepEqual(body, { mode: 'staff', staffId: '5413', enterpriseId: '2' });
    return { token: 'selected', context: { enterpriseId: '2', staffId: '5413' } }; });
  await f.page.selectFollowupEnterprise({ currentTarget: { dataset: { id: '2' } } });
  assert.equal(f.app.globalData.token, 'selected'); assert.deepEqual(f.page.data.followupReports, []);
  assert.ok(f.calls.indexOf('clear') < f.calls.indexOf('hydrate')); assert.ok(f.calls.indexOf('clear-media') < f.calls.indexOf('hydrate'));
  assert.ok(f.calls.indexOf('hydrate') < f.calls.indexOf('show')); assert.equal(f.page.data.followupEnterpriseName, '合成企业');
});
