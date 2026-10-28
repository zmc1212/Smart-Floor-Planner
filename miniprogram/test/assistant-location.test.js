const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NearbyLocationController } = require('../packages/assistant/lib/location');
const region = () => ({ cityCode: '330100', cityName: '杭州市', district: '西湖区', source: 'wechat_location', resolvedAt: new Date().toISOString() });
test('the first message creates its own consultation before resolving location and sending', async () => {
  const previous = global.Page; let page;
  global.Page = value => { page = value; };
  try { require('../packages/assistant/chat/chat'); } finally { global.Page = previous; }
  const events = [], context = { _alive: true, _shown: true, data: { draft: '我想看看附近的工地', canSend: true },
    controller: { handoffConversation: async () => { events.push('create'); context.data.conversation = { id: '11' }; return '11'; }, send: async () => events.push('send') },
    syncLocation: async () => { assert.equal(context.data.conversation.id, '11'); events.push('location'); return {}; } };
  await page.send.call(context); assert.deepEqual(events, ['create', 'location', 'send']);
  context.data.conversation = null; context.controller.handoffConversation = async () => null; events.length = 0;
  await page.send.call(context); assert.deepEqual(events, []);
  const previousApp = global.getApp; global.getApp = () => ({ globalData: { token: 'synthetic' } });
  try {
    for (const state of ['pendingSend', 'pendingAction', 'uncertainRun']) {
      const pending = { data: { conversation: { id: '11' }, [state]: true }, location: { ensure: () => { throw Error('Must recover the original operation before updating location'); } } };
      assert.deepEqual(await page.syncLocation.call(pending), {});
    }
  } finally { global.getApp = previousApp; }
});
function fixture(setting, fix = { latitude: 30.25, longitude: 120.13 }) {
  const calls = []; let session = 'synthetic-a', saved = null, fixes = 0;
  global.wx = { getSetting: ({ success }) => success({ authSetting: setting }), getLocation: ({ type, success, fail }) => { fixes++; assert.equal(type, 'gcj02'); fix.errMsg ? fail(fix) : success(fix); } };
  const controller = new NearbyLocationController({ identity: () => session, client: { read: async (path, body, headers, method = 'GET') => {
    calls.push({ path, body, headers, method }); if (method === 'DELETE') saved = null; if (method === 'POST') saved = region(); return { region: saved };
  } } });
  return { controller, calls, fixes: () => fixes, session: value => { session = value; } };
}
test('only an explicit action requests ungranted location; payload is sent in POST body with no journal', async () => {
  const old = global.wx;
  try {
    const f = fixture({}); await f.controller.ensure('11'); assert.equal(f.fixes(), 0);
    const result = await f.controller.ensure('11', true); assert.equal(result.region.cityCode, '330100'); assert.equal(f.fixes(), 1);
    const post = f.calls.find(c => c.method === 'POST'); assert.deepEqual(post.body, { latitude: 30.25, longitude: 120.13, coordinateSystem: 'gcj02' }); assert.deepEqual(post.headers, {});
    await f.controller.ensure('11', true); assert.equal(f.fixes(), 1);
  } finally { global.wx = old; }
});
test('denial clears server region without repeated permission prompts; failure recovers on retry', async () => {
  const old = global.wx;
  try {
    const f = fixture({ 'scope.userLocation': false }); const denied = await f.controller.ensure('11', true);
    assert.equal(f.fixes(), 0); assert.match(denied.notice, /定位未授权/); assert.equal(f.calls.at(-1).method, 'DELETE');
    const broken = fixture({ 'scope.userLocation': true }, { errMsg: 'getLocation:fail' });
    assert.ok((await broken.controller.ensure('11', true)).notice); assert.equal(broken.calls.at(-1).method, 'DELETE');
    global.wx.getLocation = ({ success }) => success({ latitude: 30.25, longitude: 120.13 });
    assert.ok((await broken.controller.ensure('11', true)).region);
  } finally { global.wx = old; }
});
test('reentry reuses a recent server region; switching identity while acquiring discards late location', async () => {
  const old = global.wx;
  try {
    const f = fixture({ 'scope.userLocation': true }); await f.controller.ensure('11'); f.controller.clear(); await f.controller.ensure('11'); assert.equal(f.fixes(), 1);
    const late = fixture({ 'scope.userLocation': true }); let finish;
    global.wx.getLocation = ({ success }) => { finish = success; };
    const pending = late.controller.ensure('11'); while (!finish) await new Promise(r => setImmediate(r));
    late.session('synthetic-b'); finish({ latitude: 30.25, longitude: 120.13 }); assert.deepEqual(await pending, {}); assert.equal(late.calls.filter(c => c.method === 'POST').length, 0);
  } finally { global.wx = old; }
});
